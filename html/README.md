# Smart Panel

Panel domótico estático, pensado para una pantalla táctil y compatible con Safari de iOS 12. No requiere build, servidor de desarrollo ni dependencias: Nginx puede servir esta carpeta directamente.

## Estructura

```text
html/
├── index.html       # Vistas de la SPA y estructura accesible
├── css/
│   └── styles.css   # Tema, componentes y diseño responsive
├── js/
│   └── app.js       # Pestañas, reloj, clima y controles locales
├── .gitignore
└── README.md
```

## Despliegue

Configura el `root` de Nginx para apuntar a esta carpeta y abre `index.html` desde el iPad. Por ejemplo, si el volumen Docker monta esta carpeta como `/usr/share/nginx/html`, Nginx servirá el panel en la raíz del sitio. Los cambios de archivos estáticos se aplican al recargar la página.

## Clima e integración

En `js/app.js`, completa `WEATHER_CONFIG.latitude` y `WEATHER_CONFIG.longitude` con coordenadas numéricas para activar el pronóstico de Open-Meteo. El navegador necesita conexión a Internet para esa API; sin coordenadas, el panel muestra un estado pendiente.

Luces, volumen, motor y portón guardan una simulación en `localStorage`; todavía no accionan dispositivos reales. Para conectarlos, sustituye la actualización local de cada control por llamadas `fetch()` a endpoints de la API local. Mantén la API en el mismo origen o habilita CORS en Nginx/backend si utilizas otro.