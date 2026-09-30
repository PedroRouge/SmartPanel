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

## Clima, TVs y cámaras

El clima usa Open-Meteo sin clave y viene configurado con coordenadas de ejemplo de Buenos Aires. Ajusta `WEATHER_CONFIG` en `js/app.js` para tu ubicación; requiere conexión a Internet y se actualiza cada 30 minutos.

La lista `TV_DEVICES` de `js/app.js` es configurable. Volumen y mute se simulan y se guardan por TV; `sendTvAction()` es el punto de integración para una API local. Las apps son acciones simuladas, no abren servicios externos.

Las cámaras guardan nombre y URL en `localStorage`, pero nunca usuario ni contraseña. Las credenciales solo viven en memoria hasta recargar. El preview directo está pensado para URLs HTTP/MJPEG sin autenticación; RTSP y cámaras con autenticación necesitan un proxy/gateway local que exponga un stream web compatible, como HLS o WebRTC. Safari no reproduce RTSP directamente.

Luces, motor de pileta y portón también conservan su simulación local. Sustituye las acciones locales por `fetch()` a endpoints de la API cuando conectes los dispositivos; sirve la API desde el mismo origen o habilita CORS en Nginx/backend.