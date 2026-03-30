const express = require('express');
const router = express.Router();
const mabang = require('../mabang');
const woocommerce = require('../woocommerce');
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

// POST /api/migrate/order-ids
// For orders pushed before the 6xxxxxxxxx format was introduced:
// deletes from Mabang using the old WC order ID, clears the push flag in WC,
// then triggers a full re-sync so they get re-pushed with the new format.
router.post('/migrate/order-ids', async (req, res) => {
  logger.info('Order ID migration started');
  res.json({ message: 'Migration started — check logs for progress' });

  setImmediate(async () => {
    try {
      const orders = await woocommerce.getAllProcessingOrders();
      // Target: pushed=1 but no _mabang_order_id (old format)
      const toMigrate = orders.filter((o) => {
        const meta = Object.fromEntries((o.meta_data || []).map((m) => [m.key, m.value]));
        return meta._mabang_order_pushed === '1' && !meta._mabang_order_id;
      });

      logger.info(`Migration: found ${toMigrate.length} orders to re-push with new ID format`);
      let deleted = 0, cleared = 0, failed = 0;

      for (const order of toMigrate) {
        try {
          // 1. Delete from Mabang using the old order ID (WC ID as string)
          const delResult = await mabang.post('deleteOrder', {
            client_id: require('../config').mabang.clientId,
            client_secret: require('../config').mabang.clientSecret,
            data: [{ orderId: String(order.id), reason: 'Re-push with new order ID format' }],
          });
          const delItem = delResult.data && delResult.data[0];
          const delOk = delItem && (String(delItem.code) === '200' || String(delResult.code) === '200');
          if (delOk) {
            deleted++;
            logger.info(`Migration: deleted Mabang order ${order.id}`);
          } else {
            logger.warn(`Migration: Mabang delete order ${order.id} → ${delResult.msg || (delItem && delItem.msg)}`);
          }

          // 2. Clear push flag in WooCommerce regardless (so re-sync will pick it up)
          await woocommerce.updateOrder(order.id, {
            meta_data: [
              { key: '_mabang_order_pushed', value: '0' },
              { key: '_mabang_order_id', value: '' },
            ],
          });
          cleared++;
        } catch (err) {
          failed++;
          logger.error(`Migration: order ${order.id} failed — ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      logger.info(`Migration done: ${deleted} deleted from Mabang, ${cleared} cleared in WC, ${failed} failed`);
      logger.info('Triggering order sync to re-push with new IDs...');
      await syncPendingOrders();
    } catch (err) {
      logger.error(`Migration crashed: ${err.message}`);
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
