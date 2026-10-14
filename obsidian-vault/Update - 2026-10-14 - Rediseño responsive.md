---
tipo: update
modulo: frontend/ux
estado: listo
fecha: 2026-10-14
tags:
  - tipo/update
  - capa/frontend
  - ux/responsive
---
# Update - Rediseño responsive

Se reordenó la navegación por tamaño de pantalla: rail lateral en escritorio, tabs compactas en tabletas y barra inferior táctil en teléfonos con respeto por safe areas. El dashboard incorpora accesos a Hogar, Pileta y Medios usando la misma activación de secciones.

La implementación conserva IDs de los componentes e interacciones. Las vistas y controles principales permanecen en sus secciones originales; no se duplicó estado para acciones rápidas. Se versionaron los recursos estáticos a v69 para renovar la caché PWA.

Arquitectura: [[Navegación y dashboard responsive]], [[Arquitectura del proyecto]]. Archivos: [[Documento principal HTML]], [[Aplicación principal app.js]], [[Estilos de la interfaz]], [[Service Worker web]].

#tipo/update #capa/frontend #ux/responsive