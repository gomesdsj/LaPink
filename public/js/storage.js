var STORAGE_CLIENTS_KEY = 'lapinkClients';
var STORAGE_LOGGED_KEY = 'lapinkLoggedClient';

// SHA-256 puro JS — fallback para contextos sem HTTPS (crypto.subtle indisponível)
function _sha256js(str) {
  var K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function R(x,n){return(x>>>n)|(x<<(32-n));}
  var utf=unescape(encodeURIComponent(String(str))),msg=[],i;
  for(i=0;i<utf.length;i++)msg.push(utf.charCodeAt(i));
  var msgLen=msg.length*8;
  msg.push(0x80);
  while(msg.length%64!==56)msg.push(0);
  msg.push(0,0,0,0,(msgLen>>>24)&255,(msgLen>>>16)&255,(msgLen>>>8)&255,msgLen&255);
  var H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  for(var chunk=0;chunk<msg.length;chunk+=64){
    var W=[];
    for(i=0;i<16;i++)W[i]=(msg[chunk+i*4]<<24)|(msg[chunk+i*4+1]<<16)|(msg[chunk+i*4+2]<<8)|msg[chunk+i*4+3];
    for(i=16;i<64;i++){var g0=R(W[i-15],7)^R(W[i-15],18)^(W[i-15]>>>3),g1=R(W[i-2],17)^R(W[i-2],19)^(W[i-2]>>>10);W[i]=(W[i-16]+g0+W[i-7]+g1)>>>0;}
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for(i=0;i<64;i++){var S1=R(e,6)^R(e,11)^R(e,25),ch=(e&f)^(~e&g),T1=(h+S1+ch+K[i]+W[i])>>>0,S0=R(a,2)^R(a,13)^R(a,22),maj=(a&b)^(a&c)^(b&c),T2=(S0+maj)>>>0;h=g;g=f;f=e;e=(d+T1)>>>0;d=c;c=b;b=a;a=(T1+T2)>>>0;}
    H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
  }
  return H.map(function(v){return v.toString(16).padStart(8,'0');}).join('');
}

async function hashPassword(password) {
  var str = String(password);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2,'0'); }).join('');
  }
  return _sha256js(str);
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
