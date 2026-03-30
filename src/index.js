require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');
const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');
const { syncPendingOrders } = require('./sync/orderSync');
const { syncTrackingToWooCommerce } = require('./sync/trackingSync');
const { syncInventoryToWooCommerce } = require('./sync/inventorySync');

const app = express();

// Capture raw body for webhook signature verification, then parse JSON
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

app.get('/', (_req, res) => {
  res.json({
    service: 'WooCommerce ↔ Mabang TMS Integration',
    store: config.woocommerce.storeUrl,
    warehouse: config.mabang.warehouseCode,
    warehouseId: config.mabang.warehouseId,
    mabangApi: config.mabang.baseUrl,
    status: 'running',
    endpoints: {
      webhook: 'POST /webhook/order',
      manualOrderSync: 'POST /api/sync/orders',
      manualTrackingSync: 'POST /api/sync/tracking',
      channels: 'GET /api/channels',
      warehouses: 'GET /api/warehouses',
      verify: 'GET /api/verify',
    },
  });
});

app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);

// Validate required env vars before starting
function validateConfig() {
  const required = [
    ['WC_CONSUMER_KEY', config.woocommerce.consumerKey],
    ['WC_CONSUMER_SECRET', config.woocommerce.consumerSecret],
    ['MABANG_CLIENT_SECRET', config.mabang.clientSecret],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (!config.mabang.defaultChannelCode) {
    logger.warn('MABANG_DEFAULT_CHANNEL_CODE not set — orders will be skipped until set. Call GET /api/channels to find yours.');
  }
}

app.listen(config.port, async () => {
  validateConfig();
  logger.info(`Service listening on port ${config.port}`);
  logger.info(`Store: ${config.woocommerce.storeUrl}`);
  logger.info(`Mabang API: ${config.mabang.baseUrl}`);
  logger.info(`Warehouse: ${config.mabang.warehouseCode} (ID: ${config.mabang.warehouseId})`);

  // Schedule recurring syncs
  cron.schedule(config.sync.orderSyncInterval, () => {
    syncPendingOrders().catch((e) => logger.error(`Scheduled order sync error: ${e.message}`));
  });

  cron.schedule(config.sync.trackingSyncInterval, () => {
    syncTrackingToWooCommerce().catch((e) => logger.error(`Scheduled tracking sync error: ${e.message}`));
  });

  cron.schedule(config.sync.inventorySyncInterval, () => {
    syncInventoryToWooCommerce().catch((e) => logger.error(`Scheduled inventory sync error: ${e.message}`));
  });

  logger.info(`Order sync cron:    ${config.sync.orderSyncInterval}`);
  logger.info(`Tracking sync cron: ${config.sync.trackingSyncInterval}`);
  logger.info(`Inventory sync cron:${config.sync.inventorySyncInterval}`);

  // Run both syncs once on startup (after 10 s)
  setTimeout(() => {
    syncPendingOrders().catch((e) => logger.error(`Startup order sync error: ${e.message}`));
  }, 10_000);

  setTimeout(() => {
    syncTrackingToWooCommerce().catch((e) => logger.error(`Startup tracking sync error: ${e.message}`));
  }, 20_000);

  setTimeout(() => {
    syncInventoryToWooCommerce().catch((e) => logger.error(`Startup inventory sync error: ${e.message}`));
  }, 35_000);
});
