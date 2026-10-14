---
tipo: componente
modulo: frontend/hogar/controles
estado: listo
fecha: 2026-10-14
tags:
  - capa/frontend
  - capa/backend
  - feature/core
  - feature/controles-hogar
---
# Controles del hogar

Acciones de html/js/app.js para luces, pileta, portón y comandos físicos disponibles. Los componentes sin endpoint conectado conservan comportamiento local según la documentación actual.

Los comandos del gateway pasan por [[Adaptador de datos Firebase]] y deben respetar [[Reglas de Realtime Database]]. La contraparte de hardware es [[Firmware ESP32 Gateway]]; la interfaz está en [[Documento principal HTML]].

#javascript #capa/frontend #capa/backend #feature/core #feature/controles-hogar