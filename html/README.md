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

Vercel sirve solamente el contenido estático de `html/`; `vercel.json` no define funciones ni reescrituras de API. También se puede configurar el `root` de Nginx para apuntar a esta carpeta.

La API corre por separado en la notebook con `python servidor.py` y escucha en `0.0.0.0:5000`. Instala sus paquetes con `python -m pip install -r requirements.txt`. El HTML tiene `window.SMART_PANEL_API_URL` configurado a `http://localhost:5000`; cuando el navegador no corre en la notebook, cambia ese valor por una URL alcanzable desde el navegador.

## Clima, TVs y cámaras

El backend de Python sirve `/api/health`, `/api/tvs`, `/api/tvs/{id}/status`, `/api/tvs/{id}/command`, pairing y `/api/weather`.

Como el frontend vive en Vercel y la API en la notebook, el navegador requiere conectividad hacia la notebook y CORS permitido. `servidor.py` responde CORS para `GET`, `POST`, `OPTIONS` y `Content-Type`. Desde la misma notebook se usa `http://localhost:5000`; desde otro dispositivo, `SMART_PANEL_API_URL` debe ser una URL alcanzable. Los navegadores pueden bloquear HTTP desde una página HTTPS; para acceso remoto se necesita una URL HTTPS segura hacia la notebook (por ejemplo, un túnel terminado en la notebook, no en la Onn Box).

El clima consulta Open-Meteo a través de `/api/weather` en la API Python. Ajusta `WEATHER_CONFIG` en `js/app.js` para cambiar ubicación. Muestra siete días y renueva los datos cada 30 minutos; tiene timeout, reintento manual y guarda la última respuesta válida en `localStorage`.

El porcentaje es la probabilidad máxima de precipitación prevista en algún momento de ese día para la celda meteorológica de esas coordenadas; no significa que lloverá durante ese porcentaje del día ni que Google deba mostrar el mismo número. Google y Open-Meteo pueden combinar modelos, estaciones, radar/nowcast, cuadrículas, horarios de actualización y definiciones distintas. La app usa el punto fijo de Colonia Ensayo; el dispositivo de Google puede usar GPS o una zona cercana distinta.

La interfaz consulta la lista de TVs del backend y envía volumen, mute y apps con `POST /api/tvs/{id}/command`. El botón de energía ONN usa el pairing de Android TV Remote implementado en la notebook. Las credenciales de pairing se guardan bajo el usuario que ejecuta `servidor.py`.

Las luces, portón y pileta siguen usando el estado local del navegador; falta un contrato de endpoints para controlarlos desde el puente.

Las cámaras guardan nombre y URL en `localStorage`, pero nunca usuario ni contraseña. Las credenciales solo viven en memoria hasta recargar. Luces, motor de pileta y portón conservan su simulación local.