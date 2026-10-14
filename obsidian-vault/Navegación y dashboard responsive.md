---
tipo: diseño
modulo: frontend/ux/responsive
estado: listo
fecha: 2026-10-14
tags:
  - capa/frontend
  - ux/navegacion
  - ux/responsive
---
# Navegación y dashboard responsive

El layout usa una sola navegación semántica, adaptada por breakpoint: barra lateral en pantallas amplias, pestañas horizontales en tabletas y barra inferior con área segura en teléfonos. Las etiquetas visibles permanecen junto a iconos para evitar navegación solo por iconos.

El dashboard conserva componentes existentes y ofrece atajos que activan las mismas secciones, sin duplicar estado ni controles. Las acciones rápidas enlazan [[Controles del hogar]], [[Programación de pileta]] y [[TV y medios]].

Implementación: [[Documento principal HTML]], [[Aplicación principal app.js]] y [[Estilos de la interfaz]]. Estructura general en [[Arquitectura del proyecto]].

#capa/frontend #ux/navegacion #ux/responsive