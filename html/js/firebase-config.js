// Configuración de Firebase Realtime Database y Auth para Smart Panel
(function () {
  "use strict";

  // Reemplaza estos valores con los de tu consola de Firebase
  // (Firebase Console > Configuración del proyecto > Apps web)
  var DEFAULT_CONFIG = {
    apiKey: "AIzaSy_TU_API_KEY_DE_FIREBASE",
    authDomain: "tu-proyecto-smartpanel.firebaseapp.com",
    databaseURL: "https://tu-proyecto-smartpanel-default-rtdb.firebaseio.com",
    projectId: "tu-proyecto-smartpanel",
    storageBucket: "tu-proyecto-smartpanel.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef123456",
    // Si un usuario ingresa solo "admin", se complementa como "admin@smartpanel.local"
    authDefaultDomain: "smartpanel.local"
  };

  var customConfig = null;
  try {
    var stored = localStorage.getItem("smart-panel-firebase-config");
    if (stored) {
      customConfig = JSON.parse(stored);
    }
  } catch (e) {
    customConfig = null;
  }

  window.SMART_PANEL_FIREBASE_CONFIG = customConfig || window.SMART_PANEL_FIREBASE_CONFIG || DEFAULT_CONFIG;
})();
