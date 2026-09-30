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

Arranca `server.py` en la notebook Linux con `python3 server.py`; escucha en `0.0.0.0:5000`. La IP del panel y el puerto `5000` deben ser accesibles desde el iPad/PC. El endpoint `/api/health` informa la versión del backend; el encabezado del panel muestra por separado la versión UI y API. Si el navegador dice `API sin respuesta · IP:5000`, comprueba que el proceso esté activo y el puerto permitido por el firewall.

Si el router usa una subred particular, define `TV_SCAN_CIDR=192.168.1.0/24` (cambia el rango por el de tu LAN) antes de arrancar. El escaneo automático asume una red `/24` cuando no se configura. Si ejecutas `server.py` dentro de Docker con red bridge, configura `TV_SCAN_CIDR` con la LAN real y asegúrate de que el contenedor tenga ruta hacia esos dispositivos; para descubrimiento de red local suele ser más sencillo correrlo en el host o usar `network_mode: host` en Linux.

El clima usa Open-Meteo sin clave a través de `/api/weather` en `server.py`, con coordenadas de ejemplo de Buenos Aires. Ajusta `WEATHER_CONFIG` en `js/app.js` para tu ubicación. Muestra siete días en un carrusel y renueva los datos cada 30 minutos; tiene timeout, reintento manual y guarda la última respuesta válida en `localStorage`. Si muestra un error HTTP 502, mira `detail`: suele indicar que la notebook no tiene salida a Internet o que Open-Meteo no respondió.

El HTML no depende de un proxy adicional en Nginx para estas rutas: construye la URL del API con el host actual y el puerto `5000`. El servicio Python responde CORS para permitir que el panel estático servido por Nginx le consulte.

La interfaz consulta `GET /api/tvs` en el mismo servidor cada 30 segundos. Sin ese endpoint solo muestra dos TVs de demostración y lo indica; el navegador no puede descubrir televisores de la LAN por sí solo. El backend debe hablar el protocolo del fabricante o integrarse con Home Assistant/otro controlador. Formato esperado:

```json
[{"id":"living-tv","name":"TV Living","room":"Living","model":"Smart TV","poweredOn":true,"volume":35,"muted":false}]
```

Volumen, mute y apps envían `POST /api/tvs/{id}/command` con JSON `{ "action": "set_volume|set_mute|launch_app", "value": 35 }` (para mute el valor es booleano y para abrir app es el nombre de la app). Ajusta `TV_CONFIG.endpoint` en `js/app.js` si tu backend usa otra ruta. Las apps no actúan sobre el TV hasta que el backend implemente esos comandos.

Las cámaras guardan nombre y URL en `localStorage`, pero nunca usuario ni contraseña. Las credenciales solo viven en memoria hasta recargar. El preview directo está pensado para URLs HTTP/MJPEG sin autenticación; RTSP y cámaras con autenticación necesitan un proxy/gateway local que exponga un stream web compatible, como HLS o WebRTC. Safari no reproduce RTSP directamente.

Luces, motor de pileta y portón también conservan su simulación local. Sustituye las acciones locales por `fetch()` a endpoints de la API cuando conectes los dispositivos; sirve la API desde el mismo origen o habilita CORS en Nginx/backend.