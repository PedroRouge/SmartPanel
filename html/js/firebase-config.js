// Configuración oficial de Firebase para Smart Panel
(function () {
  "use strict";

  var DEFAULT_CONFIG = {
    apiKey: "AIzaSyAnf7z9wl24JNJgFutE0qRvnnBnquNWoNc",
    authDomain: "smart-panel-53d7b.firebaseapp.com",
    databaseURL: "https://smart-panel-53d7b-default-rtdb.firebaseio.com",
    projectId: "smart-panel-53d7b",
    storageBucket: "smart-panel-53d7b.firebasestorage.app",
    messagingSenderId: "1085885262056",
    appId: "1:1085885262056:web:90373760572ff556f1015d",
    measurementId: "G-Y99C1G3J4F",
    authDefaultDomain: "smartpanel.local"
  };

  // Priorizar configuración si se actualiza dinámicamente
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
