'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/js/descontos.js'), 'utf8');
const storage = new Map();
const window = {};
vm.runInNewContext(source, {
  window,
  localStorage: { getItem: k => storage.get(k) || null },
  Date, Number, String, Array, JSON
});

const produto = { id: 7, precoAtacado: 100, precoVarejo: 120 };
const hoje = Date.parse('2026-08-23T12:00:00');
const promo = (percentual, extra = {}) => Object.assign({
  id: 'D' + percentual, nome: 'Teste', percentual, ativo: true,
  inicio: '2026-08-01', fim: '2026-08-31', produtoIds: ['7']
}, extra);

test('calcula descontos de 10%, 50% e 100% sem alterar o produto', () => {
  assert.equal(window.LaPinkDescontos.calcular(produto, [promo(10)], hoje).precoFinal, 90);
  assert.equal(window.LaPinkDescontos.calcular(produto, [promo(50)], hoje).precoFinal, 50);
  assert.equal(window.LaPinkDescontos.calcular(produto, [promo(100)], hoje).precoFinal, 0);
  assert.equal(produto.precoAtacado, 100);
});

test('ignora 0%, acima de 100%, expirado, desativado e produto não vinculado', () => {
  [promo(0), promo(101), promo(10, { fim: '2026-08-22' }), promo(10, { ativo: false }), promo(10, { produtoIds: ['8'] })]
    .forEach(d => assert.equal(window.LaPinkDescontos.calcular(produto, [d], hoje).precoFinal, 100));
});

test('em conflito utiliza somente o maior desconto válido', () => {
  const c = window.LaPinkDescontos.calcular(produto, [promo(10), promo(50)], hoje);
  assert.equal(c.descontoPct, 50);
  assert.equal(c.precoFinal, 50);
});

test('backend relê catálogo e promoção e grava histórico por item', () => {
  const backend = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');
  assert.match(backend, /lerCatalogo\(\).*lerDescontos\(\)/s);
  assert.match(backend, /precoOriginal: preco/);
  assert.match(backend, /precoUnitarioFinal: precoCobrado/);
  assert.match(backend, /promocao\.percentual >= descontoPct/);
  assert.match(backend, /exports\.validarCarrinhoDescontos/);
  assert.match(backend, /if \(_totalCalc === 0\)/);
  assert.match(backend, /pagamento: mpData\.gratuito \? 'gratuito'/);
});

test('vitrine e detalhe exibem selo na imagem somente para desconto calculado', () => {
  const vitrine = fs.readFileSync(path.join(root, 'public/V1.html'), 'utf8');
  const detalhe = fs.readFileSync(path.join(root, 'public/produto.html'), 'utf8');
  assert.match(vitrine, /calcDesc\.descontoPct > 0[\s\S]*badgeHtml = [^;]+% OFF/);
  assert.doesNotMatch(vitrine, /p\.promocao\)\s*\{\s*badgeHtml/);
  assert.match(vitrine, /calcModal\.descontoPct > 0[\s\S]*descontoBadgeHtml/);
  assert.match(detalhe, /id="prod-discount-badge"/);
  assert.match(detalhe, /badge\.style\.display = c\.descontoPct \? 'inline-flex' : 'none'/);
});

test('CRUD administrativo altera desconto por ID em transação no Firebase', () => {
  const backend = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');
  const painel = fs.readFileSync(path.join(root, 'admin/descontos.html'), 'utf8');
  const sync = fs.readFileSync(path.join(root, 'public/js/cloud-sync.js'), 'utf8');
  const trecho = backend.match(/exports\.gerenciarDescontoAdmin[\s\S]*?\n\}\);/)[0];
  assert.match(trecho, /_exigirPermissao\(req, 'descontos'\)/);
  assert.match(trecho, /db\.runTransaction/);
  assert.match(trecho, /lista\.splice\(indice, 1\)/);
  assert.match(trecho, /Desconto não encontrado/);
  assert.match(painel, /cloudfunctions\.net\/gerenciarDescontoAdmin/);
  assert.match(painel, /getIdToken\(true\)/);
  assert.match(painel, /chamarCrudDesconto\('excluir',\{id:id\}/);
  assert.match(sync, /window\.lapinkCloudCache/);
});
