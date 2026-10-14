# Guía de Migración y Seguridad: Smart Panel a Firebase + ESP32-S3

Este documento detalla la configuración paso a paso con **autenticación estricta y segura** para proteger tu red local y todos los datos de tu hogar.

---

## 1. Firebase (Consola de Google)

### A. Habilitar Firebase Authentication (Seguridad de Acceso)
1. En la [Consola de Firebase](https://console.firebase.google.com/), entra a tu proyecto.
2. En el menú izquierdo ve a **Build > Authentication** y haz clic en **Comenzar**.
3. En la pestaña **Sign-in method** (Método de inicio de sesión), haz clic en **Correo electrónico/Contraseña** (Email/Password) y **Habilítalo**.
4. En la pestaña **Users** (Usuarios), haz clic en **Agregar usuario**:
   - **Usuario para ti (Web/Vercel)**:
     - Usa el correo exacto con el que vas a iniciar sesión en todos tus dispositivos. Puedes ingresar el correo completo o el nombre `admin` si esa cuenta se creó como `admin@smartpanel.local`.
     - Contraseña: Tu clave secreta y segura (mínimo 6 caracteres).
   - **Usuario para la placa ESP32-S3**:
     - Correo: `esp32@smartpanel.local`
     - Contraseña: `clave_segura_esp32_123` (o la que elijas en `config.h`).

---

### B. Configurar Realtime Database con Reglas Cerradas
1. Ve a **Build > Realtime Database**.
2. **Importar Árbol de Datos**:
   - En la pestaña **Datos**, toca el menú de tres puntos (`⋮`) arriba a la derecha.
   - Selecciona **Importar JSON** y sube el archivo [firebase_initial_data.json](file:///c:/Panel%20de%20control/firebase_initial_data.json).
3. **Aplicar reglas de seguridad**:
   - En la pestaña **Reglas**, pega el contenido completo de [firebase_rules.json](file:///c:/Panel%20de%20control/firebase_rules.json) y pulsa **Publicar**. También puedes ejecutar `firebase deploy --only database` desde la raíz del repositorio.
   - No uses reglas genéricas `.read: "auth != null"` y `.write: "auth != null"` en la raíz. La agenda y los tokens quedan bajo el UID autenticado, y el ESP32 mantiene su acceso de servicio.

---

### C. Obtener Credenciales Web
1. Ve al icono de engranaje (**Configuración del proyecto**) > pestaña **General**.
2. Abajo en "Tus apps", selecciona la app web (`</>`) y copia tu `apiKey` y `databaseURL`.

---

## 2. Frontend en Vercel

1. Abre el archivo [html/js/firebase-config.js](file:///c:/Panel%20de%20control/html/js/firebase-config.js):
   - Reemplaza `apiKey` y `databaseURL` con tus credenciales de Firebase.
2. Al abrir la web (en local o en Vercel):
   - Te aparecerá la pantalla de **Sesión Segura**.
   - Ingresa con `admin` (o tu email) y la contraseña que creaste en el paso 1A.
   - Una vez autenticado, el panel cargará todos los datos en tiempo real y el botón "Cerrar sesión" te permitirá desloguearte en cualquier momento.
   - En Firebase Authentication > Settings > Authorized domains agrega `smart-panel-beryl.vercel.app`; sin esa autorización Firebase bloquea el inicio de sesión desde Vercel.
   - La agenda queda guardada en `users/{uid}/events`, por lo que al iniciar sesión con la misma cuenta en otro dispositivo aparecerán los mismos eventos. Los eventos antiguos del usuario `pedrorouge2022@gmail.com` se copian automáticamente desde `home/events` al iniciar sesión por primera vez después de actualizar reglas.

---

## 3. Microcontrolador ESP32-S3 (PlatformIO)

El firmware se encuentra en [esp32_gateway/](file:///c:/Panel%20de%20control/esp32_gateway).

1. Abre [esp32_gateway/include/config.h](file:///c:/Panel%20de%20control/esp32_gateway/include/config.h):
   - Coloca tu **SSID y contraseña de Wi-Fi**.
   - Coloca tu `FIREBASE_API_KEY` y `FIREBASE_DATABASE_URL`.
   - Verifica que `FIREBASE_USER_EMAIL` y `FIREBASE_USER_PASSWORD` coincidan con el usuario creado para la placa en el paso 1A.
   - Configura las **IPs locales de tus enchufes y switches inteligentes** en `SMART_LIGHTS`, la pileta en `POOL_RELAY_IP` y el portón en `GATE_RELAY_IP`.
2. Conecta el **ESP32-S3** por USB a tu computadora.
3. En PlatformIO (VS Code), pulsa **Upload (→)**.
4. Abre el **Monitor Serial (115200 baudios)**:
   - Verás la conexión a tu Wi-Fi, la validación del Token JWT en Firebase Auth, y la suscripción en tiempo real al Stream.
