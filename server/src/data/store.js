const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');
const clientsFile = path.join(dataDir, 'clients.json');
const ordersFile = path.join(dataDir, 'orders.json');

function ensureDataFolder() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function readJson(filePath, defaultValue) {
  ensureDataFolder();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(content || '[]');
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
}

function writeJson(filePath, data) {
  ensureDataFolder();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getClients() {
  return readJson(clientsFile, []);
}

function saveClients(clients) {
  writeJson(clientsFile, clients);
}

function getOrders() {
  return readJson(ordersFile, []);
}

function saveOrders(orders) {
  writeJson(ordersFile, orders);
}

module.exports = {
  getClients,
  saveClients,
  getOrders,
  saveOrders
};
