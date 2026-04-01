const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

class WooCommerceClient {
  constructor() {
    this.client = axios.create({
      baseURL: `${config.woocommerce.storeUrl}/wp-json/wc/v3`,
      auth: {
        username: config.woocommerce.consumerKey,
        password: config.woocommerce.consumerSecret,
      },
      timeout: 30000,
    });
  }

  async getOrders(params = {}) {
    const response = await this.client.get('/orders', { params });
    return response.data;
  }

  async getOrder(orderId) {
    const response = await this.client.get(`/orders/${orderId}`);
    return response.data;
  }

  async updateOrder(orderId, data) {
    const response = await this.client.put(`/orders/${orderId}`, data);
    return response.data;
  }

  async addOrderNote(orderId, note, customerNote = false) {
    const response = await this.client.post(`/orders/${orderId}/notes`, {
      note,
      customer_note: customerNote,
    });
    return response.data;
  }

  // Find a WooCommerce product (or variation) by SKU
  async getProductBySku(sku) {
    // Search simple products and variable product parents
    const products = await this.client.get('/products', {
      params: { sku, per_page: 5 },
    });
    if (products.data && products.data.length > 0) return products.data[0];

    // Also check variations (variable products)
    const variations = await this.client.get('/products/variations/all', {
      params: { sku, per_page: 5 },
    }).catch(() => ({ data: [] }));
    if (variations.data && variations.data.length > 0) return variations.data[0];

    return null;
  }

  // Update stock quantity for a product or variation
  async updateProductStock(productId, quantity, variationId = null) {
    const payload = { stock_quantity: quantity, manage_stock: true };
    if (variationId) {
      const response = await this.client.put(`/products/${productId}/variations/${variationId}`, payload);
      return response.data;
    }
    const response = await this.client.put(`/products/${productId}`, payload);
    return response.data;
  }

  // Fetch all "processing" orders with pagination
  async getAllProcessingOrders() {
    const allOrders = [];
    let page = 1;
    const perPage = config.sync.pageSize;

    while (true) {
      const orders = await this.getOrders({
        status: 'processing',
        per_page: perPage,
        page,
        orderby: 'date',
        order: 'desc',
      });

      if (!orders || orders.length === 0) break;
      allOrders.push(...orders);
      if (orders.length < perPage) break;
      page++;
    }

    return allOrders;
  }

  // Fetch recently completed orders that still only have first-mile tracking
  // (trackNumber == trackNumber1 stored in meta — last-mile not yet received)
  async getCompletedOrdersAwaitingLastMile() {
    const allOrders = [];
    let page = 1;
    const perPage = config.sync.pageSize;

    while (true) {
      const orders = await this.getOrders({
        status: 'completed',
        per_page: perPage,
        page,
        orderby: 'date',
        order: 'desc',
      });

      if (!orders || orders.length === 0) break;

      for (const o of orders) {
        const meta = Object.fromEntries((o.meta_data || []).map((m) => [m.key, m.value]));
        const tracking = meta._mabang_tracking_number || '';
        const tracking1 = meta._mabang_tracking_number1 || '';
        const mabangId = meta._mabang_order_id || '';
        // Include if pushed to Mabang AND tracking equals trackNumber1 (first-mile only)
        if (mabangId && tracking && tracking === tracking1) {
          allOrders.push(o);
        }
      }

      if (orders.length < perPage) break;
      page++;

      // Only look back 2 pages (most recent completed orders)
      if (page > 2) break;
    }

    return allOrders;
  }
}

module.exports = new WooCommerceClient();
