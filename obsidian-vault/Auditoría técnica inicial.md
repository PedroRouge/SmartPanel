---
tipo: auditoria
modulo: sistema
estado: diagnostico
fecha: 2026-10-14
tags:
  - tipo/auditoria
  - arquitectura/sistema
  - seguridad
  - proyecto/smart-panel
---
# Auditoría técnica inicial — Smart Panel

> [!info] Alcance
> Revisión estática del repositorio presente el 2026-10-14: PWA, Firebase Realtime Database, Cloud Functions y firmware PlatformIO para ESP32-S3. No se ejecutaron compilaciones ni pruebas. Los hallazgos describen el código y la configuración versionados, no el estado efectivo de la consola Firebase ni del dispositivo físico.

## Resumen ejecutivo

La base cubre un flujo funcional completo: interfaz web, sesión, sincronización Firebase, notificaciones push y un gateway ESP32 que traduce comandos a peticiones LAN/IR. La deuda más urgente está en los límites de confianza entre cuentas, Firebase y la red doméstica. Antes de ampliar funciones conviene cerrar esos límites y definir un protocolo de comandos con confirmación física.

**Módulo sugerido para atacar primero:** configuración y autorización de Firebase, junto con el manejo de secretos del firmware. Después, desacoplar y endurecer el protocolo de comandos del gateway. No conviene conectar el hardware real antes de resolver esos dos puntos.

## Hallazgos priorizados

### P0 — Secretos de Wi-Fi y Firebase en configuración versionada

`esp32_gateway/include/config.h` contiene credenciales operativas de Wi-Fi y de una cuenta de Firebase. El archivo está incluido directamente desde `main.cpp`; aunque `.gitignore` menciona `config.local.h`, el firmware no incluye actualmente ese archivo local ni separa valores públicos y privados. Las credenciales que ya llegaron al repositorio deben tratarse como expuestas.

**Impacto:** quien obtenga el repositorio puede intentar acceder a la red local o autenticarse como el gateway. La clave API de Firebase Web es normalmente identificador público, pero la contraseña de la cuenta de servicio embebida sí es secreta.

**Acción:** rotar la contraseña de Firebase del ESP32 y la contraseña Wi-Fi comprometida; revisar el historial y la visibilidad del repositorio. Mover los valores a un archivo local ignorado o a secretos de build, agregar un `config.example.h` sin valores reales y conectar explícitamente esa configuración en el firmware. Separar credenciales por entorno y limitar la cuenta ESP32 a lo estrictamente necesario.

### P0 — Cualquier cuenta autenticada puede controlar actuadores

En `firebase_rules.json`, `home/commands` y `home/tvs` permiten escritura con `auth != null`. `home/state` permite lectura a cualquier cuenta autenticada. Una cuenta de usuario creada o comprometida puede emitir órdenes para luces, bomba, portón y televisores; la interfaz puede ocultar botones, pero las reglas son el control efectivo.

**Impacto:** operación remota de dispositivos físicos y exposición del estado del hogar a cualquier usuario autenticado en el proyecto.

**Acción:** definir roles explícitos (por ejemplo, propietario/controlador y dispositivo), limitar escritura por ruta y validar la forma/rango de cada comando. Revisar además las reglas bajo `users/$uid`, `pushTokens/$uid` y el acceso histórico `home/events` para que cada dato tenga propietario y permisos mínimos. Tratar como sensible cualquier cuenta Firebase Auth actualmente registrada.

### P1 — El estado del portón no confirma posición física

La web escribe `gateOpen` y `gateTrigger`; el firmware acciona un relé de pulso y luego guarda el booleano pedido en `home/state/gateOpen` si la llamada HTTP tuvo éxito. No se ve una entrada de sensor de posición que confirme abierto/cerrado. Además, un portón con relé de pulso suele alternar movimiento y no necesariamente admite una orden «cerrar» equivalente a `gateOpen=false`.

**Impacto:** la interfaz puede anunciar una posición que nunca fue medida, y un fallo de red después del pulso deja incierto el resultado. Es una cuestión de seguridad operacional.

**Acción:** separar `desiredAction` de `reportedState`, modelar respuesta del relé y, cuando exista hardware, incorporar sensor(es) de posición y estados `opening`, `open`, `closing`, `closed`, `unknown` y `fault`. Hasta tener confirmación real, mostrar «pulso enviado / posición desconocida» en lugar de afirmar apertura o cierre.

### P1 — Comandos poco validados y entrega no idempotente

El firmware acepta órdenes de luces, bomba, portón y TV basándose principalmente en timestamps de hasta diez segundos (`main.cpp`, `isCommandFresh`). La comprobación acepta comandos aunque NTP no esté sincronizado. No hay identificador único con acuse persistente ni validación centralizada de `deviceId`, acciones de TV o rangos de volumen; la ruta de acción TV interpola valores en URLs HTTP locales. El callback del stream también realiza lecturas/escrituras Firebase síncronas.

**Impacto:** duplicados durante reconexiones, pérdida o repetición ambigua de órdenes y carga/bloqueo en el flujo que recibe comandos. Un cliente autenticado puede producir mensajes fuera de las acciones previstas por la UI.

**Acción:** contrato versionado con `commandId`, `issuedAt`, `expiresAt`, destino y acción enumerada; validar esquema y rangos tanto en reglas/backend como en firmware; registrar `accepted`, `executing`, `succeeded` o `failed` con el mismo ID; deduplicar en el gateway. Encolar en el callback sin operaciones de red y usar un worker para confirmar/limpiar. Si no hay hora confiable, fallar cerrado o usar un mecanismo de expiración/nonce alternativo.

### P1 — CSP debilitada por scripts inline y orígenes amplios

`vercel.json` permite `'unsafe-inline'` para scripts y estilos, mientras `html/index.html` contiene scripts inline. La política deja `img-src ... *` y `connect-src` habilita varios dominios amplios. Esto reduce cuánto mitiga la CSP frente a inyección y permite cargas externas innecesarias.

**Acción:** mover los dos bloques inline del HTML a archivos locales y retirar `'unsafe-inline'`; reducir `img-src` y `connect-src` a orígenes usados, documentados y necesarios. Mantener la configuración compatible con Firebase y FCM mediante una lista exacta revisada.

### P1 — Recuperación de push puede perder avisos

`functions/index.js` recorre todos los usuarios y eventos cada cinco minutos. Marca cada recordatorio en `pushSent` antes de enviarlo y elimina la marca solo si el envío lanza error. Si la función termina abruptamente tras guardar la marca y antes de mandar, el siguiente ciclo lo considera procesado y no reintenta. El escaneo completo además crece con el total de eventos.

**Acción:** usar una cola/índice por vencimiento o una estrategia incremental; modelar estados de entrega y reintentos con expiración; confirmar la marca después del envío con protección contra concurrencia. Revisar límites, logs y alertas de errores de Functions.

### P2 — `app.js` concentra demasiadas responsabilidades

`html/js/app.js` tiene más de 3.300 líneas y coordina sesión, acceso Firebase/REST, agenda, dispositivos, clima, cámaras, notificaciones, PWA y renderizado dentro de una sola IIFE. Los fallbacks RTDB/HTTPS, intervalos y referencias activas se administran allí mismo.

**Impacto:** cambios de una función pueden alterar otra; cuesta aislar comportamiento, probarlo y entender el ciclo de vida de listeners/timers. Los fallos de conexión duplican rutas de sincronización y dificultan el diagnóstico.

**Acción:** extraer módulos gradualmente por dominio (`auth`, `firebase repository`, `devices/commands`, `agenda`, `notifications`, `weather`, `view`); definir contratos de datos explícitos y centralizar el ciclo de vida/cancelación de listeners, timers y fetches. Mantener primero APIs existentes para que el refactor sea incremental.

### P2 — Datos cacheados locales sin migración ni límites

`readState()` mezcla valores guardados en `localStorage` con defaults sin validar las claves/valores de luces, `tvStates` ni la forma de cámaras. Hay varios formatos/versiones de caché y numerosos `catch` silenciosos. Las cámaras guardan URL de stream local en el navegador, y la agenda/estado local carecen de un contrato común de expiración/versionado.

**Acción:** validar y normalizar cada lectura, versionar esquemas y migraciones, poner límites de tamaño y diferenciar caché obsoleta de estado confirmado. No persistir credenciales de cámara en URLs; mostrar un estado claro si el dato es local o compartido.

### P2 — Despliegue y dependencias con poca reproducibilidad

`functions/package.json` define versiones semver con rangos (`^`) pero no se encuentra un lockfile de Functions en el inventario. La compatibilidad de Firebase SDK aparece duplicada en HTML y Service Worker y depende de actualizar manualmente `APP_BUILD_VERSION`, query strings y nombre de caché en varios archivos.

**Acción:** añadir lockfile reproducible, fijar/automatizar actualización coordinada del SDK y versionado de assets; establecer un flujo de despliegue por entorno con revisión de reglas y secrets antes de publicar.

## Rendimiento y experiencia de uso

- El bundle principal supera 3.300 líneas; dividirlo permitiría cargar bajo demanda secciones menos usadas y reducir el coste inicial de parseo.
- `app.js` establece varios intervalos periódicos y hace sondeos REST cuando RTDB no está conectado. Auditar backoff, solapamiento, cancelación al cerrar sesión y sincronización de pestañas para evitar llamadas repetidas.
- La agenda descarga todos los eventos privados del usuario y vuelve a renderizar calendario, día y próximos eventos cuando cambia el snapshot. Paginar/limitar histórico y actualizar solo las vistas afectadas si el conjunto crece.
- El service worker usa network-first para JS/CSS y guarda la navegación bajo `/`; definir estrategia de actualización offline y verificar que un fallo de `cache.put` no afecte la respuesta de navegación.
- La UI debe representar explícitamente estados «pendiente», «sin conexión», «confirmado por software» y «confirmado por sensor». Evitar estados verdes basados solamente en que una petición HTTP respondió 2xx.
- Las operaciones físicas sensibles necesitan confirmación contextual, bloqueo de doble envío y resultado accesible para lectores de pantalla; revisar especialmente la acción de portón.

## Preparación de la integración ESP32

Antes de recibir la placa, dejar definidos estos límites compartidos:

1. **Contrato de comando** en una nota/esquema común: versión, ID único, origen, destino, acción permitida, payload validado, expiración y estado de ejecución.
2. **Contrato de telemetría**: `deviceId`, versión de firmware, uptime, reloj sincronizado, RSSI, heartbeat, capacidades y marcas de tiempo de estado físico.
3. **Adaptador frontend**: UI envía intención al repositorio de comandos; no escribe paths Firebase ad hoc. El adaptador traduce respuesta/telemetría a estado visual.
4. **Mock determinista**: gateway simulado que acepta, demora, falla y confirma órdenes; permite probar latencia, desconexión, reintentos y estados desconocidos sin la placa.
5. **Entorno de integración**: proyecto Firebase y credenciales separados, reglas restrictivas, datos ficticios y usuarios de prueba por rol.
6. **Inventario de capacidades**: luces, bomba, portón, TV y sensores con acción, protocolo, confirmación real disponible, timeout y comportamiento ante pérdida de red.
7. **Pruebas de contrato** para payloads válidos e inválidos y una guía de puesta en marcha que no dependa de cambiar credenciales en código versionado.

## Deuda menor y limpieza

- `firebase_rules.json` contiene una mezcla de rutas con identidad de correo fija y rutas con UID; normalizar la estrategia para que renombrar cuentas no rompa autorización.
- El fallback de agenda conserva una ruta legacy asociada a un correo concreto; planificar fecha de retiro y migración verificable.
- Revisar mensajes de log y errores REST: incluir contexto útil sin filtrar tokens, credenciales, URL con información privada ni datos de eventos.
- Revisar límites de entrada de título/notas de eventos y formatos en backend. El frontend los presenta con `textContent` en las rutas inspeccionadas, práctica segura que conviene mantener.

## Orden propuesto

1. **Credenciales y reglas Firebase** — rotación de claves expuestas, permisos mínimos y matriz de roles.
2. **Contrato y seguridad de comandos** — IDs, expiración, validación, deduplicación y estados de acuse.
3. **Modelo de feedback de dispositivos** — estado físico medido y comportamiento seguro al fallar, empezando por portón y bomba.
4. **Módulos frontend y adaptadores** — separar sincronización de vistas con comportamiento observable equivalente.
5. **Notificaciones y eficiencia** — corregir ventana de entrega, indexación y reintentos.
6. **Build y operación** — lockfile, entornos, despliegue reproducible, logs y alertas.

## Referencias del repositorio

- [[Reglas de Realtime Database]] y [[Reglas y datos iniciales Firebase]]
- [[Cabecera de configuración ESP32]] y [[Firmware principal main.cpp]]
- [[Adaptador de datos Firebase]] y [[Aplicación principal app.js]]
- [[Funciones Cloud de notificaciones]]
- [[Configuración Vercel]], [[Service Worker web]] y [[Proyecto PlatformIO ESP32]]
- [[Arquitectura del proyecto]]

#tipo/auditoria #arquitectura/sistema #seguridad #proyecto/smart-panel
