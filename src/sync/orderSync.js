const woocommerce = require('../woocommerce');
const mabang = require('../mabang');
const config = require('../config');
const logger = require('../logger');

const META_PUSHED = '_mabang_order_pushed';
const META_ORDER_ID = '_mabang_order_id';
const META_REF_ID = '_mabang_reference_id';
const META_PUSHED_AT = '_mabang_pushed_at';

// Generate a Mabang order ID: starts with 6, always 10 digits, deterministic from WC order ID
function buildMabangOrderId(wcOrderId) {
  return '6' + String(wcOrderId).padStart(9, '0');
}

function getMeta(order, key) {
  const entry = (order.meta_data || []).find((m) => m.key === key);
  return entry ? entry.value : null;
}

// Map a WooCommerce order object → Mabang createOrder payload
function mapToMabang(wcOrder) {
  const s = wcOrder.shipping || {};
  const b = wcOrder.billing || {};

  const buyerName =
    `${s.first_name || b.first_name || ''} ${s.last_name || b.last_name || ''}`.trim() || 'Customer';

  const itemList = (wcOrder.line_items || []).map((item) => ({
    sku: item.sku || `WC-PROD-${item.product_id}`,
    title: item.name,
    quantity: item.quantity,
    sellPrice: parseFloat(item.price) || 0,
    itemId: String(item.product_id),
    pictureUrl: (item.image && item.image.src) ? item.image.src : '',
  }));

  // paidTime: prefer date_paid, fall back to date_created
  const rawTime = wcOrder.date_paid || wcOrder.date_created || '';
  const paidTime = rawTime.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');

  return {
    orderId: buildMabangOrderId(wcOrder.id),
    paidTime,
    channelCode: config.mabang.defaultChannelCode,
    countryCode: s.country || b.country || 'NL',
    buyerName,
    orderFee: parseFloat(wcOrder.total) || 0,
    currencyId: wcOrder.currency || 'EUR',
    street1: s.address_1 || b.address_1 || '',
    street2: s.address_2 || b.address_2 || '',
    city: s.city || b.city || '',
    province: s.state || b.state || '',
    district: '',
    phone1: b.phone || s.phone || '',
    postCode: s.postcode || b.postcode || '',
    email: b.email || '',
    shopName: config.mabang.shopName,
    platformName: 'WooCommerce',
    buyerMessage: wcOrder.customer_note || '',
    itemList,
  };
}

// Push a single WC order to Mabang; returns true if pushed, false if skipped/failed
async function syncOrderToMabang(wcOrder) {
  const orderId = wcOrder.id;

  // Skip if below minimum order ID cutoff
  if (config.sync.minOrderId > 0 && orderId < config.sync.minOrderId) {
    logger.debug(`Order ${orderId}: below MIN_ORDER_ID (${config.sync.minOrderId}), skipping`);
    return 'skipped';
  }

  // Skip if already pushed
  if (getMeta(wcOrder, META_PUSHED) === '1') {
    logger.debug(`Order ${orderId}: already pushed to Mabang, skipping`);
    return 'skipped';
  }

  const payload = mapToMabang(wcOrder);

  if (!payload.channelCode) {
    logger.warn(`Order ${orderId}: MABANG_DEFAULT_CHANNEL_CODE not set — order skipped`);
    return 'skipped';
  }

  const mabangOrderId = payload.orderId;
  logger.info(`Order ${orderId}: pushing to Mabang TMS as ${mabangOrderId}`);

  const result = await mabang.createOrder(payload);

  if (String(result.code) === '200') {
    const item = result.data && result.data[0];
    if (item && String(item.code) === '200') {
      await woocommerce.updateOrder(orderId, {
        meta_data: [
          { key: META_PUSHED, value: '1' },
          { key: META_ORDER_ID, value: mabangOrderId },
          { key: META_REF_ID, value: String(item.referenceId || '') },
          { key: META_PUSHED_AT, value: new Date().toISOString() },
        ],
      });
      await woocommerce.addOrderNote(
        orderId,
        `Order pushed to Mabang TMS. Mabang Order ID: ${mabangOrderId} | Reference ID: ${item.referenceId}`,
        false
      );
      logger.info(`Order ${orderId}: pushed successfully as Mabang order ${mabangOrderId} (ref: ${item.referenceId})`);
      return 'pushed';
    } else {
      const msg = (item && item.msg) || result.msg || 'unknown error';
      logger.warn(`Order ${orderId}: Mabang rejected — ${msg}`);
      await woocommerce.addOrderNote(orderId, `Mabang TMS rejected order: ${msg}`, false);
      return 'failed';
    }
  } else {
    logger.error(`Order ${orderId}: Mabang API error — ${result.msg}`);
    return 'failed';
  }
}

// Full sync: fetch all WC "processing" orders and push unpushed ones to Mabang
async function syncPendingOrders() {
  logger.info('=== Order Sync START (WooCommerce → Mabang TMS) ===');
  try {
    const orders = await woocommerce.getAllProcessingOrders();
    logger.info(`Found ${orders.length} processing orders in WooCommerce`);

    const counts = { pushed: 0, skipped: 0, failed: 0 };

    for (const order of orders) {
      try {
        const result = await syncOrderToMabang(order);
        counts[result] = (counts[result] || 0) + 1;
      } catch (err) {
        counts.failed++;
        logger.error(`Order ${order.id}: unexpected error — ${err.message}`);
      }
      // Small delay to avoid hammering the APIs
      await new Promise((r) => setTimeout(r, 300));
    }

    logger.info(
      `=== Order Sync DONE: ${counts.pushed} pushed, ${counts.skipped} skipped, ${counts.failed} failed ===`
    );
    return counts;
  } catch (err) {
    logger.error(`Order sync crashed: ${err.message}`);
    throw err;
  }
}

module.exports = { syncPendingOrders, syncOrderToMabang };
