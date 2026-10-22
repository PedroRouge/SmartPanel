# Smart Panel

Panel domótico estático, pensado para una pantalla táctil y compatible con Safari de iOS 12. No requiere build, servidor de desarrollo ni dependencias: Nginx o Vercel pueden servir esta carpeta directamente.

## Arquitectura

El sistema es totalmente serverless y no necesita ninguna PC encendida:

```text
Navegador (PWA en Vercel)  ──►  Firebase (Auth + Realtime Database + FCM)
                                        ▲
                                        │  WiFi, comandos y estados
                                   ESP32-S3 (firmware)
                                        │
                                   Relés y Android TV (LAN)
```

- El navegador escribe órdenes en Firebase Realtime Database y escucha el estado publicado por la placa.
- El ESP32 se autentica con una cuenta de servicio de rol `device`, se suscribe a `/home/commands` y ejecuta las órdenes.
- La placa publica el resultado en `/home/state` y su estado de vida en `/home/gateway/status`.
- No hay API local, ni túnel, ni puerto serie en el camino de producción.

## Estructura

```text
html/
├── index.html          # Vistas de la SPA y estructura accesible
├── css/styles.css      # Tema, componentes y diseño responsive
├── js/app.js           # Pestañas, reloj, clima y control vía Firebase
├── js/firebase-runtime-config.js  # Config pública generada en el build
├── service-worker.js   # Shell estático versionado
└── README.md
```

## Despliegue

Vercel sirve solamente el contenido estático de `html/`; `vercel.json` no define funciones ni reescrituras de API. El pipeline de GitHub Actions genera `html/js/firebase-runtime-config.js` con las variables `FIREBASE_WEB_API_KEY` y `FIREBASE_WEB_VAPID_KEY` antes del build y despliega las reglas de base de datos verificadas con el emulador.

## Autenticación

Firebase Authentication con correo y contraseña. La sesión se conserva con `Persistence.SESSION` y los roles viajan en los custom claims: `admin` para el panel web y `device` para el ESP32. Las reglas de `firebase_rules.json` solo permiten escribir en las rutas de estado al dispositivo con UID conocido y a los administradores en sus propias rutas de usuario.

## PWA en iPad

En Safari abre Smart Panel, toca Compartir y elige “Añadir a pantalla de inicio”. El manifiesto y el icono Apple permiten abrirla como app. El Service Worker instala el shell estático versionado, comprueba actualizaciones al abrir la app y recarga cuando activa una versión nueva. No almacena respuestas de la API, sesiones ni eventos. En Safari 12, cierra y vuelve a abrir la app desde el icono para aplicar una actualización desplegada; si el icono se creó antes de esta versión, elimínalo y añádelo de nuevo una sola vez.

## Clima

La app consulta Open-Meteo directamente desde el navegador. Ajusta `WEATHER_CONFIG` en `js/app.js` para cambiar ubicación. Muestra siete días y renueva los datos cada 30 minutos; tiene timeout, reintento manual y guarda la última respuesta válida en `localStorage`.

El porcentaje es la probabilidad máxima de precipitación prevista en algún momento de ese día para la celda meteorológica de esas coordenadas; no significa que lloverá durante ese porcentaje del día ni que Google deba mostrar el mismo número. Google y Open-Meteo pueden combinar modelos, estaciones, radar/nowcast, cuadrículas, horarios de actualización y definiciones distintas. La app usa el punto fijo de Colonia Ensayo; el dispositivo de Google puede usar GPS o una zona cercana distinta.

## Televisores

El ESP32 habla directamente con cada Android TV por mTLS en el puerto 6466 con el protocolo Android TV Remote v2. El emparejamiento y los certificados se aprovisionan una sola vez desde una PC con `tools/android_tv_pairing/pair_android_tv.py` y `scripts/export_tv_certs.py`; después la placa trabaja sola por WiFi. La web solo publica órdenes en `/home/commands/tv` y muestra el estado que devuelve la placa.

## Agenda y notificaciones

Los eventos de la agenda viven en `users/<uid>/events` dentro de Firebase y se sincronizan entre navegadores autenticados. La Agenda permite ver el mes, seleccionar un día y crear, editar o eliminar eventos, con soporte de repeticiones semanales y mensuales. Las notificaciones push programadas salen del worker de Google Apps Script descrito en `PUSH_NOTIFICATIONS.md`; el panel también avisa en primer plano cuando la app está abierta.

## Cámaras

Las cámaras guardan nombre y URL en `localStorage`, pero nunca usuario ni contraseña. Las credenciales solo viven en memoria hasta recargar.
