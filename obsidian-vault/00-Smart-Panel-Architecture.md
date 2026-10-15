---
tipo: arquitectura
modulo: sistema
estado: vigente
fecha: 2026-10-15
tags:
  - proyecto/smart-panel
  - arquitectura/sistema
aliases:
  - Smart Panel Architecture
---

# Smart Panel: arquitectura

Smart Panel combina una interfaz web instalable, servicios Firebase y un gateway ESP32-S3. El navegador sirve los recursos desde `html/`; Firebase Authentication identifica usuarios, Realtime Database transporta estado y órdenes, y el firmware procesa las órdenes permitidas en la red local.

## Interfaz

[[Documento principal HTML]] carga [[Módulo-UI]], [[Temas-CSS]] y [[Lógica de interfaz web]]. La interfaz mantiene una única estructura de paneles y adapta la navegación y las columnas según el ancho disponible. El modo de color se aplica antes de cargar las hojas para evitar mostrar brevemente el tema equivocado.

## Datos, identidad y dispositivo

[[Configuración Firebase web]] inicializa los SDK web. [[Sesión y autenticación]] controla el acceso del panel; [[Reglas de Realtime Database]] delimitan las operaciones de administrador y dispositivo. [[Firmware ESP32 Gateway]] consume órdenes y actualiza el estado reportado. Las credenciales locales del firmware se mantienen fuera del repositorio.

## Instalación y publicación

[[PWA y Service Worker]] describe la instalación y el caché del shell. El service worker precarga los CSS, el inicializador de tema y los scripts versionados, y elimina cachés anteriores al activarse. [[CI-CD y calidad automatizada]] documenta los controles automatizados de cambios.

## Decisiones y mapa

- [[ADR-001-Superficies-sin-desenfoque]] registra la decisión de priorizar superficies planas para dispositivos modestos.
- [[Smart-Panel-Architecture.canvas]] representa el flujo entre interfaz, Firebase y gateway.
- [[Smart-Panel-Modules.base]] reúne las notas de arquitectura y decisiones.

## Notas existentes

[[Arquitectura del proyecto]], [[Frontend web]], [[Navegación y dashboard responsive]], [[Estilos de la interfaz]], [[Aplicación principal app.js]], [[Service Worker web]], [[Configuración Firebase web]], [[Firmware ESP32 Gateway]] y [[CI-CD y calidad automatizada]].

## Archivos fuente

- `html/index.html`
- `html/css/styles.css` y `html/css/swiss-ui.css`
- `html/js/theme-init.js` y `html/js/app.js`
- `html/service-worker.js`
- `esp32_gateway/src/main.cpp`
- `firebase_rules.json`
