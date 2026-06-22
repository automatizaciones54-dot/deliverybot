const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.json');

// ── INTERNAL ──────────────────────────────────

function load() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const initial = { orders: [], workers: [], nextOrderId: 1 };
      saveAtomic(initial);
      return initial;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    const initial = { orders: [], workers: [], nextOrderId: 1 };
    saveAtomic(initial);
    return initial;
  }
}

function saveAtomic(data) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

// ── ORDERS ────────────────────────────────────

function createOrder({ phone, details, link, lat, lng }) {
  const data = load();
  const order = {
    id: data.nextOrderId++,
    phone,
    details,
    link,
    lat,
    lng,
    status: 'pendiente',
    workerName: null,
    workerPhone: null,
    createdAt: new Date().toISOString(),
  };
  data.orders.push(order);
  saveAtomic(data);
  return order.id;
}

function getOrder(id) {
  const data = load();
  return data.orders.find((o) => o.id === id) || null;
}

function getClientOrders(phone) {
  const data = load();
  return data.orders.filter((o) => o.phone === phone);
}

function getActiveClientOrders(phone) {
  const data = load();
  return data.orders.filter(
    (o) =>
      o.phone === phone &&
      (o.status === 'pendiente' || o.status === 'asignado' || o.status === 'en_camino')
  );
}

function getAssignedOrders() {
  const data = load();
  return data.orders.filter((o) => o.status === 'asignado');
}

function getEnCaminoOrders() {
  const data = load();
  return data.orders.filter((o) => o.status === 'en_camino');
}

function releaseOrder(orderId, workerPhone) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId && o.workerPhone === workerPhone);
  if (!order || (order.status !== 'asignado' && order.status !== 'en_camino')) return false;

  order.status = 'pendiente';
  const workerPhone_ = order.workerPhone;
  order.workerName = null;
  order.workerPhone = null;
  order.notifiedTimeout = false;

  const worker = data.workers.find((w) => w.phone === workerPhone_);
  if (worker) {
    worker.available = true;
    worker.currentOrderId = null;
  }

  saveAtomic(data);
  return true;
}

function updateOrderDetails(orderId, phone, newDetails) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId && o.phone === phone);
  if (!order || order.status !== 'pendiente') return false;
  order.details = newDetails;
  saveAtomic(data);
  return true;
}

function getActiveWorkerOrder(workerPhone) {
  const data = load();
  return data.orders.find((o) => o.workerPhone === workerPhone && (o.status === 'asignado' || o.status === 'en_camino')) || null;
}

function markWorkerAvailable(workerPhone) {
  const data = load();
  const worker = data.workers.find((w) => w.phone === workerPhone);
  if (!worker) return false;
  if (worker.currentOrderId) {
    const activeOrder = data.orders.find(o => o.id === worker.currentOrderId && (o.status === 'asignado' || o.status === 'en_camino'));
    if (activeOrder) return false;
  }
  worker.available = true;
  worker.currentOrderId = null;
  saveAtomic(data);
  return true;
}

function getPendingOrders() {
  const data = load();
  return data.orders.filter((o) => o.status === 'pendiente');
}

function assignOrder(orderId, workerPhone, workerName) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order || order.status !== 'pendiente') return false;

  order.status = 'asignado';
  order.workerName = workerName;
  order.workerPhone = workerPhone;

  let worker = data.workers.find((w) => w.phone === workerPhone);
  if (!worker) {
    data.workers.push({
      phone: workerPhone,
      name: workerName,
      available: false,
      currentOrderId: orderId,
    });
  } else {
    worker.available = false;
    worker.currentOrderId = orderId;
    worker.name = workerName;
  }

  saveAtomic(data);
  return true;
}

function cancelOrder(orderId, phone) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId && o.phone === phone);
  if (!order) return null;
  if (order.status !== 'pendiente' && order.status !== 'asignado' && order.status !== 'en_camino') return null;

  const oldStatus = order.status;
  order.status = 'cancelado';

  if (order.workerPhone) {
    const worker = data.workers.find((w) => w.phone === order.workerPhone);
    if (worker) {
      worker.available = true;
      worker.currentOrderId = null;
    }
  }

  saveAtomic(data);
  return oldStatus;
}

// ── WORKERS ───────────────────────────────────

function getWorker(phone) {
  const data = load();
  return data.workers.find((w) => w.phone === phone) || null;
}

function registerWorker(phone, name) {
  const data = load();
  const existing = data.workers.find((w) => w.phone === phone);
  if (existing) {
    existing.name = name;
  } else {
    data.workers.push({
      phone,
      name,
      available: true,
      currentOrderId: null,
    });
  }
  saveAtomic(data);
}

function getWorkerCount() {
  return load().workers.length;
}

function getAvailableWorkerCount() {
  return load().workers.filter(w => w.available).length;
}

// ── NUEVAS FUNCIONES ──────────────────────────

function getAllOrders() {
  return load().orders;
}

function markAsEnCamino(orderId) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order || order.status !== 'asignado') return false;
  order.status = 'en_camino';
  saveAtomic(data);
  return true;
}

function markAsEntregado(orderId) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order || order.status !== 'en_camino') return false;
  order.status = 'entregado';
  if (order.workerPhone) {
    const worker = data.workers.find((w) => w.phone === order.workerPhone);
    if (worker) {
      worker.available = true;
      worker.currentOrderId = null;
    }
  }
  saveAtomic(data);
  return true;
}

function updateOrderPayment(orderId, paymentLink) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order) return false;
  order.paymentLink = paymentLink;
  saveAtomic(data);
  return true;
}

function markPaymentConfirmed(orderId) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order) return false;
  order.pagado = true;
  saveAtomic(data);
  return true;
}

function releaseOrderAdmin(orderId) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order || order.status !== 'asignado') return false;
  order.status = 'pendiente';
  if (order.workerPhone) {
    const worker = data.workers.find((w) => w.phone === order.workerPhone);
    if (worker) { worker.available = true; worker.currentOrderId = null; }
  }
  order.workerName = null;
  order.workerPhone = null;
  order.notifiedTimeout = false;
  saveAtomic(data);
  return true;
}

function markOrderNotified(orderId) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order) return false;
  order.notifiedTimeout = true;
  saveAtomic(data);
  return true;
}

function updateOrderDisplayPhone(orderId, phone) {
  const data = load();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order) return false;
  order.phoneDisplay = phone;
  saveAtomic(data);
  return true;
}

// ── EXPORTS ───────────────────────────────────

module.exports = {
  load,
  createOrder,
  getOrder,
  getClientOrders,
  getActiveClientOrders,
  getPendingOrders,
  getAssignedOrders,
  getEnCaminoOrders,
  releaseOrder,
  updateOrderDetails,
  getActiveWorkerOrder,
  markWorkerAvailable,
  assignOrder,
  cancelOrder,
  getWorker,
  registerWorker,
  getWorkerCount,
  getAvailableWorkerCount,
  getAllOrders,
  markAsEnCamino,
  markAsEntregado,
  updateOrderPayment,
  markPaymentConfirmed,
  releaseOrderAdmin,
  markOrderNotified,
  updateOrderDisplayPhone,
};
