const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const config = require('../config');
const logger = require('../logger');
const { syncOrderToMabang } = require('../sync/orderSync');

function verifySignature(req) {
  if (!config.woocommerce.webhookSecret) return true;
  const sig = req.headers['x-wc-webhook-signature'];
  if (!sig) return false;
  const hmac = crypto
    .createHmac('sha256', config.woocommerce.webhookSecret)
    .update(req.rawBody || '')
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hmac));
  } catch {
    return false;
  }
}

// WooCommerce sends this when an order is created or updated
router.post('/order', async (req, res) => {
  if (!verifySignature(req)) {
    logger.warn('Webhook: invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const order = req.body;
  if (!order || !order.id) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  logger.info(`Webhook: order ${order.id} received (status: ${order.status})`);

  // Always ACK immediately so WooCommerce doesn't retry
  res.status(200).json({ received: true });

  // Only process "processing" orders asynchronously
  if (order.status === 'processing') {
    setImmediate(async () => {
      try {
        await syncOrderToMabang(order);
      } catch (err) {
        logger.error(`Webhook: order ${order.id} sync failed — ${err.message}`);
      }
    });
  }
});

module.exports = router;
