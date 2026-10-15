// Configuración oficial de Firebase para Smart Panel
(function () {
  "use strict";

  var DEFAULT_CONFIG = Object.assign({
    apiKey: "",
    authDomain: "smart-panel-53d7b.firebaseapp.com",
    databaseURL: "https://smart-panel-53d7b-default-rtdb.firebaseio.com",
    projectId: "smart-panel-53d7b",
    storageBucket: "smart-panel-53d7b.firebasestorage.app",
    messagingSenderId: "1085885262056",
    appId: "1:1085885262056:web:90373760572ff556f1015d",
    measurementId: "G-Y99C1G3J4F",
    vapidKey: "",
    authDefaultDomain: "smartpanel.local"
  }, window.SMART_PANEL_FIREBASE_RUNTIME_CONFIG || {});

  // Priorizar configuración si se actualiza dinámicamente, validando el dominio
  var customConfig = null;
  try {
    var stored = localStorage.getItem("smart-panel-firebase-config");
    if (stored) {
      var parsed = JSON.parse(stored);
      // Validar que apiKey exista y databaseURL apunte estrictamente a Firebase
      if (parsed && typeof parsed.apiKey === "string" && parsed.apiKey.length > 10 &&
          typeof parsed.databaseURL === "string" &&
          /^https:\/\/[a-z0-9-]+\.(firebaseio\.com|firebasedatabase\.app)$/i.test(parsed.databaseURL)) {
        customConfig = parsed;
      } else {
        console.warn("[Firebase Config] Configuración personalizada en localStorage inválida o insegura. Descartada.");
        localStorage.removeItem("smart-panel-firebase-config");
      }
    }
  } catch (e) {
    customConfig = null;
  }

  window.SMART_PANEL_FIREBASE_CONFIG = Object.assign(
    {},
    DEFAULT_CONFIG,
    window.SMART_PANEL_FIREBASE_CONFIG || {},
    customConfig || {}
  );

})();
