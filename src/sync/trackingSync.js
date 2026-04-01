const woocommerce = require('../woocommerce');
const mabang = require('../mabang');
const logger = require('../logger');

const META_PUSHED = '_mabang_order_pushed';
const META_ORDER_ID = '_mabang_order_id';
const META_TRACKING = '_mabang_tracking_number';
const META_TRACKING1 = '_mabang_tracking_number1';
const META_CHANNEL = '_mabang_channel_code';
const META_SHIPPED_AT = '_mabang_shipped_at';

// Mabang order statuses that mean the parcel is physically shipped
const SHIPPED_STATUSES = new Set([3, 4, 5]); // 3=Shipment Successful, 4=In Shipment, 5=Delivery Successful

function getMeta(order, key) {
  const entry = (order.meta_data || []).find((m) => m.key === key);
  return entry ? entry.value : null;
}

async function syncTrackingForOrder(wcOrder) {
  const orderId = wcOrder.id;

  // Skip only if we already have a confirmed last-mile tracking number.
  // Last-mile is confirmed when trackNumber != trackNumber1 (they differ once
  // the carrier assigns a last-mile number separate from the internal one).
  const storedTracking = getMeta(wcOrder, META_TRACKING);
  const storedTracking1 = getMeta(wcOrder, META_TRACKING1) || '';
  if (storedTracking && storedTracking !== storedTracking1) {
    return 'skipped'; // already has last-mile tracking
  }

  // Only check orders that were pushed to Mabang
  if (getMeta(wcOrder, META_PUSHED) !== '1') {
    return 'skipped';
  }

  // Use the Mabang order ID stored at push time (6000005942 format); fall back to WC id for older orders
  const mabangOrderId = getMeta(wcOrder, META_ORDER_ID) || orderId;
  const result = await mabang.getOrderStatus(mabangOrderId);

  if (String(result.code) !== '200' || !result.data || result.data.length === 0) {
    logger.debug(`Order ${orderId}: no Mabang data (${result.msg})`);
    return 'pending';
  }

  const mabangOrder = result.data[0];

  if (!SHIPPED_STATUSES.has(mabangOrder.orderStatus)) {
    logger.debug(`Order ${orderId}: not yet shipped (status: ${mabangOrder.orderStatus})`);
    return 'pending';
  }

  const lastMile = mabangOrder.trackNumber || '';
  const internal = mabangOrder.trackNumber1 || '';

  // Only sync when last-mile tracking is available.
  // When trackNumber == trackNumber1 (or trackNumber1 is empty), only the
  // first-mile / internal number exists — wait for the last-mile update.
  if (!lastMile || lastMile === internal) {
    logger.debug(`Order ${orderId}: only first-mile tracking available (${lastMile || 'none'}), waiting for last-mile`);
    return 'pending';
  }

  const trackingNumber = lastMile;
  const channelCode = mabangOrder.channelCode || '';
  const shippedAt = mabangOrder.expressTime || new Date().toISOString();

  // Update WC order: store tracking meta + mark completed
  await woocommerce.updateOrder(orderId, {
    status: 'completed',
    meta_data: [
      { key: META_TRACKING, value: trackingNumber },
      { key: '_mabang_tracking_number1', value: mabangOrder.trackNumber1 || '' },
      { key: META_CHANNEL, value: channelCode },
      { key: META_SHIPPED_AT, value: shippedAt },
    ],
  });

  // Customer-visible note (only sent once last-mile tracking is confirmed)
  await woocommerce.addOrderNote(
    orderId,
    `Your order is on its way! Last-mile tracking number: ${trackingNumber}`,
    true
  );

  // Internal note
  await woocommerce.addOrderNote(
    orderId,
    `Mabang TMS shipped. Tracking: ${trackingNumber} | Channel: ${channelCode} | Shipped at: ${shippedAt}`,
    false
  );

  logger.info(`Order ${orderId}: WooCommerce updated with tracking ${trackingNumber}`);
  return 'updated';
}

// Full sync: fetch WC "processing" orders + completed orders awaiting last-mile tracking
async function syncTrackingToWooCommerce() {
  logger.info('=== Tracking Sync START (Mabang TMS → WooCommerce) ===');
  try {
    const [processingOrders, awaitingLastMile] = await Promise.all([
      woocommerce.getAllProcessingOrders(),
      woocommerce.getCompletedOrdersAwaitingLastMile(),
    ]);

    // Deduplicate by order ID
    const seen = new Set();
    const orders = [];
    for (const o of [...processingOrders, ...awaitingLastMile]) {
      if (!seen.has(o.id)) { seen.add(o.id); orders.push(o); }
    }

    logger.info(`Checking ${orders.length} orders (${processingOrders.length} processing + ${awaitingLastMile.length} awaiting last-mile)`);

    const counts = { updated: 0, pending: 0, skipped: 0, failed: 0 };

    for (const order of orders) {
      try {
        const result = await syncTrackingForOrder(order);
        counts[result] = (counts[result] || 0) + 1;
      } catch (err) {
        counts.failed++;
        logger.error(`Order ${order.id}: tracking sync error — ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    logger.info(
      `=== Tracking Sync DONE: ${counts.updated} updated, ${counts.pending} pending, ${counts.skipped} skipped, ${counts.failed} failed ===`
    );
    return counts;
  } catch (err) {
    logger.error(`Tracking sync crashed: ${err.message}`);
    throw err;
  }
}

module.exports = { syncTrackingToWooCommerce };
