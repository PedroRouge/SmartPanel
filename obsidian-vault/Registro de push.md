---
tipo: componente
modulo: frontend/notificaciones/push
estado: listo
fecha: 2026-10-14
tags:
  - capa/frontend
  - capa/backend
  - feature/core
  - servicio/firebase-messaging
---
# Registro de push

El subsistema de push de html/js/app.js solicita permiso, obtiene token FCM, asocia el dispositivo al usuario y gestiona su baja/estado. Requiere HTTPS, SDK Firebase Messaging y Service Worker.

Depende de [[Configuración Firebase web]], [[PWA y Service Worker]], [[Adaptador de datos Firebase]] y [[Reglas de Realtime Database]]. Recibe mensajes procesados por [[Funciones Cloud de notificaciones]]; instrucciones: [[Guía de notificaciones push]].

#javascript #capa/frontend #capa/backend #feature/core #servicio/firebase-messaging