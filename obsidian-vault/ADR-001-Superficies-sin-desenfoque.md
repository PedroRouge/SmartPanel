---
tipo: adr
modulo: frontend/renderizado
estado: aceptada
fecha: 2026-10-15
tags:
  - proyecto/smart-panel
  - decision/arquitectura
  - rendimiento/frontend
---

# ADR-001: superficies sin desenfoque

## Contexto

Las hojas heredadas aplicaban `backdrop-filter: blur(...)` a avisos, navegación móvil y paneles flotantes. Aunque la capa Swiss ya quitaba varios filtros, no cubría todos los selectores. Esto dejaba efectos costosos activos en dispositivos de baja potencia y hacía inconsistente el lenguaje visual plano.

## Decisión

La hoja `html/css/swiss-ui.css`, cargada después de los estilos heredados, establece `backdrop-filter: none` y `-webkit-backdrop-filter: none` en los elementos de la UI. Mantiene el lenguaje visual con superficies opacas y bordes de un píxel. Las sombras también permanecen desactivadas por esa misma capa.

## Verificación

Una prueba Playwright comprueba el valor calculado de filtro en la navegación móvil, los avisos, el panel de notificaciones y un fondo modal. La prueba primero detectó el `blur(18px)` del aviso y pasó después del cambio.

## Consecuencias

Los fondos ya no difuminan el contenido detrás de ellos. El contraste y la jerarquía dependen de color, borde y espaciado; los componentes conservan sus transiciones de color y estados funcionales.

Relacionado: [[Módulo-UI]], [[Temas-CSS]] y [[00-Smart-Panel-Architecture]].
