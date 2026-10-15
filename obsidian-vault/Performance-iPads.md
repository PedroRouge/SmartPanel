---
tipo: modulo
modulo: frontend/performance
estado: vigente
fecha: 2026-10-15
tags:
  - proyecto/smart-panel
  - capa/frontend
  - rendimiento/moviles
aliases:
  - Performance iPads
---

# Rendimiento en iPads y móviles

La interfaz prioriza CSS sencillo y desplazamiento nativo para funcionar en tabletas antiguas y móviles modestos. [[Módulo-UI]] describe los componentes; [[Temas-CSS]] explica las superficies ligeras de los dos temas.

## Decisiones vigentes

- [[ADR-001-Superficies-sin-desenfoque]] elimina blur, `backdrop-filter` y sombras decorativas para reducir trabajo de composición.
- La navegación inferior puede desplazarse horizontalmente en teléfonos angostos y conserva objetivos táctiles de 44 px.
- Los diálogos contienen el desplazamiento para evitar que el gesto táctil se propague a la página.
- Las transiciones usan propiedades concretas y respetan `prefers-reduced-motion`.
- El viewport desactiva el zoom por la preferencia explícita del producto; esto reduce la accesibilidad para quienes necesitan ampliar contenido.

## Verificación disponible

`npm run test:ui` ejecuta Playwright en Chromium y comprueba tema claro/oscuro, navegación y anchos de 320, 768 y 1440 px. La prueba de navegación táctil verifica también los 44 px mínimos y el acceso a la última pestaña mediante desplazamiento.

Estos controles son pruebas de navegador, no mediciones de FPS, memoria o consumo de batería en un iPad físico. La compatibilidad final debe confirmarse con Safari en el dispositivo real y con la red/domótica conectada.

Ver también [[00-Smart-Panel-Architecture]], [[Módulo-UI]] y [[Navegación y dashboard responsive]].
