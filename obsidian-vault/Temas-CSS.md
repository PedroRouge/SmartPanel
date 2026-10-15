---
tipo: modulo
modulo: frontend/temas
estado: vigente
fecha: 2026-10-15
tags:
  - proyecto/smart-panel
  - capa/frontend
  - componente/temas
---

# Temas CSS

`html/js/theme-init.js` lee primero `smart-panel-theme-v1` de `localStorage`. Si no hay selección guardada, toma `prefers-color-scheme`. Se ejecuta en el `<head>` antes de las hojas de estilo, aplica `data-theme` y ajusta el color del navegador. El botón de tema actualiza la preferencia guardada y su estado accesible.

`html/css/swiss-ui.css` concentra los tokens de superficie, texto, bordes, acento y estados. `:root[data-theme="dark"]` reemplaza esos valores para el tema oscuro; el tema claro es el valor base. `color-scheme` informa al navegador y a los controles nativos.

El Service Worker precarga el inicializador y las dos hojas con la misma versión del HTML. Al activar una versión nueva, elimina cachés antiguas de la aplicación.

La hoja Swiss también evita filtros de desenfoque y sombras heredados para conservar superficies simples en móviles y tabletas de menor potencia. Ver [[Módulo-UI]], [[Service Worker web]] y [[ADR-001-Superficies-sin-desenfoque]].
