// Configuração do Firebase — LaPink
var FIREBASE_CONFIG = {
  apiKey:            'AIzaSyD-n8uEdk05tTy40_dOF3HivdGk6aUKPDM',
  authDomain:        'lapink-82a39.firebaseapp.com',
  projectId:         'lapink-82a39',
  storageBucket:     'lapink-82a39.firebasestorage.app',
  messagingSenderId: '217126804240',
  appId:             '1:217126804240:web:e61b9c47e5d8a36b39a395'
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}
