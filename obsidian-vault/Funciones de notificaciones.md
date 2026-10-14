---
tipo: modulo
modulo: backend/notificaciones
estado: listo
fecha: 2026-10-14
tags:
  - capa/backend
  - feature/core
  - servicio/firebase-messaging
---
# Funciones de notificaciones

Archivo unctions/index.js. Configura Firebase Admin y Cloud Messaging; programa recordatorios de agenda y escucha avisos de sistema en Realtime Database. Procesa tokens de registro y limpia tokens inválidos.

Consume eventos y tokens descritos en [[Reglas y datos iniciales Firebase]] y usa Firebase configurado en [[Configuración Firebase y despliegue]]. Los tokens se originan en la integración web [[Configuración Firebase web]]. Forma parte de [[Arquitectura del proyecto]].

#javascript #capa/backend #feature/core #servicio/firebase-messaging
