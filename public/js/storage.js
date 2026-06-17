var STORAGE_CLIENTS_KEY = 'lapinkClients';
var STORAGE_LOGGED_KEY = 'lapinkLoggedClient';

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
  try {
    return JSON.parse(localStorage.getItem(STORAGE_LOGGED_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function setLoggedClient(client) {
  try {
    localStorage.setItem(STORAGE_LOGGED_KEY, JSON.stringify(client));
  } catch (e) {
    console.warn('LaPink: localStorage indisponível ou cheio.');
  }
}

function clearLoggedClient() {
  try {
    localStorage.removeItem(STORAGE_LOGGED_KEY);
  } catch (e) {}
}
