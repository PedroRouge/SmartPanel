#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <esp_task_wdt.h>
#include <time.h>

#include "config.h"

// =========================================================================
// WATCHDOG
// =========================================================================
#define WDT_TIMEOUT_SECONDS 30  // 30 s — suficiente para cubrir reintentos

// =========================================================================
// OBJETOS FIREBASE
// =========================================================================
FirebaseData streamData;
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// =========================================================================
// FREERTOS: COLA DE COMANDOS (Core 0 recibe → Core 1 ejecuta)
//
// Hallazgo Crítico 1 resuelto:
//   Core 0 → Wi-Fi + Stream Firebase (nunca bloqueado)
//   Core 1 → Worker que despacha HTTP local + IR (puede bloquearse sin problema)
// =========================================================================
#define CMD_QUEUE_SIZE 16  // máx. comandos pendientes simultáneos

// Tipos de comando
enum CmdType {
    CMD_LIGHT,
    CMD_POOL,
    CMD_GATE,
    CMD_TV
};

struct Command {
    CmdType   type;
    char      deviceId[32];   // luz: "living", TV: "tv-pedro", etc.
    char      action[32];     // TV: "power", "set_volume", etc.
    char      value[32];      // TV: valor numérico o clave de app
    bool      boolParam;      // luces, pileta, portón
    long long timestamp;      // timestamp Unix ms del comando (de Firebase)
    char      sourcePath[96]; // nodo que se limpia al terminar el despacho
};

QueueHandle_t cmdQueue;

// =========================================================================
// VARIABLES DE CONTROL
// =========================================================================
unsigned long lastHeartbeat   = 0;
const unsigned long HEARTBEAT_INTERVAL    = 15000;  // 15 s
unsigned long lastStreamCheck = 0;
const unsigned long STREAM_CHECK_INTERVAL = 30000;  // 30 s
bool streamSubscribed = false;

// =========================================================================
// PROTOTIPOS
// =========================================================================
void initWiFi();
void initFirebase();
void initNTP();
void sendHeartbeat();
void checkStreamHealth();
bool executeHttpLocalCommand(const String& url);
bool isPrivateLanUrl(const String& url);
void handleLightCommand(const String& lightName, bool targetState);
void handlePoolCommand(bool targetState);
void handleGateCommand(long long commandTimestamp);
void handleTvCommand(const String& targetId, const String& action, const String& value);
void workerTask(void* param);
void streamCallback(FirebaseStream data);
void streamTimeoutCallback(bool timeout);
bool isCommandFresh(long long cmdTimestampMs);
bool isValidTvCommand(const String& targetId, const String& action, const String& value);
void clearExecutedCommand(const String& path);

// =========================================================================
// SETUP — Corre en Core 1 por defecto en Arduino-ESP32
// =========================================================================
void setup() {
    Serial.begin(115200);
    delay(800);

    // ESP32-S3-DevKitC-1 v1.1 onboard addressable RGB LED (GPIO38).
    // Keep the fixed 3.3 V power indicator untouched.
    neopixelWrite(38, 0, 0, 64);

    Serial.println("\n==================================================");
    Serial.println("  SMART PANEL - GATEWAY IOT LOCAL (ESP32-S3)     ");
    Serial.println("  Arquitectura: Dual-Core FreeRTOS + Firebase     ");
    Serial.println("==================================================");

    // 1. Hardware Watchdog (reset automático si el firmware se cuelga)
    esp_task_wdt_init(WDT_TIMEOUT_SECONDS, true);
    esp_task_wdt_add(NULL);

    // 2. Cola de comandos (comunicación inter-núcleo)
    cmdQueue = xQueueCreate(CMD_QUEUE_SIZE, sizeof(Command));
    if (!cmdQueue) {
        Serial.println("[FreeRTOS] ERROR CRÍTICO: No se pudo crear la cola de comandos.");
    }

    // 4. Crear tarea Worker en Core 0
    //    (loop() y el stream de Firebase corren en Core 1)
    xTaskCreatePinnedToCore(
        workerTask,    // función
        "CMD_WORKER",  // nombre
        8192,          // stack (8 KB)
        NULL,          // parámetros
        1,             // prioridad
        NULL,          // handle
        0              // Core 0
    );

    // 5. Wi-Fi
    initWiFi();

    // 6. NTP (para validar timestamps de comandos)
    initNTP();

    // 7. Firebase
    initFirebase();

    Serial.println("[Sistema] Gateway iniciado. Escuchando comandos...\n");
}

// =========================================================================
// LOOP — Corre en Core 1 (Arduino default)
// Responsabilidad: Wi-Fi keepalive, Heartbeat, health check del Stream.
// NUNCA hace operaciones HTTP bloqueantes aquí.
// =========================================================================
void loop() {
    // Alimentar Watchdog
    esp_task_wdt_reset();

    // Auto-reconexión Wi-Fi
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[Wi-Fi] Conexión perdida. Reconectando...");
        WiFi.reconnect();
        delay(3000);
        return;
    }

    unsigned long now = millis();

    // Heartbeat periódico a Firebase
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL || lastHeartbeat == 0) {
        lastHeartbeat = now;
        sendHeartbeat();
    }

    // Verificación de salud del Stream
    if (now - lastStreamCheck >= STREAM_CHECK_INTERVAL) {
        lastStreamCheck = now;
        checkStreamHealth();
    }

    delay(20);
}

// =========================================================================
// TAREA WORKER (Core 0) — Despacha peticiones HTTP sin bloquear el stream
// =========================================================================
void workerTask(void* param) {
    Command cmd;
    for (;;) {
        // Esperar hasta 100 ms por un comando en la cola
        if (xQueueReceive(cmdQueue, &cmd, pdMS_TO_TICKS(100)) == pdTRUE) {
            if (cmd.timestamp <= 0 && (cmd.type == CMD_LIGHT || cmd.type == CMD_POOL)) {
                FirebaseData tsData;
                if (Firebase.RTDB.get(&tsData, "/home/commands/timestamp")) {
                    cmd.timestamp = tsData.to<long long>();
                }
            }
            if (!isCommandFresh(cmd.timestamp)) {
                Serial.println("[Worker] Comando vencido o sin hora confiable; descartado.");
                if (cmd.timestamp > 0 && cmd.sourcePath[0] != '\0') { clearExecutedCommand(String(cmd.sourcePath)); }
                continue;
            }
            if (cmd.sourcePath[0] != '\0') {
                String receiptKey = String(cmd.sourcePath);
                receiptKey.replace("/", "_");
                String receiptPath = "/home/state/commandReceipts/" + receiptKey;
                FirebaseData receiptData;
                bool receiptFound = Firebase.RTDB.get(&receiptData, receiptPath.c_str());
                if (receiptFound && receiptData.to<double>() >= (double)cmd.timestamp) {
                    clearExecutedCommand(String(cmd.sourcePath));
                    Serial.println("[Worker] Comando duplicado; ya tiene recibo.");
                    continue;
                }
                if (!receiptFound && receiptData.httpCode() != 404) {
                    Serial.printf("[Worker] No se pudo verificar el recibo (%d); comando no ejecutado.\n", receiptData.httpCode());
                    continue;
                }
                // Claim before actuation: a reset can lose a command, but cannot replay a gate pulse.
                if (!Firebase.RTDB.setDouble(&fbdo, receiptPath.c_str(), (double)cmd.timestamp)) {
                    Serial.printf("[Worker] No se pudo reservar el comando: %s\n", fbdo.errorReason().c_str());
                    continue;
                }
            }
            switch (cmd.type) {
                case CMD_LIGHT:
                    handleLightCommand(String(cmd.deviceId), cmd.boolParam);
                    break;
                case CMD_POOL:
                    handlePoolCommand(cmd.boolParam);
                    break;
                case CMD_GATE:
                    handleGateCommand(cmd.timestamp);
                    break;
                case CMD_TV:
                    handleTvCommand(String(cmd.deviceId), String(cmd.action), String(cmd.value));
                    break;
            }
            if (cmd.sourcePath[0] != '\0') { clearExecutedCommand(String(cmd.sourcePath)); }
        }
        // Yield para no monopolizar el scheduler
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

// =========================================================================
// VALIDACIÓN TTL DE COMANDOS (Hallazgo Crítico 2)
//
// Si el ESP32 se reinicia horas después de que se enviaron comandos,
// NO debe re-ejecutarlos. Solo procesa comandos con < 10 segundos de vida.
// =========================================================================
bool isCommandFresh(long long cmdTimestampMs) {
    if (cmdTimestampMs <= 0) {
        // Sin timestamp: descartar por seguridad
        Serial.println("[TTL Guard] Comando sin timestamp — descartado.");
        return false;
    }
    // Obtener tiempo actual del servidor NTP
    time_t nowSec = time(nullptr);
    if (nowSec < 100000) {
        // Fail closed: never execute a physical command without a trusted clock.
        Serial.println("[TTL Guard] NTP no sincronizado — comando rechazado.");
        return false;
    }
    long long nowMs  = (long long)nowSec * 1000LL;
    long long diffMs = nowMs - cmdTimestampMs;

    if (diffMs < 0) { diffMs = -diffMs; }  // clock skew menor

    if (diffMs > 10000LL) {
        Serial.printf("[TTL Guard] Comando RECHAZADO — antigüedad: %lld ms (> 10s)\n", diffMs);
        return false;
    }
    Serial.printf("[TTL Guard] Comando VÁLIDO — antigüedad: %lld ms\n", diffMs);
    return true;
}

bool isValidTvCommand(const String& targetId, const String& action, const String& value) {
    bool knownTv = targetId == "tv-living" || targetId == "tv-pedro" || targetId == "tv-padres" || targetId == "tv-lucas";
    if (!knownTv) return false;
    if (action == "power" || action == "toggle_mute") return value.length() == 0;
    if (action == "set_volume") {
        if (value.length() == 0) return false;
        for (size_t i = 0; i < value.length(); i++) if (!isDigit(value[i])) return false;
        int volume = value.toInt();
        return volume >= 0 && volume <= 100;
    }
    if (action == "launch_app") {
        return value == "Netflix" || value == "YouTube" || value == "Flow" ||
            value == "Prime Video" || value == "Disney+" || value == "Spotify";
    }
    if (action == "remote_key") {
        return value == "UP" || value == "DOWN" || value == "LEFT" || value == "RIGHT" ||
            value == "ENTER" || value == "OK" || value == "BACK" || value == "HOME" ||
            value == "MENU" || value == "PLAY_PAUSE";
    }
    return false;
}

// =========================================================================
// LIMPIAR COMANDO EJECUTADO (evita re-ejecución en próximo reinicio)
// Escribe null en el nodo ejecutado para que no quede en la DB.
// =========================================================================
void clearExecutedCommand(const String& path) {
    if (!Firebase.ready()) { return; }
    Firebase.RTDB.deleteNode(&fbdo, path.c_str());
}

// =========================================================================
// VERIFICACIÓN DE SALUD DEL STREAM
// =========================================================================
void checkStreamHealth() {
    if (!Firebase.ready()) { return; }
    if (!streamData.httpConnected()) {
        Serial.println("[Stream Health] Stream caído. Reabriendo...");
        if (Firebase.RTDB.beginStream(&streamData, "/home/commands")) {
            Firebase.RTDB.setStreamCallback(&streamData, streamCallback, streamTimeoutCallback);
            streamSubscribed = true;
            Serial.println("[Stream Health] Stream reanudado.");
        } else {
            Serial.printf("[Stream Health] Error: %s\n", streamData.errorReason().c_str());
        }
    }
}

// =========================================================================
// CONEXIÓN WI-FI
// =========================================================================
void initWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.printf("[Wi-Fi] Conectando a '%s'", WIFI_SSID);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        esp_task_wdt_reset();
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[Wi-Fi] ¡Conectado!");
        Serial.printf("[Wi-Fi] IP local: %s | RSSI: %d dBm\n",
            WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
        Serial.println("\n[Wi-Fi] Sin conexión. El sistema reintentará automáticamente.");
    }
}

// =========================================================================
// SINCRONIZACIÓN NTP (necesario para validar timestamps de comandos)
// =========================================================================
void initNTP() {
    Serial.println("[NTP] Sincronizando reloj con servidor NTP...");
    configTime(-3 * 3600, 0, "pool.ntp.org", "time.google.com");
    unsigned long start = millis();
    time_t now = 0;
    while (now < 100000 && millis() - start < 8000) {
        esp_task_wdt_reset();
        delay(200);
        now = time(nullptr);
    }
    if (now > 100000) {
        Serial.printf("[NTP] Reloj sincronizado: %s", ctime(&now));
    } else {
        Serial.println("[NTP] Sin sincronización; se rechazarán comandos físicos hasta sincronizar.");
    }
}

// =========================================================================
// CONEXIÓN FIREBASE
// =========================================================================
void initFirebase() {
    Serial.println("[Firebase] Inicializando con autenticación segura...");

    config.api_key        = FIREBASE_API_KEY;
    config.database_url   = FIREBASE_DATABASE_URL;
    auth.user.email       = FIREBASE_USER_EMAIL;
    auth.user.password    = FIREBASE_USER_PASSWORD;
    config.token_status_callback = tokenStatusCallback;

    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);

    streamData.setBSSLBufferSize(4096, 1024);
    fbdo.setBSSLBufferSize(4096, 1024);

    // Esperar validación del token (máx 12 s)
    Serial.print("[Firebase] Esperando token JWT");
    unsigned long startAuth = millis();
    while (!Firebase.ready() && millis() - startAuth < 12000) {
        esp_task_wdt_reset();
        delay(200);
        Serial.print(".");
    }

    if (Firebase.ready()) {
        Serial.println("\n[Firebase] Token validado correctamente.");
    } else {
        Serial.println("\n[Firebase] Advertencia: token pendiente — reintentando en segundo plano.");
    }

    // Suscribir Stream en /home/commands
    if (!Firebase.RTDB.beginStream(&streamData, "/home/commands")) {
        Serial.printf("[Firebase Stream] Error: %s\n", streamData.errorReason().c_str());
        streamSubscribed = false;
    } else {
        Firebase.RTDB.setStreamCallback(&streamData, streamCallback, streamTimeoutCallback);
        streamSubscribed = true;
        Serial.println("[Firebase] Stream suscrito a /home/commands");
    }
}

// =========================================================================
// HEARTBEAT
// =========================================================================
void sendHeartbeat() {
    FirebaseJson json;
    json.set("online", true);
    json.set("ip",     WiFi.localIP().toString());
    json.set("rssi",   WiFi.RSSI());
    json.set("uptime", (unsigned long)(millis() / 1000));

    time_t nowSec = time(nullptr);
    long long nowMs = (nowSec > 100000) ? (long long)nowSec * 1000LL : (long long)millis();
    json.set("last_seen", nowMs);
    json.set("version", "2.1.0-dualcore");

    if (!Firebase.RTDB.setJSON(&fbdo, "/home/gateway/status", &json)) {
        Serial.printf("[Heartbeat] Error: %s\n", fbdo.errorReason().c_str());
    }
}

// =========================================================================
// STREAM CALLBACK — Solo encola comandos, NO hace HTTP aquí
// =========================================================================
void streamCallback(FirebaseStream data) {
    String path     = data.dataPath();
    String dataType = data.dataType();

    Serial.printf("\n[Stream] Path: %s | Tipo: %s\n", path.c_str(), dataType.c_str());

    Command cmd;
    memset(&cmd, 0, sizeof(cmd));
    bool enqueue = false;

    // --- Luces individuales: /lights/living ---
    if (path.startsWith("/lights/") && dataType == "boolean") {
        String lightName = path.substring(8);
        cmd.type      = CMD_LIGHT;
        cmd.boolParam = data.boolData();
        strncpy(cmd.deviceId, lightName.c_str(), sizeof(cmd.deviceId) - 1);
        String sourcePath = "/home/commands/lights/" + lightName;
        strncpy(cmd.sourcePath, sourcePath.c_str(), sizeof(cmd.sourcePath) - 1);
        enqueue = true;
    }
    // --- Luces en bloque JSON: /lights ---
    else if (path == "/lights" && dataType == "json") {
        FirebaseJson json = data.jsonObject();
        size_t len = json.iteratorBegin();
        String key, value;
        int type = 0;
        for (size_t i = 0; i < len; i++) {
            json.iteratorGet(i, type, key, value);
            if (type == FirebaseJson::JSON_BOOL) {
                Command c;
                memset(&c, 0, sizeof(c));
                c.type      = CMD_LIGHT;
                c.boolParam = (value == "true");
                strncpy(c.deviceId, key.c_str(), sizeof(c.deviceId) - 1);
                String sourcePath = "/home/commands/lights/" + key;
                strncpy(c.sourcePath, sourcePath.c_str(), sizeof(c.sourcePath) - 1);
                if (cmdQueue) { xQueueSend(cmdQueue, &c, 0); }
            }
        }
        json.iteratorEnd();
        return;
    }
    // --- Pileta: /poolOn ---
    else if (path == "/poolOn" && dataType == "boolean") {
        cmd.type      = CMD_POOL;
        cmd.boolParam = data.boolData();
        strncpy(cmd.sourcePath, "/home/commands/poolOn", sizeof(cmd.sourcePath) - 1);
        enqueue = true;
    }
    // --- Portón: pulso de relé vía timestamp en /gateTrigger ---
    else if (path == "/gateTrigger") {
        if (dataType == "int" || dataType == "double") {
            cmd.timestamp = (long long)data.doubleData();
            cmd.type  = CMD_GATE;
            strncpy(cmd.sourcePath, "/home/commands/gateTrigger", sizeof(cmd.sourcePath) - 1);
            enqueue = true;
        }
    }
    // --- TV: /tv (JSON) ---
    else if (path == "/tv" && dataType == "json") {
        FirebaseJson json = data.jsonObject();
        FirebaseJsonData jd;
        long long ts = 0;
        if (json.get(jd, "timestamp")) { ts = (long long)jd.doubleValue; }

        String targetId = "tv-living";
        String action   = "";
        String value    = "";
        if (json.get(jd, "targetId")) { targetId = jd.stringValue; }
        if (json.get(jd, "action"))   { action   = jd.stringValue; }
        if (json.get(jd, "value") && jd.success && jd.typeNum != FirebaseJson::JSON_NULL) { value = jd.stringValue; }

        if (isValidTvCommand(targetId, action, value)) {
            cmd.type      = CMD_TV;
            cmd.timestamp = ts;
            strncpy(cmd.deviceId, targetId.c_str(), sizeof(cmd.deviceId) - 1);
            strncpy(cmd.action,   action.c_str(),   sizeof(cmd.action) - 1);
            strncpy(cmd.value,    value.c_str(),     sizeof(cmd.value) - 1);
            strncpy(cmd.sourcePath, "/home/commands/tv", sizeof(cmd.sourcePath) - 1);
            enqueue = true;
        }
    }

    if (enqueue && cmdQueue) {
        if (xQueueSend(cmdQueue, &cmd, 0) != pdTRUE) {
            Serial.println("[Stream] Cola llena — comando descartado.");
        }
    }
}

void streamTimeoutCallback(bool timeout) {
    if (timeout) {
        Serial.println("[Stream] Timeout — el SDK reconectará automáticamente.");
    }
}

// =========================================================================
// EJECUCIÓN HTTP LOCAL (corre en Core 0 / workerTask)
// =========================================================================
bool isPrivateLanUrl(const String& url) {
    if (!url.startsWith("http://")) { return false; }

    int hostEnd = url.length();
    const char delimiters[] = { '/', ':', '?', '#' };
    for (char delimiter : delimiters) {
        int position = url.indexOf(delimiter, 7);
        if (position >= 0 && position < hostEnd) { hostEnd = position; }
    }

    IPAddress address;
    if (hostEnd <= 7 || !address.fromString(url.substring(7, hostEnd))) { return false; }

    const uint8_t first = address[0];
    const uint8_t second = address[1];
    return first == 10 ||
           (first == 172 && second >= 16 && second <= 31) ||
           (first == 192 && second == 168);
}

bool executeHttpLocalCommand(const String& url) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[HTTP Local] Sin Wi-Fi — comando diferido.");
        return false;
    }
    if (!isPrivateLanUrl(url)) {
        Serial.println("[HTTP Local] Destino rechazado: solo se permiten IP privadas IPv4.");
        return false;
    }

    HTTPClient http;
    Serial.printf("[HTTP Local] → %s\n", url.c_str());

    http.begin(url);
    http.setTimeout(2500);

    int code    = http.GET();
    bool success = (code >= 200 && code < 300);

    if (success) {
        Serial.printf("[HTTP Local] OK (%d)\n", code);
    } else {
        Serial.printf("[HTTP Local] FAIL (%d) | %s\n", code, http.errorToString(code).c_str());
    }

    http.end();
    return success;
}

// Publica una marca UTC real para que todos los clientes puedan mostrar
// when the ESP32 last confirmed a physical state.
void updateStateTimestamp() {
    time_t nowSec = time(nullptr);
    if (nowSec <= 100000) {
        Serial.println("[Estado] NTP not synchronized yet; skipping updatedAt.");
        return;
    }
    if (!Firebase.RTDB.setDouble(&fbdo, "/home/state/updatedAt", (double)nowSec * 1000.0)) {
        Serial.printf("[Estado] No se pudo guardar updatedAt: %s\n", fbdo.errorReason().c_str());
    }
}

// =========================================================================
// MANEJADORES (corren en Core 0)
// =========================================================================
void handleLightCommand(const String& lightName, bool targetState) {
    Serial.printf("[Luz] %s → %s\n", lightName.c_str(), targetState ? "ON" : "OFF");

    const WifiSmartDevice* dev = nullptr;
    for (size_t i = 0; i < NUM_LIGHTS; i++) {
        if (lightName == SMART_LIGHTS[i].id) { dev = &SMART_LIGHTS[i]; break; }
    }
    if (!dev) {
        Serial.printf("[Luz] '%s' no encontrada en config.h\n", lightName.c_str());
        return;
    }

    String url = "http://" + String(dev->ip);
    if      (dev->protocol == PROTO_TASMOTA) { url += "/cm?cmnd=Power%20" + String(targetState ? "On" : "Off"); }
    else if (dev->protocol == PROTO_SHELLY)  { url += "/relay/0?turn="    + String(targetState ? "on" : "off"); }
    else                                     { url += targetState ? "/on" : "/off"; }

    bool ok = executeHttpLocalCommand(url);

    // Confirmar estado real en Firebase (la web lo lee para el rollback visual)
    String statePath = "/home/state/lights/" + lightName;
    if (Firebase.RTDB.setBool(&fbdo, statePath.c_str(), ok ? targetState : !targetState)) {
        updateStateTimestamp();
    } else {
        Serial.printf("[Luz] No se pudo publicar estado: %s\n", fbdo.errorReason().c_str());
    }
}

void handlePoolCommand(bool targetState) {
    Serial.printf("[Pileta] Bomba → %s\n", targetState ? "ON" : "OFF");

    String url = "http://" + String(POOL_RELAY_IP);
    if (POOL_RELAY_PROTOCOL == PROTO_SHELLY) {
        url += "/relay/0?turn=" + String(targetState ? "on" : "off");
    } else {
        url += "/cm?cmnd=Power%20" + String(targetState ? "On" : "Off");
    }

    bool ok = executeHttpLocalCommand(url);
    if (Firebase.RTDB.setBool(&fbdo, "/home/state/poolOn", ok ? targetState : !targetState)) {
        updateStateTimestamp();
    } else {
        Serial.printf("[Pileta] No se pudo publicar estado: %s\n", fbdo.errorReason().c_str());
    }
}

void handleGateCommand(long long commandTimestamp) {
    Serial.println("[Portón] Enviando pulso Wi-Fi...");
    bool ok = executeHttpLocalCommand(GATE_RELAY_PULSE_URL);
    time_t nowSec = time(nullptr);
    if (nowSec > 100000) {
        bool statusOk = Firebase.RTDB.setString(&fbdo, "/home/state/gateStatus", ok ? "pulse_sent" : "pulse_failed");
        statusOk = Firebase.RTDB.setDouble(&fbdo, "/home/state/gateStatusAt", (double)commandTimestamp) && statusOk;
        statusOk = Firebase.RTDB.setDouble(&fbdo, "/home/state/updatedAt", (double)nowSec * 1000.0) && statusOk;
        if (!statusOk) {
            Serial.printf("[Porton] No se pudo publicar el resultado: %s\n", fbdo.errorReason().c_str());
        }
    } else {
        Serial.println("[Portón] No se publica el resultado porque el reloj NTP no está sincronizado.");
    }
}

void handleTvCommand(const String& targetId, const String& action, const String& value) {
    Serial.printf("[TV] %s | Acción: %s | Valor: %s\n", targetId.c_str(), action.c_str(), value.c_str());

    String tvIp = TV_LIVING_IP;
    if      (targetId == "tv-pedro")  { tvIp = TV_PEDRO_IP;  }
    else if (targetId == "tv-padres") { tvIp = TV_PADRES_IP; }
    else if (targetId == "tv-lucas")  { tvIp = TV_LUCAS_IP;  }

    if (action == "power") {
        executeHttpLocalCommand("http://" + tvIp + ":8080/power");

    } else if (action == "set_volume") {
        int vol = value.toInt();
        executeHttpLocalCommand("http://" + tvIp + ":8080/volume?level=" + String(vol));

    } else if (action == "toggle_mute") {
        executeHttpLocalCommand("http://" + tvIp + ":8080/mute");

    } else if (action == "launch_app") {
        String encodedApp = value;
        encodedApp.replace("+", "%2B");
        encodedApp.replace(" ", "%20");
        executeHttpLocalCommand("http://" + tvIp + ":8080/app?name=" + encodedApp);

    } else if (action == "remote_key") {
        executeHttpLocalCommand("http://" + tvIp + ":8080/key?name=" + value);
    }
}
