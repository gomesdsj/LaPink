const store = require('../data/store');

function getClients(req, res) {
  const clients = store.getClients();
  res.json(clients);
}

function getClientByEmail(req, res) {
  const email = req.params.email.toLowerCase();
  const client = store.getClients().find(item => item.email === email);
  if (!client) {
    return res.status(404).json({ error: 'Cliente não encontrado.' });
  }
  res.json(client);
}

function createClient(req, res) {
  const { name, email, whatsapp, password } = req.body;
  if (!name || !email || !whatsapp || !password) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }
  const normalizedEmail = email.toLowerCase();
  const clients = store.getClients();
  if (clients.some(client => client.email === normalizedEmail)) {
    return res.status(409).json({ error: 'Já existe um cliente com este e-mail.' });
  }
  const newClient = {
    name,
    email: normalizedEmail,
    whatsapp,
    password,
    totalSpent: 0,
    purchases: []
  };
  clients.push(newClient);
  store.saveClients(clients);
  res.status(201).json(newClient);
}

function updateClient(req, res) {
  const email = req.params.email.toLowerCase();
  const { name, whatsapp, password } = req.body;
  const clients = store.getClients();
  const index = clients.findIndex(client => client.email === email);
  if (index === -1) {
    return res.status(404).json({ error: 'Cliente não encontrado.' });
  }
  const updatedClient = {
    ...clients[index],
    name: name || clients[index].name,
    whatsapp: whatsapp || clients[index].whatsapp,
    password: password || clients[index].password
  };
  clients[index] = updatedClient;
  store.saveClients(clients);
  res.json(updatedClient);
}

function deleteClient(req, res) {
  const email = req.params.email.toLowerCase();
  const clients = store.getClients();
  const filtered = clients.filter(client => client.email !== email);
  if (filtered.length === clients.length) {
    return res.status(404).json({ error: 'Cliente não encontrado.' });
  }
  store.saveClients(filtered);
  res.json({ message: 'Cliente removido com sucesso.' });
}

module.exports = {
  getClients,
  getClientByEmail,
  createClient,
  updateClient,
  deleteClient
};
