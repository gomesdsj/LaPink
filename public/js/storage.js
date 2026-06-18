var STORAGE_CLIENTS_KEY = 'lapinkClients';
var STORAGE_LOGGED_KEY = 'lapinkLoggedClient';

async function hashPassword(password) {
  var encoder = new TextEncoder();
  var data = encoder.encode(String(password));
  var hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function getClients() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CLIENTS_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveClients(clients) {
  try {
    localStorage.setItem(STORAGE_CLIENTS_KEY, JSON.stringify(clients));
  } catch (e) {
    console.warn('LaPink: localStorage indisponível ou cheio.');
  }
}

function getLoggedClient() {
  // Tenta lapinkSession (novo sistema) primeiro
  try {
    var session = JSON.parse(localStorage.getItem('lapinkSession') || 'null');
    if (session && session.name) return session;
  } catch (e) {}
  // Fallback: chave legada lapinkLoggedClient
  try {
    return JSON.parse(localStorage.getItem(STORAGE_LOGGED_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function setLoggedClient(client) {
  try {
    localStorage.setItem(STORAGE_LOGGED_KEY, JSON.stringify(client));
    // Sincroniza com o novo sistema de sessão
    localStorage.setItem('lapinkSession', JSON.stringify({
      email: client.email || '',
      role:  client.role  || 'client',
      name:  client.name  || client.email || ''
    }));
  } catch (e) {
    console.warn('LaPink: localStorage indisponível ou cheio.');
  }
}

function clearLoggedClient() {
  try {
    localStorage.removeItem(STORAGE_LOGGED_KEY);
    localStorage.removeItem('lapinkSession');
  } catch (e) {}
}
