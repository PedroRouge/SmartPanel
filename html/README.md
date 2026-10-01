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

## PWA en iPad

En Safari abre Smart Panel, toca Compartir y elige “Añadir a pantalla de inicio”. El manifiesto y el icono Apple permiten abrirla como app. El Service Worker instala el shell estático versionado, comprueba actualizaciones al abrir la app y recarga cuando activa una versión nueva. No almacena respuestas `/api`, sesiones ni eventos. En Safari 12, cierra y vuelve a abrir la app desde el icono para aplicar una actualización desplegada; si el icono se creó antes de esta versión, elimínalo y añádelo de nuevo una sola vez.

La API corre por separado en la notebook con `python servidor.py` (o mediante Docker con `docker compose up -d`) y escucha en `0.0.0.0:5000`. Instala sus paquetes con `python -m pip install -r requirements.txt`. El frontend apunta al Quick Tunnel actual `https://open-cost-levy-ignored.trycloudflare.com`. El túnel temporal debe seguir activo y dirigir tráfico HTTPS al puerto `5000` de esta notebook; su URL puede cambiar al reiniciarlo.

## Clima, TVs y cámaras

El backend de Python sirve `/api/health`, `/api/tvs`, `/api/tvs/{id}/status`, `/api/tvs/{id}/command`, pairing, `/api/weather` y CRUD de `/api/events`.

### Autenticación con Usuario y Contraseña

El sistema utiliza usuarios con contraseñas hasheadas mediante `scrypt`, almacenadas de forma segura fuera del repositorio en `~/.smart-panel/users.json` (o el volumen `/data` en Docker).

- **Migración automática**: Si ya tenías una clave API en `api_password.txt`, al iniciar `servidor.py` se crea automáticamente el usuario `admin` con esa misma clave, sin interrumpir tu acceso.
- **Crear o cambiar usuarios interactivamente**:
  ```bash
  python manage_users.py set [usuario]
  ```
- **Crear usuarios de forma no interactiva (o en scripts/Docker)**:
  ```bash
  python manage_users.py set admin --password "tu_contraseña_segura"
  ```
- **Listar o eliminar usuarios**:
  ```bash
  python manage_users.py list
  python manage_users.py remove otro_usuario
  ```
- **Ejecución con Docker**:
  ```bash
  docker compose up -d --build
  ```
  Los datos persisten en el volumen `smart-panel-data`. Puedes configurar `SMART_PANEL_ADMIN_USER` y `SMART_PANEL_ADMIN_PASSWORD` en el archivo de entorno o compose.

El token de sesión dura 12 horas y revocar la sesión borra el acceso de inmediato. Se incluye protección contra ataques de fuerza bruta (rate limiting tras varios intentos fallidos por IP).

Como el frontend vive en Vercel y la API en la notebook, el navegador requiere conectividad al túnel y CORS permitido. `servidor.py` responde CORS para `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS` y los encabezados `Authorization` y `Content-Type`. Para cambiar la URL, define `window.SMART_PANEL_API_URL` en `index.html` antes de cargar `js/app.js`. Vercel no expone automáticamente variables de entorno al JavaScript de una web estática; también puede inyectarse ese valor durante un build si luego se incorpora uno.

El clima consulta Open-Meteo a través de `/api/weather` en la API Python. Ajusta `WEATHER_CONFIG` en `js/app.js` para cambiar ubicación. Muestra siete días y renueva los datos cada 30 minutos; tiene timeout, reintento manual y guarda la última respuesta válida en `localStorage`.

El porcentaje es la probabilidad máxima de precipitación prevista en algún momento de ese día para la celda meteorológica de esas coordenadas; no significa que lloverá durante ese porcentaje del día ni que Google deba mostrar el mismo número. Google y Open-Meteo pueden combinar modelos, estaciones, radar/nowcast, cuadrículas, horarios de actualización y definiciones distintas. La app usa el punto fijo de Colonia Ensayo; el dispositivo de Google puede usar GPS o una zona cercana distinta.

La interfaz consulta la lista de TVs del backend y envía volumen, mute, apps y navegación remota con `POST /api/tvs/{id}/command`. El pad direccional usa Android TV Remote y requiere emparejar cada dispositivo desde el botón de energía. Las credenciales de pairing se guardan bajo el usuario que ejecuta `servidor.py`.

Los eventos se guardan en `~/.smart-panel/events.sqlite3` en la notebook y se sincronizan entre navegadores autenticados. La Agenda permite ver el mes, seleccionar un día y crear, editar o eliminar eventos; Inicio muestra los de hoy. La versión inicial no incluye recurrencias ni notificaciones.

Para activar el esquema autenticado, publica primero el frontend actualizado y reinicia después `servidor.py` en la notebook. La versión de API anterior no tiene login y la UI anterior no puede autenticarse. El Quick Tunnel es temporal y el backend controla dispositivos de la casa; usa una clave fuerte y detén el túnel cuando no lo necesites.

Las luces, portón y pileta siguen usando el estado local del navegador; falta un contrato de endpoints para controlarlos desde el puente.

Las cámaras guardan nombre y URL en `localStorage`, pero nunca usuario ni contraseña. Las credenciales solo viven en memoria hasta recargar. Luces, motor de pileta y portón conservan su simulación local.