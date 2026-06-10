const STORAGE_CLIENTS_KEY = 'lapinkClients';
const STORAGE_LOGGED_KEY = 'lapinkLoggedClient';

function getClients() {
  return JSON.parse(localStorage.getItem(STORAGE_CLIENTS_KEY) || '[]');
}

function saveClients(clients) {
  localStorage.setItem(STORAGE_CLIENTS_KEY, JSON.stringify(clients));
}

function getLoggedClient() {
  return JSON.parse(localStorage.getItem(STORAGE_LOGGED_KEY) || 'null');
}

function setLoggedClient(client) {
  localStorage.setItem(STORAGE_LOGGED_KEY, JSON.stringify(client));
}

function clearLoggedClient() {
  localStorage.removeItem(STORAGE_LOGGED_KEY);
}
