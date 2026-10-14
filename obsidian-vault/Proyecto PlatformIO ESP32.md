---
tipo: configuracion
modulo: firmware/build
estado: listo
fecha: 2026-10-14
tags:
  - capa/firmware
  - herramienta/platformio
---
# Proyecto PlatformIO ESP32

esp32_gateway/platformio.ini declara plataforma, placa, Arduino, particiones, velocidades serie y dependencias Firebase, ArduinoJson e IRremote ESP8266.

Construye [[Firmware principal main.cpp]] junto a [[Cabecera de configuración ESP32]]. La dependencia funcional Firebase se explica en [[Configuración Firebase y despliegue]].

#ini #capa/firmware #herramienta/platformio