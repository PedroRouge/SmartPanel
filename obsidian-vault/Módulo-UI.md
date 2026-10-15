---
tipo: modulo
modulo: frontend/ui
estado: vigente
fecha: 2026-10-15
tags:
  - proyecto/smart-panel
  - capa/frontend
  - componente/ui
---

# Módulo UI

`html/index.html` contiene las vistas, navegación por pestañas, controles y puntos de montaje. `html/js/app.js` inicializa las interacciones y conecta los componentes con autenticación, Firebase y capacidades del navegador. Los paneles se muestran dentro de una estructura común, y el CSS cambia columnas y navegación en puntos de corte responsive.

La hoja `html/css/styles.css` conserva estilos de componentes y compatibilidad existente. `html/css/swiss-ui.css` aplica la dirección visual Swiss: tipografía sans del sistema, superficies planas, reglas finas y un acento rojo. Esta hoja se carga después de los estilos heredados.

Se priorizan controles táctiles de al menos 44 px donde corresponde, áreas seguras del dispositivo, foco visible y respeto por `prefers-reduced-motion`. La hoja Swiss desactiva sombras y filtros de desenfoque heredados, incluidos los avisos y la navegación móvil.

Ver [[Temas-CSS]], [[Navegación y dashboard responsive]] y [[Estilos de la interfaz]]. La entrada general está en [[00-Smart-Panel-Architecture]].
