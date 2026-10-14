---
tipo: arquitectura
modulo: sistema
estado: listo
fecha: 2026-10-14
tags:
  - arquitectura/sistema
  - proyecto/smart-panel
---
# Arquitectura del proyecto

Smart Panel se organiza en una aplicación estática/PWA, funciones serverless Firebase y firmware PlatformIO ESP32-S3. Firebase Realtime Database y Firebase Messaging unen cliente, nube y hardware.

## Flujo web
[[Documento principal HTML]] carga [[Aplicación principal app.js]] y [[Estilos de la interfaz]]. La app se divide en [[Sesión y autenticación]], [[Adaptador de datos Firebase]], [[Agenda y calendario]], [[Clima y pronóstico]], [[Controles del hogar]], [[TV y medios]], [[Cámaras]], [[Programación de pileta]], [[Notificaciones de agenda y sistema]] y [[Registro de push]]. La instalación se organiza en [[PWA y Service Worker]], [[Service Worker web]], [[Manifiesto PWA]] e [[Iconos de instalación PWA]].

## Flujo nube
[[Configuración Firebase web]] establece el cliente. [[Configuración raíz Firebase]] conecta [[Reglas de Realtime Database]] y [[Funciones de entrada index.js]]. [[Funciones Cloud de notificaciones]] procesa agenda y avisos con [[Dependencias de Firebase Functions]]. El frontend se despliega con [[Configuración Vercel]].

## Flujo dispositivo
[[Firmware principal main.cpp]] compone el firmware y usa [[Cabecera de configuración ESP32]]. [[Proyecto PlatformIO ESP32]] define la compilación y librerías. El dispositivo usa la plataforma Firebase y permisos definidos en [[Reglas de Realtime Database]].

## Guías del repositorio
[[Guía web del proyecto]], [[Guía de notificaciones push]] y [[Guía de migración y seguridad]]. La documentación histórica refiere a una API Python que no aparece en el inventario de código actual.

#arquitectura/sistema #proyecto/smart-panel