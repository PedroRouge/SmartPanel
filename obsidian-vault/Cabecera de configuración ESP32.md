---
tipo: archivo
modulo: firmware/gateway/configuracion
estado: listo
fecha: 2026-10-14
tags:
  - capa/firmware
  - seguridad/configuracion
  - dispositivo/esp32-s3
---
# Cabecera de configuración ESP32

esp32_gateway/include/config.h aporta parámetros de compilación para el firmware. Un archivo local opcional config.local.h está excluido de Git para poder personalizar secretos localmente.

Se incluye desde [[Firmware principal main.cpp]] y usa dependencias declaradas en [[Proyecto PlatformIO ESP32]]. Conexión de sistema: [[Configuración Firebase y despliegue]].

#cpp #capa/firmware #seguridad/configuracion #dispositivo/esp32-s3