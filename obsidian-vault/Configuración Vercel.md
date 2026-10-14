---
tipo: configuracion
modulo: plataforma/frontend-deploy
estado: listo
fecha: 2026-10-14
tags:
  - capa/frontend
  - entorno/despliegue
  - seguridad/csp
---
# Configuración Vercel

ercel.json publica html/ como salida estática y establece headers de seguridad, CSP, framing y referrer policy.

Despliega [[Frontend web]] y habilita dependencias externas declaradas por [[Configuración Firebase web]] y [[Clima y pronóstico]]. Enlace global: [[Configuración Firebase y despliegue]].

#json #capa/frontend #entorno/despliegue #seguridad/csp