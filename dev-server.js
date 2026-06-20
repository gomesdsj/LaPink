const express = require('express');
const path    = require('path');
const os      = require('os');
const fs      = require('fs');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

/* ═══════════════════════════════════════════════════════════════
   BANCO DE DADOS — data/db.json
════════════════════════════════════════════════════════════════ */
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch(e) { return _seedDB(); }
}

function writeDB(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function _seedDB() {
  const db = {
    produtos: [], pedidos: [], clientes: [], config: {}, lojaConfig: {},
    users: [{
      email: 'alexandrej529@hotmail.com',
      password: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
      name: 'Alexandre', role: 'superadmin',
      createdAt: new Date().toISOString()
    }]
  };
  writeDB(db);
  return db;
}

/* ═══════════════════════════════════════════════════════════════
   TOKENS EM MEMÓRIA
════════════════════════════════════════════════════════════════ */
const tokens = new Map(); // token → { email, name, role, pages }

/* ═══════════════════════════════════════════════════════════════
   MIDDLEWARES GLOBAIS
════════════════════════════════════════════════════════════════ */
app.use(express.json({ limit: '10mb' }));

// CORS — necessário para Insomnia e celular em outra porta
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Arquivos estáticos (loja, admin)
app.use(express.static(ROOT, { dotfiles: 'ignore' }));
app.get('/', (req, res) => res.redirect('/public/V1.html'));

/* ═══════════════════════════════════════════════════════════════
   MIDDLEWARES DE AUTENTICAÇÃO E PERMISSÃO
════════════════════════════════════════════════════════════════ */
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (!token || !tokens.has(token))
    return res.status(401).json({ error: 'Não autenticado. Faça login em POST /api/auth/login.' });
  req.user = tokens.get(token);
  next();
}

function requireRole(...roles) {
  return (req, res, next) =>
    roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: 'Permissão insuficiente.', role_atual: req.user.role, roles_necessarios: roles });
}

function requirePage(pageId) {
  return (req, res, next) => {
    const { role, pages } = req.user;
    if (role === 'superadmin') return next();
    if (role === 'admin' && (!Array.isArray(pages) || pages.includes(pageId))) return next();
    res.status(403).json({
      error: `Acesso negado: o usuário não tem permissão para a aba "${pageId}".`,
      usuario: req.user.email,
      abas_permitidas: req.user.pages || 'todas'
    });
  };
}

/* ═══════════════════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════════════════════ */
// POST /api/auth/login
// body: { email, password }  ← password = SHA-256 da senha
app.post('/api/auth/login', (req, res) => {
  const { email = '', password = '' } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Informe email e password (SHA-256 da senha).' });

  const db   = readDB();
  const user = (db.users || []).find(u =>
    u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password
  );
  if (!user) return res.status(401).json({ ok: false, error: 'E-mail ou senha incorretos.' });

  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, { email: user.email, name: user.name, role: user.role, pages: user.pages || null });

  res.json({
    ok: true, token,
    user: { email: user.email, name: user.name, role: user.role, pages: user.pages || null }
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  tokens.delete(token);
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════
   PRODUTOS
════════════════════════════════════════════════════════════════ */
app.get('/api/produtos', requireAuth, requirePage('produtos'), (req, res) => {
  res.json(readDB().produtos || []);
});

app.post('/api/produtos', requireAuth, requireRole('superadmin', 'admin'), requirePage('produtos'), (req, res) => {
  const db = readDB();
  const produto = { ...req.body, id: Date.now() };
  db.produtos = [...(db.produtos || []), produto];
  writeDB(db);
  res.status(201).json(produto);
});

app.put('/api/produtos/:id', requireAuth, requireRole('superadmin', 'admin'), requirePage('produtos'), (req, res) => {
  const db = readDB(); const id = parseInt(req.params.id);
  const idx = (db.produtos || []).findIndex(p => p.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Produto não encontrado.' });
  db.produtos[idx] = { ...req.body, id };
  writeDB(db);
  res.json(db.produtos[idx]);
});

app.delete('/api/produtos/:id', requireAuth, requireRole('superadmin', 'admin'), requirePage('produtos'), (req, res) => {
  const db = readDB(); const id = parseInt(req.params.id);
  db.produtos = (db.produtos || []).filter(p => p.id !== id);
  writeDB(db);
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════
   PEDIDOS
════════════════════════════════════════════════════════════════ */
app.get('/api/pedidos', requireAuth, requirePage('pedidos'), (req, res) => {
  res.json(readDB().pedidos || []);
});

app.post('/api/pedidos', requireAuth, requireRole('superadmin', 'admin'), requirePage('pedidos'), (req, res) => {
  const db = readDB();
  const pedido = { ...req.body, id: Date.now(), data: req.body.data || new Date().toISOString() };
  db.pedidos = [...(db.pedidos || []), pedido];
  writeDB(db);
  res.status(201).json(pedido);
});

app.put('/api/pedidos/:id', requireAuth, requireRole('superadmin', 'admin'), requirePage('pedidos'), (req, res) => {
  const db = readDB(); const id = parseInt(req.params.id);
  const idx = (db.pedidos || []).findIndex(p => p.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Pedido não encontrado.' });
  db.pedidos[idx] = { ...req.body, id };
  writeDB(db);
  res.json(db.pedidos[idx]);
});

app.patch('/api/pedidos/:id/status', requireAuth, requireRole('superadmin', 'admin'), requirePage('pedidos'), (req, res) => {
  const VALIDOS = ['aguardando', 'preparando', 'enviado', 'concluido', 'cancelado'];
  const { status } = req.body;
  if (!VALIDOS.includes(status))
    return res.status(400).json({ error: 'Status inválido.', validos: VALIDOS });
  const db = readDB(); const id = parseInt(req.params.id);
  const idx = (db.pedidos || []).findIndex(p => p.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Pedido não encontrado.' });
  db.pedidos[idx].status = status;
  writeDB(db);
  res.json(db.pedidos[idx]);
});

app.patch('/api/pedidos/:id/pagamento', requireAuth, requireRole('superadmin', 'admin'), requirePage('pedidos'), (req, res) => {
  const db = readDB(); const id = parseInt(req.params.id);
  const idx = (db.pedidos || []).findIndex(p => p.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Pedido não encontrado.' });
  db.pedidos[idx].pago = !!req.body.pago;
  writeDB(db);
  res.json(db.pedidos[idx]);
});

app.delete('/api/pedidos/:id', requireAuth, requireRole('superadmin', 'admin'), requirePage('pedidos'), (req, res) => {
  const db = readDB(); const id = parseInt(req.params.id);
  db.pedidos = (db.pedidos || []).filter(p => p.id !== id);
  writeDB(db);
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════
   CLIENTES
════════════════════════════════════════════════════════════════ */
app.get('/api/clientes', requireAuth, requirePage('clientes'), (req, res) => {
  res.json(readDB().clientes || []);
});

app.post('/api/clientes', requireAuth, requireRole('superadmin', 'admin'), requirePage('clientes'), (req, res) => {
  const db = readDB();
  if ((db.clientes || []).some(c => c.email === req.body.email))
    return res.status(409).json({ error: 'E-mail já cadastrado.' });
  const client = { ...req.body, createdAt: req.body.createdAt || new Date().toISOString() };
  db.clientes = [...(db.clientes || []), client];
  writeDB(db);
  res.status(201).json(client);
});

app.put('/api/clientes/:email', requireAuth, requireRole('superadmin', 'admin'), requirePage('clientes'), (req, res) => {
  const db = readDB(); const email = decodeURIComponent(req.params.email);
  const idx = (db.clientes || []).findIndex(c => c.email === email);
  if (idx < 0) return res.status(404).json({ error: 'Cliente não encontrado.' });
  db.clientes[idx] = { ...req.body, email };
  writeDB(db);
  res.json(db.clientes[idx]);
});

app.delete('/api/clientes/:email', requireAuth, requireRole('superadmin', 'admin'), requirePage('clientes'), (req, res) => {
  const db = readDB(); const email = decodeURIComponent(req.params.email);
  db.clientes = (db.clientes || []).filter(c => c.email !== email);
  writeDB(db);
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════
   USUÁRIOS — apenas superadmin
════════════════════════════════════════════════════════════════ */
app.get('/api/usuarios', requireAuth, requireRole('superadmin'), (req, res) => {
  const users = (readDB().users || []).map(u => ({
    email: u.email, name: u.name, role: u.role, pages: u.pages || null, createdAt: u.createdAt
  }));
  res.json(users);
});

app.post('/api/usuarios', requireAuth, requireRole('superadmin'), (req, res) => {
  const { email, name, role, pages, password } = req.body;
  if (!email || !name || !role || !password)
    return res.status(400).json({ error: 'Campos obrigatórios: email, name, role, password (SHA-256).' });
  const db = readDB();
  if ((db.users || []).some(u => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'E-mail já cadastrado.' });
  const user = { email: email.toLowerCase(), name, role, pages: pages || null, password, createdAt: new Date().toISOString() };
  db.users = [...(db.users || []), user];
  writeDB(db);
  res.status(201).json({ email: user.email, name: user.name, role: user.role, pages: user.pages });
});

app.put('/api/usuarios/:email', requireAuth, requireRole('superadmin'), (req, res) => {
  const db = readDB(); const email = decodeURIComponent(req.params.email);
  const idx = (db.users || []).findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (idx < 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (db.users[idx].role === 'superadmin')
    return res.status(403).json({ error: 'Não é possível alterar o Super Admin.' });
  const { name, role, pages } = req.body;
  if (name  !== undefined) db.users[idx].name  = name;
  if (role  !== undefined) db.users[idx].role  = role;
  if ('pages' in req.body) db.users[idx].pages = pages;
  writeDB(db);
  const u = db.users[idx];
  res.json({ email: u.email, name: u.name, role: u.role, pages: u.pages });
});

app.delete('/api/usuarios/:email', requireAuth, requireRole('superadmin'), (req, res) => {
  const db = readDB(); const email = decodeURIComponent(req.params.email);
  const target = (db.users || []).find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (target.role === 'superadmin') return res.status(403).json({ error: 'Não é possível excluir o Super Admin.' });
  db.users = db.users.filter(u => u.email.toLowerCase() !== email.toLowerCase());
  writeDB(db);
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════
   CONFIGURAÇÕES
════════════════════════════════════════════════════════════════ */
app.get('/api/config',      requireAuth, requireRole('superadmin', 'admin'), (req, res) => res.json(readDB().config || {}));
app.put('/api/config',      requireAuth, requireRole('superadmin', 'admin'), (req, res) => {
  const db = readDB(); db.config = req.body; writeDB(db); res.json(db.config);
});
app.get('/api/loja/config', requireAuth, requireRole('superadmin', 'admin'), (req, res) => res.json(readDB().lojaConfig || {}));
app.put('/api/loja/config', requireAuth, requireRole('superadmin', 'admin'), (req, res) => {
  const db = readDB(); db.lojaConfig = req.body; writeDB(db); res.json(db.lojaConfig);
});

/* ═══════════════════════════════════════════════════════════════
   IMPORTAR / EXPORTAR (migração do localStorage para o servidor)
════════════════════════════════════════════════════════════════ */
app.get('/api/export', requireAuth, requireRole('superadmin'), (req, res) => {
  const db = readDB();
  res.json({
    produtos: db.produtos || [], pedidos: db.pedidos || [],
    clientes: db.clientes || [], config: db.config || {}, lojaConfig: db.lojaConfig || {}
  });
});

app.post('/api/import', requireAuth, requireRole('superadmin'), (req, res) => {
  const { produtos, pedidos, clientes, config, lojaConfig } = req.body;
  const db = readDB();
  if (Array.isArray(produtos))  db.produtos  = produtos;
  if (Array.isArray(pedidos))   db.pedidos   = pedidos;
  if (Array.isArray(clientes))  db.clientes  = clientes;
  if (config)     db.config     = config;
  if (lojaConfig) db.lojaConfig = lojaConfig;
  writeDB(db);
  res.json({
    ok: true,
    importados: { produtos: db.produtos.length, pedidos: db.pedidos.length, clientes: db.clientes.length }
  });
});

/* ═══════════════════════════════════════════════════════════════
   INFO
════════════════════════════════════════════════════════════════ */
app.get('/api', (req, res) => {
  res.json({
    name: 'LaPink Dev API', version: '1.0.0',
    auth: 'Bearer token — faça login em POST /api/auth/login (password = SHA-256 da senha)',
    endpoints: {
      auth     : ['POST /api/auth/login', 'GET /api/auth/me', 'POST /api/auth/logout'],
      produtos : ['GET /api/produtos', 'POST /api/produtos', 'PUT /api/produtos/:id', 'DELETE /api/produtos/:id'],
      pedidos  : ['GET /api/pedidos', 'POST /api/pedidos', 'PUT /api/pedidos/:id',
                  'PATCH /api/pedidos/:id/status', 'PATCH /api/pedidos/:id/pagamento', 'DELETE /api/pedidos/:id'],
      clientes : ['GET /api/clientes', 'POST /api/clientes', 'PUT /api/clientes/:email', 'DELETE /api/clientes/:email'],
      usuarios : ['GET /api/usuarios (superadmin)', 'POST /api/usuarios', 'PUT /api/usuarios/:email', 'DELETE /api/usuarios/:email'],
      config   : ['GET|PUT /api/config', 'GET|PUT /api/loja/config'],
      migracao : ['GET /api/export', 'POST /api/import']
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   START
════════════════════════════════════════════════════════════════ */
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

readDB(); // garante que o db.json existe com seed

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           LaPink — Servidor de Desenvolvimento               ║
╚══════════════════════════════════════════════════════════════╝

  Local  :  http://localhost:${PORT}
  Rede   :  http://${ip}:${PORT}

  Loja   :  http://${ip}:${PORT}/public/V1.html
  Admin  :  http://${ip}:${PORT}/admin/login.html
  API    :  http://${ip}:${PORT}/api

  Insomnia: importe lapink-insomnia.json
            → defina base_url = http://${ip}:${PORT}

  Celular: conecte ao mesmo Wi-Fi e acesse a URL de Rede.
  CTRL+C para parar.
`);
});
