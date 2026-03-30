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
    clientId: process.env.MABANG_CLIENT_ID || '1564',
    clientSecret: process.env.MABANG_CLIENT_SECRET,
    warehouseCode: process.env.MABANG_WAREHOUSE_CODE || 'FGSH01',
    warehouseId: process.env.MABANG_WAREHOUSE_ID || '888709',
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
  },
};
