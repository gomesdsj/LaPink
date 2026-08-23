const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;

function readDb() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
}

async function waitForServer(timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api`);
      if (res.ok) return;
    } catch {
      // server ainda inicializando
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error('Servidor não respondeu em tempo hábil');
}

let server;

before(async () => {
  server = spawn(process.execPath, ['dev-server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', (chunk) => process.stdout.write(chunk.toString()));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk.toString()));

  await waitForServer();
});

after(async () => {
  if (server && !server.killed) {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
});

describe('API do LaPink', () => {
  test('GET /api responde com metadados da API', async () => {
    const res = await fetch(`${BASE}/api`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.name, 'LaPink Dev API');
    assert.ok(Array.isArray(body.endpoints.auth));
  });

  test('login autentica usuário e retorna token válido', async () => {
    const db = readDb();
    const admin = db.users.find((u) => u.role === 'superadmin') || db.users[0];
    assert.ok(admin, 'Não existe usuário superadmin no banco local');

    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: admin.password })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.token);
    assert.equal(body.user.email, admin.email);
  });

  test('acesso sem token em /api/produtos retorna 401', async () => {
    const res = await fetch(`${BASE}/api/produtos`);
    assert.equal(res.status, 401);
  });

  test('servidor local não publica o arquivo do banco', async () => {
    const res = await fetch(`${BASE}/data/db.json`);
    assert.equal(res.status, 404);
  });

  test('usuário autenticado consegue listar e criar produto', async () => {
    const db = readDb();
    const admin = db.users.find((u) => u.role === 'superadmin') || db.users[0];

    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: admin.password })
    });

    const loginBody = await loginRes.json();
    const token = loginBody.token;

    const listRes = await fetch(`${BASE}/api/produtos`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(listRes.status, 200);
    const produtos = await listRes.json();
    assert.ok(Array.isArray(produtos));

    const produto = {
      nome: 'Teste Produto API',
      categoria: 'Teste',
      preco: 49.9,
      estoque: 15,
      ativo: true
    };

    const createRes = await fetch(`${BASE}/api/produtos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(produto)
    });

    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.nome, produto.nome);
    assert.ok(created.id);

    const deleteRes = await fetch(`${BASE}/api/produtos/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(deleteRes.status, 200);
  });
});
