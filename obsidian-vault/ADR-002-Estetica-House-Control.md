---
tipo: adr
modulo: frontend/renderizado
estado: aceptada
fecha: 2026-10-15
tags:
  - proyecto/smart-panel
  - decision/arquitectura
  - frontend/diseño
---

# ADR-002: lenguaje visual inspirado en House Control

## Contexto

El panel tenía una capa Swiss editorial con superficies planas, esquinas cuadradas y acento rojo. El rediseño solicitado toma como referencia House Control (`0xProbabillity/house-control`), cuyo CSS usa un fondo azul-negro, luz ambiental, tarjetas translúcidas de esquinas amplias y acento azul. Smart Panel conserva módulos y navegación existentes.

## Decisión

Adoptar el conjunto de tokens oscuros extraídos de `web/src/style.css` de House Control y crear una contraparte clara compatible con la preferencia de tema ya existente. Mantener las funciones y la marca Smart Panel; mapear luces, pileta/bomba, portón y conectividad a estados semánticos con acentos cálidos, cian y verde.

La navegación y los paneles conservan translucidez y bordes suaves. Para reducir coste gráfico, el desenfoque de fondo queda limitado a la navegación en escritorios con puntero fino; dispositivos táctiles reciben superficies translúcidas sin `backdrop-filter`.

Esta decisión reemplaza visualmente la presentación plana de [[ADR-001-Superficies-sin-desenfoque]]. La decisión anterior sobre rendimiento queda vigente en móvil/tablet y se acota en escritorio por este ADR.

## Consecuencias

- Los tokens persistentes están en `html/css/swiss-ui.css` y `DESIGN.md`.
- El cambio visual no altera los controladores ni el contrato de dispositivos.
- La capa PWA actualiza sus solicitudes CSS mediante estrategia network-first; el tema continúa inicializándose antes de pintar la hoja de estilos.
- Se debe revisar el aspecto en tema claro y oscuro, en móvil y escritorio.
