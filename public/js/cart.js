/* LaPink — Carrinho de compras */
var CART_KEY = 'lapinkCart';

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch(e) { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

var CART_MAX_QTY = 99;

// Lê o estoque atual de um produto a partir de lapinkProdutos (null se desconhecido)
function getEstoqueProduto(id) {
  try {
    var arr = JSON.parse(localStorage.getItem('lapinkProdutos') || '[]') || [];
    var p = arr.find(function(x) { return String(x.id) === String(id); });
    return (p && typeof p.estoque !== 'undefined') ? (parseInt(p.estoque) || 0) : null;
  } catch (e) { return null; }
}

// Adiciona ao carrinho respeitando o estoque.
// Retorna { finalQty, added, capped, estoque } para o chamador avisar o cliente.
function addToCart(produto, qty) {
  qty = qty || 1;
  var cart = getCart();
  var estoque = getEstoqueProduto(produto.id);
  var idx = cart.findIndex(function(i) { return String(i.id) === String(produto.id); });
  var atual = idx >= 0 ? cart[idx].qty : 0;
  var desejado = atual + qty;

  var limite = CART_MAX_QTY;
  if (estoque !== null) limite = Math.min(limite, estoque);
  var finalQty = Math.min(desejado, limite);
  var capped = finalQty < desejado;

  if (idx >= 0) {
    cart[idx].qty = finalQty;
  } else {
    cart.push({ id: produto.id, nome: produto.nome, preco: (produto.precoAtacado || produto.precoVarejo), qty: finalQty, imagem: produto.imagem || null });
  }
  saveCart(cart);

  return { finalQty: finalQty, added: finalQty - atual, capped: capped, estoque: estoque };
}

function removeFromCart(id) {
  saveCart(getCart().filter(function(i) { return String(i.id) !== String(id); }));
}

function updateCartItemQty(id, qty) {
  var cart = getCart();
  var idx = cart.findIndex(function(i) { return String(i.id) === String(id); });
  if (idx >= 0) {
    var limite = CART_MAX_QTY;
    var estoque = getEstoqueProduto(id);
    if (estoque !== null) limite = Math.min(limite, estoque);
    cart[idx].qty = Math.min(limite, Math.max(1, qty));
    saveCart(cart);
  }
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  localStorage.removeItem('lapinkCartPayment');
  localStorage.removeItem('lapinkCartShipping');
  updateCartBadge();
}

function getCartTotal() {
  return getCart().reduce(function(s, i) { return s + (i.preco * i.qty); }, 0);
}

function getCartCount() {
  return getCart().reduce(function(s, i) { return s + i.qty; }, 0);
}

function updateCartBadge() {
  var count = getCartCount();
  document.querySelectorAll('.cart-badge').forEach(function(b) {
    b.textContent = count;
    b.style.display = count > 0 ? 'flex' : 'none';
  });
}

document.addEventListener('DOMContentLoaded', updateCartBadge);
