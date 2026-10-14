---
tipo: componente
modulo: backend/functions/notificaciones
estado: listo
fecha: 2026-10-14
tags:
  - capa/backend
  - feature/core
  - servicio/firebase-messaging
---
# Funciones Cloud de notificaciones

Funciones exportadas desde unctions/index.js: calendarPush revisa eventos periódicamente y systemPush reacciona a avisos creados en home/pushAlerts. Helpers resuelven fechas, destinatarios/tokens y envío multicast.

Usa [[Dependencias de Firebase Functions]], [[Configuración Firebase y despliegue]], [[Reglas de Realtime Database]] y tokens que registra [[Registro de push]]. La agenda origen se modela en [[Agenda y calendario]].

#javascript #capa/backend #feature/core #servicio/firebase-messaging