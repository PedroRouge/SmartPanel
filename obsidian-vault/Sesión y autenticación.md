---
tipo: componente
modulo: frontend/seguridad/sesion
estado: listo
fecha: 2026-10-14
tags:
  - capa/frontend
  - capa/backend
  - feature/core
  - seguridad/autenticacion
---
# Sesión y autenticación

initializeAuthentication, cceptSession y los manejadores relacionados en html/js/app.js habilitan el acceso autenticado de usuario, inicializan el SDK y mantienen el estado de sesión.

Depende de [[Configuración Firebase web]] y [[Adaptador de datos Firebase]]. La autorización de datos se aplica en [[Reglas de Realtime Database]]; las notificaciones de usuario se describen en [[Registro de push]].

#javascript #capa/frontend #capa/backend #feature/core #seguridad/autenticacion