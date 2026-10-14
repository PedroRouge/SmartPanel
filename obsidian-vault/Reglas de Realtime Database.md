---
tipo: configuracion
modulo: backend/firebase/seguridad
estado: listo
fecha: 2026-10-14
tags:
  - capa/backend
  - feature/core
  - seguridad/autorizacion
---
# Reglas de Realtime Database

irebase_rules.json limita accesos por usuario autenticado y contempla estado/commands del gateway, agenda, tokens push y marcas de envío.

Autoriza accesos de [[Sesión y autenticación]], [[Adaptador de datos Firebase]], [[Funciones Cloud de notificaciones]] y [[Firmware principal main.cpp]]. Se publica con [[Configuración raíz Firebase]]. Datos de referencia: [[Datos iniciales Firebase]].

#json #capa/backend #feature/core #seguridad/autorizacion