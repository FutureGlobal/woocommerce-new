const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

class MabangClient {
  constructor() {
    this.client = axios.create({
      baseURL: config.mabang.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    });
  }

  // Auth params used by most seller-facing endpoints
  get auth() {
    return {
      client_id: config.mabang.clientId,
      client_secret: config.mabang.clientSecret,
    };
  }

  // Auth params used by supplier-facing endpoints (getWarehouse, getChannel)
  get supplierAuth() {
    return {
      supplier_id: config.mabang.supplierId,
      supplier_secret: config.mabang.clientSecret,
    };
  }

  async post(endpoint, payload) {
    try {
      const response = await this.client.post(endpoint, payload);
      return response.data;
    } catch (err) {
      const msg = err.response ? JSON.stringify(err.response.data) : err.message;
      logger.error(`Mabang API [${endpoint}] error: ${msg}`);
      throw err;
    }
  }

  // 2.1.1 Verify seller token / warehouse access
  async checkToken(warehouseCode) {
    return this.post('checkClientToken', {
      ...this.auth,
      data: { warehouseCode: warehouseCode || config.mabang.warehouseCode },
    });
  }

  // 2.1.2 List warehouses
  async getWarehouses() {
    return this.post('getWarehouse', this.supplierAuth);
  }

  // 2.1.4 List logistics channels for a warehouse
  async getChannels(warehouseCode) {
    return this.post('getChannel', {
      ...this.supplierAuth,
      data: { warehouseCode: warehouseCode || config.mabang.warehouseCode },
    });
  }

  // 2.3.1 Create order(s) in TMS
  async createOrder(orderData) {
    return this.post('createOrder', {
      ...this.auth,
      data: [orderData],
    });
  }

  // 2.3.2 Get order status by order ID (for tracking sync)
  async getOrderStatus(orderId) {
    return this.post('findOrderStatus', {
      ...this.auth,
      data: [{ orderId: String(orderId) }],
    });
  }

  // 2.2.3 List SKUs in warehouse
  async getSkus(warehouseCode, page = 1, pageSize = 50) {
    return this.post('getSku', {
      ...this.auth,
      data: {
        warehouseCode: warehouseCode || config.mabang.warehouseCode,
        page,
        pageSize,
      },
    });
  }
}

module.exports = new MabangClient();
