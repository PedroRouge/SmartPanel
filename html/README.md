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

El clima usa Open-Meteo sin clave y viene configurado con coordenadas de ejemplo de Buenos Aires. Ajusta `WEATHER_CONFIG` en `js/app.js` para tu ubicación. Muestra siete días en un carrusel y renueva los datos cada 30 minutos; tiene timeout de 12 segundos, reintento manual y guarda la última respuesta válida en `localStorage` para mostrarla mientras consulta o si se pierde Internet.

Si aparece `Sin respuesta de red/CORS` en dispositivos de la LAN, comprueba que puedan navegar a `https://api.open-meteo.com`. Si la red bloquea el acceso externo, configura un proxy inverso de Nginx en el mismo origen y cambia la URL de la solicitud en `loadWeather()` para usar ese endpoint local. El timeout ahora hace visible el fallo en lugar de dejar “Consultando” indefinidamente.

La interfaz consulta `GET /api/tvs` en el mismo servidor cada 30 segundos. Sin ese endpoint solo muestra dos TVs de demostración y lo indica; el navegador no puede descubrir televisores de la LAN por sí solo. El backend debe hablar el protocolo del fabricante o integrarse con Home Assistant/otro controlador. Formato esperado:

```json
[{"id":"living-tv","name":"TV Living","room":"Living","model":"Smart TV","poweredOn":true,"volume":35,"muted":false}]
```

Volumen, mute y apps envían `POST /api/tvs/{id}/command` con JSON `{ "action": "set_volume|set_mute|launch_app", "value": 35 }` (para mute el valor es booleano y para abrir app es el nombre de la app). Ajusta `TV_CONFIG.endpoint` en `js/app.js` si tu backend usa otra ruta. Las apps no actúan sobre el TV hasta que el backend implemente esos comandos.

Las cámaras guardan nombre y URL en `localStorage`, pero nunca usuario ni contraseña. Las credenciales solo viven en memoria hasta recargar. El preview directo está pensado para URLs HTTP/MJPEG sin autenticación; RTSP y cámaras con autenticación necesitan un proxy/gateway local que exponga un stream web compatible, como HLS o WebRTC. Safari no reproduce RTSP directamente.

Luces, motor de pileta y portón también conservan su simulación local. Sustituye las acciones locales por `fetch()` a endpoints de la API cuando conectes los dispositivos; sirve la API desde el mismo origen o habilita CORS en Nginx/backend.