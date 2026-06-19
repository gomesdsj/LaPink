/* LaPink — Carrinho de compras */
var CART_KEY = 'lapinkCart';

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch(e) { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(produto, qty) {
  qty = qty || 1;
  var cart = getCart();
  var idx = cart.findIndex(function(i) { return i.id === produto.id; });
  if (idx >= 0) {
    cart[idx].qty += qty;
  } else {
    cart.push({ id: produto.id, nome: produto.nome, preco: produto.precoVarejo, qty: qty, imagem: produto.imagem || null });
  }
  saveCart(cart);
}

function removeFromCart(id) {
  saveCart(getCart().filter(function(i) { return i.id !== id; }));
}

function updateCartItemQty(id, qty) {
  var cart = getCart();
  var idx = cart.findIndex(function(i) { return i.id === id; });
  if (idx >= 0) { cart[idx].qty = Math.max(1, qty); saveCart(cart); }
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
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
