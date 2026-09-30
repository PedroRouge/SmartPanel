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

Al actualizar, copia juntos `index.html`, `css/styles.css` y `js/app.js` a la carpeta que Nginx monta (no solo al workspace local). El encabezado muestra HTML y build real del JS por separado: `JS sin confirmar` significa que el `app.js` desplegado no es esta versión. Reinicia también `server.py` al actualizarlo; el número de API cambia en `/api/health`.

## Clima, TVs y cámaras

Instala el controlador Cast en la notebook Linux con `python3 -m pip install -r requirements.txt` y arranca `server.py` con `python3 server.py`; escucha en `0.0.0.0:5000`. La IP del panel y el puerto `5000` deben ser accesibles desde el iPad/PC. El endpoint `/api/health` informa la versión del backend y `cast_control`; el encabezado del panel muestra por separado las versiones UI y API. Si `cast_control` es `false`, vuelve a instalar los requisitos. Si el navegador dice `API sin respuesta · IP:5000`, comprueba que el proceso esté activo y el puerto permitido por el firewall.

Si el router usa una subred particular, define `TV_SCAN_CIDR=192.168.1.0/24` (cambia el rango por el de tu LAN) antes de arrancar. El escaneo automático asume una red `/24` cuando no se configura. Si ejecutas `server.py` dentro de Docker con red bridge, configura `TV_SCAN_CIDR` con la LAN real y asegúrate de que el contenedor tenga ruta hacia esos dispositivos; para descubrimiento de red local suele ser más sencillo correrlo en el host o usar `network_mode: host` en Linux.

El clima usa Open-Meteo sin clave a través de `/api/weather` en `server.py`, configurado para Colonia Ensayo, Departamento de Diamante, Entre Ríos (`-31.86519, -60.57469`). Ajusta `WEATHER_CONFIG` en `js/app.js` para cambiar la ubicación. Muestra siete días en un carrusel, incluida la probabilidad máxima diaria de precipitación (`precipitation_probability_max`), y renueva los datos cada 30 minutos; tiene timeout, reintento manual y guarda la última respuesta válida en `localStorage`. Si muestra un error HTTP 502, mira `detail`: suele indicar que la notebook no tiene salida a Internet o que Open-Meteo no respondió.

El porcentaje es la probabilidad máxima de precipitación prevista en algún momento de ese día para la celda meteorológica de esas coordenadas; no significa que lloverá durante ese porcentaje del día ni que Google deba mostrar el mismo número. Google y Open-Meteo pueden combinar modelos, estaciones, radar/nowcast, cuadrículas, horarios de actualización y definiciones distintas. La app usa el punto fijo de Colonia Ensayo; el dispositivo de Google puede usar GPS o una zona cercana distinta.

El HTML no depende de un proxy adicional en Nginx para estas rutas: construye la URL del API con el host actual y el puerto `5000`. El servicio Python responde CORS para permitir que el panel estático servido por Nginx le consulte.

La interfaz consulta `GET /api/tvs` en el mismo servidor cada 30 segundos y luego obtiene el estado actual de cada receptor compatible mediante `GET /api/tvs/{id}/status`. El backend intenta obtener el nombre registrado desde Eureka (`/setup/eureka_info`) o el descriptor SSDP (`friendlyName`, modelo y fabricante). Si ninguno responde, conserva una etiqueta basada en la IP. Para actividad prioriza `isActiveInput` y usa standby como respaldo; esos indicadores Cast no garantizan el estado físico del panel de TV. El JSON de estado también incluye volumen y mute. El JSON de dispositivos incluye `openPorts` y `supportsCast`; solo dispositivos con el puerto Cast 8009 accesible habilitan los comandos Cast. Un puerto 8008 por sí solo permite detectar/nombrar el televisor, no garantiza que admita control remoto.

Para usar el botón POWER en ONN Android TV, instala los requisitos y ejecuta `python3 pair_android_tv.py` en el servidor. El asistente detecta equipos con el puerto 6466, muestra el nombre/IP y pide el código de seis caracteres que aparece en el ONN. El emparejamiento queda guardado en `~/.smart-panel/androidtvremote` para el mismo usuario que ejecuta `server.py`; no es necesario repetirlo salvo que se borren esos certificados o cambie la IP del equipo.

```json
[{"id":"living-tv","name":"TV Living","room":"Living","model":"Smart TV","poweredOn":true,"volume":35,"muted":false}]
```

Volumen, mute y apps envían `POST /api/tvs/{id}/command` con JSON `{ "action": "set_volume|toggle_mute|launch_app", "value": 0-100 }` (mute y apps conservan su valor booleano/nombre). El control deslizante manda el volumen al soltarlo y limita los envíos durante el arrastre. Los receptores Cast configurados son Netflix, YouTube, Disney+ y Spotify; Flow y Prime Video devuelven un error explícito hasta configurar/verificar sus IDs de receptor en esos modelos. Apps disponibles y soporte dependen del fabricante y del país.

Las cámaras guardan nombre y URL en `localStorage`, pero nunca usuario ni contraseña. Las credenciales solo viven en memoria hasta recargar. El preview directo está pensado para URLs HTTP/MJPEG sin autenticación; RTSP y cámaras con autenticación necesitan un proxy/gateway local que exponga un stream web compatible, como HLS o WebRTC. Safari no reproduce RTSP directamente.

Luces, motor de pileta y portón también conservan su simulación local. Sustituye las acciones locales por `fetch()` a endpoints de la API cuando conectes los dispositivos; sirve la API desde el mismo origen o habilita CORS en Nginx/backend.