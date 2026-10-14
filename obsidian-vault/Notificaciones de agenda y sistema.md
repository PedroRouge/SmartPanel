---
tipo: componente
modulo: frontend/notificaciones
estado: listo
fecha: 2026-10-14
tags:
  - capa/frontend
  - capa/backend
  - feature/core
  - feature/notificaciones
---
# Notificaciones de agenda y sistema

html/js/app.js mantiene el panel local de notificaciones, avisos de agenda, insignias y toasts. La entrega nativa en navegador depende de [[Registro de push]].

Los recordatorios del lado servidor están en [[Funciones Cloud de notificaciones]], que consume agenda de [[Agenda y calendario]] vía [[Adaptador de datos Firebase]]. El comportamiento se explica en [[Guía de notificaciones push]].

#javascript #capa/frontend #capa/backend #feature/core #feature/notificaciones