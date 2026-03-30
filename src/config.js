require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,

  woocommerce: {
    storeUrl: process.env.WC_STORE_URL || 'https://cococomfort.nl',
    consumerKey: process.env.WC_CONSUMER_KEY,
    consumerSecret: process.env.WC_CONSUMER_SECRET,
    webhookSecret: process.env.WC_WEBHOOK_SECRET || '',
  },

  mabang: {
    baseUrl: process.env.MABANG_BASE_URL || 'https://tms-api.mabangerp.com/api/',
    // client_id / client_secret: used for order & SKU operations
    clientId: process.env.MABANG_CLIENT_ID || '47777',
    clientSecret: process.env.MABANG_CLIENT_SECRET,
    // supplier_id / supplier_secret: used for warehouse & channel lookups
    // NOTE: supplier_id = seller ID (47777), same account as client_id
    supplierId: process.env.MABANG_SUPPLIER_ID || '47777',
    // warehouseCode is the numeric ID from getWarehouse (e.g. 11542 = FGSH01)
    warehouseCode: process.env.MABANG_WAREHOUSE_CODE || '11542',
    warehouseId: process.env.MABANG_WAREHOUSE_ID || '11542',
    shopName: process.env.MABANG_SHOP_NAME || 'COCOCOMFORT',
    defaultChannelCode: process.env.MABANG_DEFAULT_CHANNEL_CODE || '',
  },

  sync: {
    // Cron: push new WC "processing" orders to Mabang every 15 minutes
    orderSyncInterval: process.env.ORDER_SYNC_INTERVAL || '*/15 * * * *',
    // Cron: pull tracking from Mabang and update WC every 30 minutes
    trackingSyncInterval: process.env.TRACKING_SYNC_INTERVAL || '*/30 * * * *',
    // How many orders to fetch per page
    pageSize: parseInt(process.env.SYNC_PAGE_SIZE || '50', 10),
    // Only process orders with ID >= this value (0 = no cutoff)
    // Old store last order #4128 → new store starts at #5942
    minOrderId: parseInt(process.env.MIN_ORDER_ID || '0', 10),
  },
};
