---
tipo: archivo
modulo: firmware/gateway/ejecucion
estado: listo
fecha: 2026-10-14
tags:
  - capa/firmware
  - codigo/cpp
  - dispositivo/esp32-s3
---
# Firmware principal main.cpp

esp32_gateway/src/main.cpp implementa inicialización y ciclo principal del gateway ESP32-S3, conectividad Wi-Fi/Firebase, tareas FreeRTOS, comandos y supervisión.

Incluye [[Cabecera de configuración ESP32]] y se compila con [[Proyecto PlatformIO ESP32]]. Sus interfaces con servicios se describen en [[Configuración Firebase y despliegue]] y [[Reglas de Realtime Database]].

#cpp #capa/firmware #codigo/cpp #dispositivo/esp32-s3