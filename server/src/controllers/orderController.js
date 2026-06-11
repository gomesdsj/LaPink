const store = require('../data/store');
const { v4: uuidv4 } = require('uuid');

function getOrders(req, res) {
  const orders = store.getOrders();
  res.json(orders);
}

function getOrderById(req, res) {
  const orderId = req.params.id;
  const order = store.getOrders().find(order => order.id === orderId);
  if (!order) {
    return res.status(404).json({ error: 'Pedido não encontrado.' });
  }
  res.json(order);
}

function createOrder(req, res) {
  const { clientEmail, products, total } = req.body;
  if (!clientEmail || !products || !Array.isArray(products) || typeof total !== 'number') {
    return res.status(400).json({ error: 'Dados de pedido inválidos.' });
  }
  const clients = store.getClients();
  const client = clients.find(item => item.email === clientEmail.toLowerCase());
  if (!client) {
    return res.status(404).json({ error: 'Cliente não encontrado para o pedido.' });
  }
  const orders = store.getOrders();
  const newOrder = {
    id: uuidv4(),
    clientEmail: client.email,
    clientName: client.name,
    products,
    total,
    createdAt: new Date().toISOString()
  };
  orders.push(newOrder);
  store.saveOrders(orders);
  client.totalSpent = (client.totalSpent || 0) + total;
  client.purchases = client.purchases || [];
  client.purchases.push(newOrder.id);
  store.saveClients(clients);
  res.status(201).json(newOrder);
}

function deleteOrder(req, res) {
  const orderId = req.params.id;
  const orders = store.getOrders();
  const filtered = orders.filter(order => order.id !== orderId);
  if (filtered.length === orders.length) {
    return res.status(404).json({ error: 'Pedido não encontrado.' });
  }
  store.saveOrders(filtered);
  res.json({ message: 'Pedido removido com sucesso.' });
}

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  deleteOrder
};
