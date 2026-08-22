const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('dados pessoais não possuem leitura pública nas regras', () => {
  const rules = read('firestore.rules');
  for (const collection of ['abandonados', 'enderecos', 'pedidos']) {
    const match = rules.match(new RegExp(`match /${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`));
    assert.ok(match, `regra de ${collection} não encontrada`);
    assert.doesNotMatch(match[1], /allow\s+(?:get|read|list)\s*:\s*if\s+true/);
  }
  assert.doesNotMatch(rules, /'lapinkPedidos'/, 'documento legado de pedidos não pode ser público');
});

test('checkout usa token secreto para consulta de pedido', () => {
  const functions = read('functions/index.js');
  const sucesso = read('public/sucesso.html');
  assert.match(functions, /exports\.obterPedido/);
  assert.match(functions, /timingSafeEqual/);
  assert.match(sucesso, /cloudfunctions\.net\/obterPedido/);
  assert.doesNotMatch(sucesso, /collection\(['"]pedidos['"]\)\.doc\(id\)\.get/);
});

test('cadastro local nunca persiste credencial de cliente', () => {
  const storage = read('public/js/storage.js');
  const register = read('public/js/register.js');
  assert.match(storage, /delete seguro\.password/);
  assert.doesNotMatch(register, /password:\s*hash/);
});

test('webhook valida valor e atualiza estoque de forma transacional', () => {
  const functions = read('functions/index.js');
  assert.match(functions, /function processarPagamentoAtomico/);
  assert.match(functions, /payment\.transaction_amount/);
  assert.match(functions, /payment\.currency_id/);
  assert.match(functions, /estoqueProcessado/);
  assert.match(functions, /estoqueEstornado/);
  assert.match(functions, /db\.runTransaction/);
  assert.doesNotMatch(functions, /Responde 200 imediatamente para o MP não retentar/);
});

test('hosting envia cabeçalhos mínimos de segurança', () => {
  const firebase = read('firebase.json');
  for (const header of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.match(firebase, new RegExp(header));
  }
});
