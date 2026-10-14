---
tipo: configuracion
modulo: backend/functions/dependencias
estado: listo
fecha: 2026-10-14
tags:
  - capa/backend
  - herramienta/nodejs
  - servicio/firebase-functions
---
# Dependencias de Firebase Functions

unctions/package.json fija runtime Node.js 20 y dependencias irebase-admin y irebase-functions para las funciones del servidor.

Sirve a [[Funciones de entrada index.js]] y [[Funciones Cloud de notificaciones]]. Firebase CLI apunta a este paquete mediante [[Configuración Firebase y despliegue]].

#json #capa/backend #herramienta/nodejs #servicio/firebase-functions