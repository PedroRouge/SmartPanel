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
     - Correo: `admin@smartpanel.local` (o tu email personal ej. `tuemail@gmail.com`).
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
3. **Aplicar Reglas de Seguridad Protegidas**:
   - En la pestaña **Reglas**, pega el contenido de [firebase_rules.json](file:///c:/Panel%20de%20control/firebase_rules.json):
     ```json
     {
       "rules": {
         ".read": "auth != null",
         ".write": "auth != null"
       }
     }
     ```
   - Haz clic en **Publicar**.
   - *A partir de este momento, cualquier persona sin usuario y contraseña válidos tiene denegado el acceso al 100% de la base de datos.*

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
