---
tipo: componente
modulo: backend/notificaciones
estado: reemplazado
fecha: 2026-10-15
tags:
  - capa/backend
  - feature/core
  - servicio/firebase-messaging
---
# Funciones Cloud de notificaciones

La versión basada en Cloud Functions fue retirada porque el proyecto no usará facturación. El envío programado gratuito usa Apps Script cada cinco minutos y Firebase Cloud Messaging; el setup está en [[Guía de notificaciones push]].

Los avisos locales dentro de la PWA siguen activos aunque el worker remoto no esté configurado.

#capa/backend #feature/core #servicio/firebase-messaging
