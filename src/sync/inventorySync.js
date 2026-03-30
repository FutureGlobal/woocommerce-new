const woocommerce = require('../woocommerce');
const mabang = require('../mabang');
const config = require('../config');
const logger = require('../logger');

// Fetch all SKUs from Mabang with pagination (max 500/page)
async function getAllMabangSkus(warehouseCode) {
  const allSkus = [];
  let page = 1;

  while (true) {
    const result = await mabang.getSkus(warehouseCode, page, 500);

    if (String(result.code) !== '200' || !result.data || result.data.length === 0) {
      if (page === 1 && String(result.code) !== '200') {
        logger.warn(`Mabang getSku failed: ${result.msg}`);
      }
      break;
    }

    allSkus.push(...result.data);
    logger.debug(`Mabang SKUs page ${page}: fetched ${result.data.length} (total so far: ${allSkus.length})`);

    if (result.data.length < 500) break;
    page++;
  }

  return allSkus;
}

// Sync Mabang inventory → WooCommerce stock for one SKU entry
async function syncSkuStock(mabangSku) {
  const sku = mabangSku.sku || mabangSku.originSku;
  if (!sku) return 'skipped';

  // Use availableStockQuantity (excludes orders in progress) if present, else quantity
  const mabangQty = parseInt(
    mabangSku.availableStockQuantity != null
      ? mabangSku.availableStockQuantity
      : mabangSku.quantity,
    10
  );

  if (isNaN(mabangQty)) return 'skipped';

  // Find matching WooCommerce product by SKU
  const product = await woocommerce.getProductBySku(sku);
  if (!product) {
    logger.debug(`SKU ${sku}: no matching WooCommerce product — skipping`);
    return 'skipped';
  }

  // Only manage products where WooCommerce tracks stock
  if (!product.manage_stock) {
    logger.debug(`SKU ${sku}: manage_stock=false — skipping`);
    return 'skipped';
  }

  const wcQty = parseInt(product.stock_quantity, 10) || 0;

  if (wcQty === mabangQty) {
    logger.debug(`SKU ${sku}: stock already ${mabangQty} — no update needed`);
    return 'unchanged';
  }

  // Determine if this is a variation
  const isVariation = product.type === undefined && product.product_id != null;
  const productId = isVariation ? product.product_id : product.id;
  const variationId = isVariation ? product.id : null;

  await woocommerce.updateProductStock(productId, mabangQty, variationId);
  logger.info(`SKU ${sku}: updated WooCommerce stock ${wcQty} → ${mabangQty}`);
  return 'updated';
}

// Full inventory sync: pull all Mabang SKUs and update WooCommerce stock
async function syncInventoryToWooCommerce() {
  logger.info('=== Inventory Sync START (Mabang TMS → WooCommerce) ===');
  try {
    const warehouseCode = config.mabang.warehouseCode;
    const skus = await getAllMabangSkus(warehouseCode);
    logger.info(`Fetched ${skus.length} SKUs from Mabang warehouse ${warehouseCode}`);

    const counts = { updated: 0, unchanged: 0, skipped: 0, failed: 0 };

    for (const skuEntry of skus) {
      try {
        const result = await syncSkuStock(skuEntry);
        counts[result] = (counts[result] || 0) + 1;
      } catch (err) {
        counts.failed++;
        logger.error(`SKU ${skuEntry.sku}: inventory sync error — ${err.message}`);
      }
      // Throttle to avoid WC rate limits
      await new Promise((r) => setTimeout(r, 200));
    }

    logger.info(
      `=== Inventory Sync DONE: ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.skipped} skipped, ${counts.failed} failed ===`
    );
    return counts;
  } catch (err) {
    logger.error(`Inventory sync crashed: ${err.message}`);
    throw err;
  }
}

module.exports = { syncInventoryToWooCommerce };
