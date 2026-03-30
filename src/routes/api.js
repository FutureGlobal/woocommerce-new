const express = require('express');
const router = express.Router();
const mabang = require('../mabang');
const { syncPendingOrders } = require('../sync/orderSync');
const { syncTrackingToWooCommerce } = require('../sync/trackingSync');
const { syncInventoryToWooCommerce } = require('../sync/inventorySync');
const logger = require('../logger');

// GET /api/warehouses — list Mabang warehouses for this account
router.get('/warehouses', async (req, res) => {
  try {
    const data = await mabang.getWarehouses();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/channels?warehouse=FGSH01 — list logistics channels
router.get('/channels', async (req, res) => {
  try {
    const data = await mabang.getChannels(req.query.warehouse);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/verify — verify Mabang credentials & warehouse access
router.get('/verify', async (req, res) => {
  try {
    const data = await mabang.checkToken(req.query.warehouse);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/orders — manually trigger order push
router.post('/sync/orders', async (req, res) => {
  logger.info('Manual order sync triggered via API');
  res.json({ message: 'Order sync started' });
  setImmediate(async () => {
    try {
      await syncPendingOrders();
    } catch (err) {
      logger.error(`Manual order sync failed: ${err.message}`);
    }
  });
});

// POST /api/sync/tracking — manually trigger tracking pull
router.post('/sync/tracking', async (req, res) => {
  logger.info('Manual tracking sync triggered via API');
  res.json({ message: 'Tracking sync started' });
  setImmediate(async () => {
    try {
      await syncTrackingToWooCommerce();
    } catch (err) {
      logger.error(`Manual tracking sync failed: ${err.message}`);
    }
  });
});

// POST /api/sync/inventory — manually trigger inventory sync
router.post('/sync/inventory', async (req, res) => {
  logger.info('Manual inventory sync triggered via API');
  res.json({ message: 'Inventory sync started' });
  setImmediate(async () => {
    try {
      await syncInventoryToWooCommerce();
    } catch (err) {
      logger.error(`Manual inventory sync failed: ${err.message}`);
    }
  });
});

module.exports = router;
