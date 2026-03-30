const woocommerce = require('../woocommerce');
const mabang = require('../mabang');
const logger = require('../logger');

const META_PUSHED = '_mabang_order_pushed';
const META_ORDER_ID = '_mabang_order_id';
const META_TRACKING = '_mabang_tracking_number';
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

  // Already have tracking — nothing to do
  if (getMeta(wcOrder, META_TRACKING)) {
    return 'skipped';
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

  if (!mabangOrder.trackNumber) {
    logger.debug(`Order ${orderId}: no tracking number yet (Mabang status: ${mabangOrder.orderStatus})`);
    return 'pending';
  }

  if (!SHIPPED_STATUSES.has(mabangOrder.orderStatus)) {
    logger.debug(`Order ${orderId}: not yet shipped (status: ${mabangOrder.orderStatus})`);
    return 'pending';
  }

  const trackingNumber = mabangOrder.trackNumber;
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

  // Customer-visible note
  await woocommerce.addOrderNote(
    orderId,
    `Your order has been shipped! Tracking number: ${trackingNumber}`,
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

// Full sync: fetch all WC "processing" orders and look for tracking in Mabang
async function syncTrackingToWooCommerce() {
  logger.info('=== Tracking Sync START (Mabang TMS → WooCommerce) ===');
  try {
    const orders = await woocommerce.getAllProcessingOrders();
    logger.info(`Checking ${orders.length} processing orders for tracking updates`);

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
