#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>
#include <ArduinoOTA.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <esp_task_wdt.h>
#include <driver/rmt.h>
#include <time.h>

#include "config.h"

// =========================================================================
// WATCHDOG
// =========================================================================
#define WDT_TIMEOUT_SECONDS 30

// =========================================================================
// OBJETOS FIREBASE
// =========================================================================
FirebaseData streamData;
FirebaseData fbdo;
FirebaseData heartbeatData;
FirebaseData tvStatusData;
FirebaseAuth auth;
FirebaseConfig config;

// =========================================================================
// FREERTOS: COLA DE COMANDOS (Core 1 recibe -> Core 0 ejecuta)
//
// Core 1 -> Wi-Fi + Loop + Stream Firebase + ArduinoOTA (nunca bloqueado)
// Core 0 -> Worker que despacha peticiones HTTP locales + TLS Android TV
// =========================================================================
#define CMD_QUEUE_SIZE 16

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
SemaphoreHandle_t tvRemoteMutex = nullptr;
volatile bool tvStatusRefreshRequested = true;
const unsigned long TV_STATUS_POLL_INTERVAL_MS = 30000;
const unsigned long TV_REMOTE_COMMAND_MUTEX_TIMEOUT_MS = 15000;

// =========================================================================
// VARIABLES DE CONTROL
// =========================================================================
unsigned long lastHeartbeat   = 0;
const unsigned long HEARTBEAT_INTERVAL    = 15000;  // 15 s
unsigned long lastStreamCheck = 0;
const unsigned long STREAM_CHECK_INTERVAL = 30000;  // 30 s
bool streamSubscribed = false;
bool rgbLedReady = false;
bool databaseConnected = false;
int lastConnectionLedState = -1;

void setRgbLed(uint8_t red, uint8_t green, uint8_t blue);
void updateConnectionLed();

void initRgbLed() {
    rmt_config_t rmtConfig = {};
    rmtConfig.rmt_mode = RMT_MODE_TX;
    rmtConfig.channel = RMT_CHANNEL_0;
    rmtConfig.gpio_num = static_cast<gpio_num_t>(RGB_LED_PIN);
    rmtConfig.clk_div = 2;  // 40 MHz, 25 ns por tick
    rmtConfig.mem_block_num = 1;
    rmtConfig.tx_config.loop_en = false;
    rmtConfig.tx_config.carrier_en = false;
    rmtConfig.tx_config.idle_output_en = true;
    rmtConfig.tx_config.idle_level = RMT_IDLE_LEVEL_LOW;

    if (rmt_config(&rmtConfig) != ESP_OK || rmt_driver_install(RMT_CHANNEL_0, 0, 0) != ESP_OK) {
        Serial.println("[RGB] No se pudo inicializar el LED direccionable.");
        return;
    }
    rgbLedReady = true;
    setRgbLed(32, 0, 0);  // Rojo hasta conectar Wi-Fi y RTDB
}

void setRgbLed(uint8_t red, uint8_t green, uint8_t blue) {
    if (!rgbLedReady) { return; }

    const uint8_t grb[] = { green, red, blue };
    rmt_item32_t items[24] = {};
    size_t bitIndex = 0;
    for (uint8_t channel : grb) {
        for (int bit = 7; bit >= 0; bit--) {
            const bool one = (channel & (1U << bit)) != 0;
            items[bitIndex].level0 = 1;
            items[bitIndex].duration0 = one ? 32 : 14;
            items[bitIndex].level1 = 0;
            items[bitIndex].duration1 = one ? 16 : 34;
            bitIndex++;
        }
    }

    if (rmt_write_items(RMT_CHANNEL_0, items, 24, true) != ESP_OK) {
        Serial.println("[RGB] Error al actualizar el LED.");
    } else {
        delayMicroseconds(80);
    }
}

void updateConnectionLed() {
    const bool wifiConnected = WiFi.status() == WL_CONNECTED;
    const int state = !wifiConnected ? 0 : (databaseConnected ? 2 : 1);
    if (state == lastConnectionLedState) { return; }
    lastConnectionLedState = state;

    if (state == 0) {
        setRgbLed(32, 0, 0);
        Serial.println("[RGB] Rojo: Wi-Fi desconectado.");
    } else if (state == 1) {
        setRgbLed(0, 0, 32);
        Serial.println("[RGB] Azul: Wi-Fi conectado, Firebase RTDB sin confirmar.");
    } else {
        setRgbLed(0, 32, 0);
        Serial.println("[RGB] Verde: Wi-Fi y Firebase RTDB conectados.");
    }
}

// =========================================================================
// PROTOTIPOS
// =========================================================================
void initWiFi();
void initArduinoOTA();
void initFirebase();
void initNTP();
void sendHeartbeat();
void tvStatusTask(void* param);
void checkStreamHealth();
bool executeHttpLocalCommand(const String& url);
bool isPrivateLanUrl(const String& url);
void handleLightCommand(const String& lightName, bool targetState);
void handlePoolCommand(bool targetState);
void handleGateCommand(long long commandTimestamp);
bool handleTvCommand(const String& targetId, const String& action, const String& value, String& errorMsg);
bool executeAndroidTvRemote(const char* host, const char* tlsHostname, const char* serverCertPem, const char* certPem, const char* keyPem, int keyCode, const String& appLink, int volumeLevel, String& errorMsg, bool* powerState = nullptr, unsigned long mutexTimeoutMs = TV_REMOTE_COMMAND_MUTEX_TIMEOUT_MS, bool* sessionAcquired = nullptr);
bool executeAndroidTvRemoteUnlocked(const char* host, const char* tlsHostname, const char* serverCertPem, const char* certPem, const char* keyPem, int keyCode, const String& appLink, int volumeLevel, String& errorMsg, bool* powerState);
bool readAndroidTvPowerState(const SmartTvDevice& tv, bool& powerState, bool& sessionAcquired, String& errorMsg);
void publishTvPowerState(const SmartTvDevice& tv, const char* powerState, const char* reason);
bool sendAndroidTvKeyPacket(WiFiClientSecure& client, int keyCode);
bool sendAndroidTvAppLinkPacket(WiFiClientSecure& client, const String& appLink);
void workerTask(void* param);
void otaTask(void* param);
void streamCallback(FirebaseStream data);
void streamTimeoutCallback(bool timeout);
bool isCommandFresh(long long cmdTimestampMs);
bool isValidTvCommand(const String& targetId, const String& action, const String& value);
void clearExecutedCommand(const String& path);
void publishTvCommandResult(const String& targetId, const String& action, long long timestamp, bool success, const String& errorMsg);

// =========================================================================
// SETUP — Corre en Core 1 por defecto en Arduino-ESP32
// =========================================================================
void setup() {
    Serial.begin(115200);
    // setTxTimeoutMs(0): Evita que Serial se bloquee si el ESP32 está conectado
    // a un cargador de pared sin host USB.
    Serial.setTxTimeoutMs(0);
    delay(500);

    initRgbLed();

    Serial.println("\n==================================================");
    Serial.println("  SMART PANEL - GATEWAY AUTÓNOMO LOCAL (ESP32-S3)");
    Serial.println("  Control Directo Wi-Fi (Luces, Pileta, Portón, TV)");
    Serial.println("  Actualizaciones Inalámbricas ArduinoOTA");
    Serial.println("==================================================");

    // 1. Hardware Watchdog
    esp_task_wdt_init(WDT_TIMEOUT_SECONDS, true);
    esp_task_wdt_add(NULL);

    // 2. Cola de comandos inter-núcleo
    cmdQueue = xQueueCreate(CMD_QUEUE_SIZE, sizeof(Command));
    if (!cmdQueue) {
        Serial.println("[FreeRTOS] ERROR: No se pudo crear la cola de comandos.");
    }
    tvRemoteMutex = xSemaphoreCreateMutex();
    if (!tvRemoteMutex) {
        Serial.println("[FreeRTOS] ERROR: No se pudo crear el bloqueo del control Android TV.");
    }

    // 3. Crear tarea Worker en Core 0 (pila de 12 KB para soportar handshake TLS)
    xTaskCreatePinnedToCore(
        workerTask,
        "CMD_WORKER",
        12288,
        NULL,
        1,
        NULL,
        0
    );

    // 4. Wi-Fi
    initWiFi();

    // 5. ArduinoOTA (flasheo inalámbrico)
    initArduinoOTA();

    // 6. NTP (para sincronización y validación TTL de órdenes)
    initNTP();

    // 7. Firebase Realtime Database
    initFirebase();

    if (xTaskCreatePinnedToCore(
            tvStatusTask,
            "TV_STATUS",
            12288,
            NULL,
            1,
            NULL,
            0
        ) != pdPASS) {
        Serial.println("[TV Status] No se pudo iniciar la tarea de telemetría.");
    }

    Serial.println("[Sistema] Gateway autónomo listo y escuchando órdenes.\n");
}

// =========================================================================
// LOOP — Corre en Core 1 (OTA se maneja en su propia tarea)
// =========================================================================
void loop() {
    esp_task_wdt_reset();

    // Reconexión Wi-Fi
    if (WiFi.status() != WL_CONNECTED) {
        databaseConnected = false;
        updateConnectionLed();
        Serial.println("[Wi-Fi] Conexión perdida. Reconectando...");
        WiFi.reconnect();
        delay(3000);
        return;
    }

    updateConnectionLed();

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
// TAREA OTA DEDICADA (Core 1) — Siempre responsiva, independiente del loop
// =========================================================================
void otaTask(void* param) {
    for (;;) {
        ArduinoOTA.handle();
        vTaskDelay(pdMS_TO_TICKS(10)); // Poll cada 10 ms — ventana OTA siempre abierta
    }
}

// =========================================================================
// ARDUINO OTA (Actualizaciones Inalámbricas)
// =========================================================================
void initArduinoOTA() {
    ArduinoOTA.setHostname("smartpanel-esp32");
    ArduinoOTA.setPassword(OTA_PASSWORD);
    ArduinoOTA.setPort(3232);

    ArduinoOTA.onStart([]() {
        String type = (ArduinoOTA.getCommand() == U_FLASH) ? "firmware" : "filesystem";
        Serial.println("\n[OTA] Inicio de actualización inalámbrica: " + type);
        esp_task_wdt_delete(NULL); // Desactivar watchdog durante la carga OTA
    });

    ArduinoOTA.onEnd([]() {
        Serial.println("\n[OTA] Actualización finalizada con éxito. Reiniciando...");
    });

    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        if (total > 0) {
            Serial.printf("[OTA] Progreso: %u%%\r", (progress * 100) / total);
        }
    });

    ArduinoOTA.onError([](ota_error_t error) {
        Serial.printf("[OTA] Error[%u]: ", error);
        if (error == OTA_AUTH_ERROR) Serial.println("Fallo de autenticación");
        else if (error == OTA_BEGIN_ERROR) Serial.println("Fallo al iniciar");
        else if (error == OTA_CONNECT_ERROR) Serial.println("Fallo de conexión");
        else if (error == OTA_RECEIVE_ERROR) Serial.println("Fallo al recibir");
        else if (error == OTA_END_ERROR) Serial.println("Fallo al finalizar");
    });

    ArduinoOTA.begin();

    // Tarea dedicada: OTA siempre responsiva sin depender del loop()
    xTaskCreatePinnedToCore(
        otaTask,
        "OTA_TASK",
        8192,  // 8 KB: Update.begin() necesita mas stack que el loop() por defecto
        NULL,
        2,     // Prioridad 2 (mayor que CMD_WORKER=1 para respuesta inmediata)
        NULL,
        1      // Core 1 junto con el loop y el stream de Firebase
    );

    Serial.println("[OTA] Servicio ArduinoOTA iniciado en puerto 3232 (tarea dedicada).");
}

// =========================================================================
// TAREA WORKER (Core 0) — Ejecuta peticiones HTTP locales y TLS mTLS
// =========================================================================
void workerTask(void* param) {
    Command cmd;
    for (;;) {
        if (xQueueReceive(cmdQueue, &cmd, pdMS_TO_TICKS(100)) == pdTRUE) {
            if (cmd.timestamp <= 0 && (cmd.type == CMD_LIGHT || cmd.type == CMD_POOL)) {
                FirebaseData tsData;
                if (Firebase.RTDB.get(&tsData, "/home/commands/timestamp")) {
                    cmd.timestamp = tsData.to<long long>();
                }
            }
            if (!isCommandFresh(cmd.timestamp)) {
                Serial.println("[Worker] Comando vencido o sin hora confiable; descartado.");
                if (cmd.type == CMD_TV && cmd.timestamp > 0) {
                    publishTvCommandResult(
                        String(cmd.deviceId),
                        String(cmd.action),
                        cmd.timestamp,
                        false,
                        "La orden TV llegó vencida o el reloj no está sincronizado; no se ejecutó. Volvé a enviarla."
                    );
                }
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
                if (!receiptFound &&
                    receiptData.httpCode() != FIREBASE_ERROR_HTTP_CODE_NOT_FOUND &&
                    receiptData.httpCode() != FIREBASE_ERROR_PATH_NOT_EXIST) {
                    Serial.printf("[Worker] No se pudo verificar el recibo (%d); comando no ejecutado.\n", receiptData.httpCode());
                    if (cmd.type == CMD_TV) {
                        String message = "No se pudo verificar el recibo del comando (HTTP " +
                            String(receiptData.httpCode()) + "); no se ejecutó.";
                        publishTvCommandResult(String(cmd.deviceId), String(cmd.action), cmd.timestamp, false, message);
                        clearExecutedCommand(String(cmd.sourcePath));
                    }
                    continue;
                }
                if (!Firebase.RTDB.setDouble(&fbdo, receiptPath.c_str(), (double)cmd.timestamp)) {
                    Serial.printf("[Worker] No se pudo reservar el comando: %s\n", fbdo.errorReason().c_str());
                    if (cmd.type == CMD_TV) {
                        String message = "No se pudo reservar el recibo del comando (HTTP " +
                            String(fbdo.httpCode()) + "); no se ejecutó.";
                        publishTvCommandResult(String(cmd.deviceId), String(cmd.action), cmd.timestamp, false, message);
                        clearExecutedCommand(String(cmd.sourcePath));
                    }
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
                {
                    String targetId = String(cmd.deviceId);
                    String action = String(cmd.action);
                    String value = String(cmd.value);
                    String errorMsg = "";

                    bool success = handleTvCommand(targetId, action, value, errorMsg);
                    publishTvCommandResult(targetId, action, cmd.timestamp, success, errorMsg);
                    if (action == "power") { tvStatusRefreshRequested = true; }
                    break;
                }
            }
            if (cmd.sourcePath[0] != '\0') { clearExecutedCommand(String(cmd.sourcePath)); }
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

// =========================================================================
// VALIDACIÓN TTL DE COMANDOS
// =========================================================================
bool isCommandFresh(long long cmdTimestampMs) {
    if (cmdTimestampMs <= 0) {
        Serial.println("[TTL Guard] Comando sin timestamp — descartado.");
        return false;
    }
    time_t nowSec = time(nullptr);
    if (nowSec < 100000) {
        Serial.println("[TTL Guard] NTP no sincronizado — comando rechazado.");
        return false;
    }
    long long nowMs  = (long long)nowSec * 1000LL;
    long long diffMs = nowMs - cmdTimestampMs;

    if (diffMs < 0) { diffMs = -diffMs; }

    // 15 s: margen para latencia de Firebase stream (~1-2 s) + handshake TLS a la TV (~5 s)
    if (diffMs > 15000LL) {
        Serial.printf("[TTL Guard] Comando RECHAZADO — antigüedad: %lld ms (> 15s)\n", diffMs);
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
        return volume >= 0 && volume <= 25;
    }
    if (action == "launch_app") {
        return value == "Netflix" || value == "YouTube" || value == "Flow" ||
            value == "Prime Video" || value == "Disney+" || value == "Spotify";
    }
    if (action == "remote_key") {
        return value == "UP" || value == "DOWN" || value == "LEFT" || value == "RIGHT" ||
            value == "ENTER" || value == "OK" || value == "BACK" || value == "HOME" ||
            value == "MENU" || value == "PLAY_PAUSE" || value == "VOLUME_UP" || value == "VOLUME_DOWN";
    }
    return false;
}

void clearExecutedCommand(const String& path) {
    if (!Firebase.ready()) { return; }
    Firebase.RTDB.deleteNode(&fbdo, path.c_str());
}

void publishTvCommandResult(const String& targetId, const String& action, long long timestamp, bool success, const String& errorMsg) {
    FirebaseJson result;
    result.set("timestamp", (double)timestamp);
    result.set("targetId", targetId);
    result.set("action", action);
    result.set("success", success);
    if (!success && errorMsg.length() > 0) {
        result.set("message", errorMsg);
    }
    if (!Firebase.RTDB.setJSON(&fbdo, "/home/state/tvCommandResult", &result)) {
        Serial.printf("[TV] No se pudo publicar el resultado: %s\n", fbdo.errorReason().c_str());
    } else {
        Serial.printf("[TV] Resultado %s publicado en Firebase.\n", success ? "exitoso" : "fallido");
    }
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
        Serial.println("\n[Wi-Fi] ¡Conectado con éxito!");
        Serial.printf("[Wi-Fi] IP asignada: %s | RSSI: %d dBm\n",
            WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
        Serial.println("\n[Wi-Fi] Sin conexión inicial. Se reintentará automáticamente.");
    }
}

// =========================================================================
// SINCRONIZACIÓN NTP
// =========================================================================
void initNTP() {
    Serial.println("[NTP] Sincronizando reloj con servidores horarios...");
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
        Serial.println("[NTP] Sin sincronización horaria inicial.");
    }
}

// =========================================================================
// CONEXIÓN FIREBASE
// =========================================================================
void initFirebase() {
    Serial.println("[Firebase] Inicializando con autenticación segura...");

    config.api_key        = FIREBASE_API_KEY;
    config.database_url   = FIREBASE_DATABASE_URL;
    config.signer.reqTO   = 60000;
    auth.user.email       = FIREBASE_USER_EMAIL;
    auth.user.password    = FIREBASE_USER_PASSWORD;
    config.token_status_callback = tokenStatusCallback;

    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);

    streamData.setBSSLBufferSize(4096, 1024);
    fbdo.setBSSLBufferSize(4096, 1024);
    heartbeatData.setBSSLBufferSize(4096, 1024);
    tvStatusData.setBSSLBufferSize(4096, 1024);

    Serial.print("[Firebase] Esperando token JWT");
    unsigned long startAuth = millis();
    while (!Firebase.ready() && millis() - startAuth < 12000) {
        esp_task_wdt_reset();
        delay(200);
        Serial.print(".");
    }

    if (Firebase.ready()) {
        Serial.println("\n[Firebase] Token autenticado correctamente.");
    } else {
        Serial.println("\n[Firebase] Advertencia: autenticación en progreso.");
    }

    if (!Firebase.RTDB.beginStream(&streamData, "/home/commands")) {
        Serial.printf("[Firebase Stream] Error: %s\n", streamData.errorReason().c_str());
        streamSubscribed = false;
    } else {
        Firebase.RTDB.setStreamCallback(&streamData, streamCallback, streamTimeoutCallback);
        streamSubscribed = true;
        Serial.println("[Firebase] Stream suscrito activamente a /home/commands");
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
    json.set("version", "3.0.0-standalone-ota");

    if (!Firebase.RTDB.setJSON(&heartbeatData, "/home/gateway/status", &json)) {
        databaseConnected = false;
        updateConnectionLed();
        Serial.printf("[Heartbeat] Error: %s\n", heartbeatData.errorReason().c_str());
    } else {
        databaseConnected = true;
        updateConnectionLed();
    }
}

// =========================================================================
// STREAM CALLBACK
// =========================================================================
void streamCallback(FirebaseStream data) {
    String path     = data.dataPath();
    String dataType = data.dataType();

    Serial.printf("\n[Stream] Path: %s | Tipo: %s\n", path.c_str(), dataType.c_str());

    Command cmd;
    memset(&cmd, 0, sizeof(cmd));
    bool enqueue = false;

    // --- Luces individuales ---
    if (path.startsWith("/lights/") && dataType == "boolean") {
        String lightName = path.substring(8);
        cmd.type      = CMD_LIGHT;
        cmd.boolParam = data.boolData();
        strncpy(cmd.deviceId, lightName.c_str(), sizeof(cmd.deviceId) - 1);
        String sourcePath = "/home/commands/lights/" + lightName;
        strncpy(cmd.sourcePath, sourcePath.c_str(), sizeof(cmd.sourcePath) - 1);
        enqueue = true;
    }
    // --- Luces en bloque JSON ---
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
    // --- Pileta (Lógica intacta) ---
    else if (path == "/poolOn" && dataType == "boolean") {
        cmd.type      = CMD_POOL;
        cmd.boolParam = data.boolData();
        strncpy(cmd.sourcePath, "/home/commands/poolOn", sizeof(cmd.sourcePath) - 1);
        enqueue = true;
    }
    // --- Portón ---
    else if (path == "/gateTrigger") {
        if (dataType == "int" || dataType == "double") {
            cmd.timestamp = (long long)data.doubleData();
            cmd.type  = CMD_GATE;
            strncpy(cmd.sourcePath, "/home/commands/gateTrigger", sizeof(cmd.sourcePath) - 1);
            enqueue = true;
        }
    }
    // --- Android TV por Wi-Fi directo ---
    else if ((path == "/tv" || path == "/") && dataType == "json") {
        FirebaseJson rootJson = data.jsonObject();
        FirebaseJson tvJson;
        FirebaseJson* commandJson = &rootJson;
        if (path == "/") {
            FirebaseJsonData tvData;
            if (!rootJson.get(tvData, "tv") ||
                tvData.typeNum != FirebaseJson::JSON_OBJECT ||
                !tvData.getJSON(tvJson)) {
                Serial.println("[TV] Actualización raíz sin objeto tv; ignorada.");
                return;
            }
            commandJson = &tvJson;
        }

        FirebaseJsonData jd;
        long long ts = 0;
        if (commandJson->get(jd, "timestamp")) { ts = (long long)jd.doubleValue; }

        String targetId = "tv-living";
        String action   = "";
        String value    = "";
        if (commandJson->get(jd, "targetId")) { targetId = jd.stringValue; }
        if (commandJson->get(jd, "action"))   { action   = jd.stringValue; }
        if (commandJson->get(jd, "value") && jd.success && jd.typeNum != FirebaseJson::JSON_NULL) { value = jd.stringValue; }

        if (isValidTvCommand(targetId, action, value)) {
            cmd.type      = CMD_TV;
            cmd.timestamp = ts;
            strncpy(cmd.deviceId, targetId.c_str(), sizeof(cmd.deviceId) - 1);
            strncpy(cmd.action,   action.c_str(),   sizeof(cmd.action) - 1);
            strncpy(cmd.value,    value.c_str(),     sizeof(cmd.value) - 1);
            strncpy(cmd.sourcePath, "/home/commands/tv", sizeof(cmd.sourcePath) - 1);
            enqueue = true;
        } else {
            Serial.printf("[TV] Comando TV inválido (destino=%s, acción=%s, valor=%s).\n", targetId.c_str(), action.c_str(), value.c_str());
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
        Serial.println("[Stream] Timeout — reconexión automática en progreso.");
    }
}

// =========================================================================
// EJECUCIÓN HTTP LOCAL (Luces, Pileta, Portón)
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
        Serial.println("[HTTP Local] Sin Wi-Fi — comando cancelado.");
        return false;
    }
    if (!isPrivateLanUrl(url)) {
        Serial.println("[HTTP Local] Destino rechazado: no es IP privada IPv4.");
        return false;
    }

    HTTPClient http;
    Serial.printf("[HTTP Local] -> %s\n", url.c_str());

    http.begin(url);
    http.setTimeout(2500);

    int code = http.GET();
    bool success = (code >= 200 && code < 300);

    if (success) {
        Serial.printf("[HTTP Local] OK (%d)\n", code);
    } else {
        Serial.printf("[HTTP Local] FAIL (%d) | %s\n", code, http.errorToString(code).c_str());
    }

    http.end();
    return success;
}

void updateStateTimestamp() {
    time_t nowSec = time(nullptr);
    if (nowSec <= 100000) {
        Serial.println("[Estado] NTP no sincronizado todavía.");
        return;
    }
    if (!Firebase.RTDB.setDouble(&fbdo, "/home/state/updatedAt", (double)nowSec * 1000.0)) {
        Serial.printf("[Estado] Error al guardar updatedAt: %s\n", fbdo.errorReason().c_str());
    }
}

void handleLightCommand(const String& lightName, bool targetState) {
    Serial.printf("[Luz] %s -> %s\n", lightName.c_str(), targetState ? "ON" : "OFF");

    const WifiSmartDevice* dev = nullptr;
    for (size_t i = 0; i < NUM_LIGHTS; i++) {
        if (lightName == SMART_LIGHTS[i].id) { dev = &SMART_LIGHTS[i]; break; }
    }
    if (!dev) {
        Serial.printf("[Luz] '%s' no encontrada en configuración.\n", lightName.c_str());
        return;
    }

    String url = "http://" + String(dev->ip);
    if      (dev->protocol == PROTO_TASMOTA) { url += "/cm?cmnd=Power%20" + String(targetState ? "On" : "Off"); }
    else if (dev->protocol == PROTO_SHELLY)  { url += "/relay/0?turn="    + String(targetState ? "on" : "off"); }
    else                                     { url += targetState ? "/on" : "/off"; }

    bool ok = executeHttpLocalCommand(url);

    String statePath = "/home/state/lights/" + lightName;
    if (Firebase.RTDB.setBool(&fbdo, statePath.c_str(), ok ? targetState : !targetState)) {
        updateStateTimestamp();
    } else {
        Serial.printf("[Luz] Error al publicar estado: %s\n", fbdo.errorReason().c_str());
    }
}

void handlePoolCommand(bool targetState) {
    Serial.printf("[Pileta] Bomba -> %s\n", targetState ? "ON" : "OFF");

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
        Serial.printf("[Pileta] Error al publicar estado: %s\n", fbdo.errorReason().c_str());
    }
}

void handleGateCommand(long long commandTimestamp) {
    Serial.println("[Portón] Emitiendo pulso Wi-Fi...");
    bool ok = executeHttpLocalCommand(GATE_RELAY_PULSE_URL);
    time_t nowSec = time(nullptr);
    if (nowSec > 100000) {
        bool statusOk = Firebase.RTDB.setString(&fbdo, "/home/state/gateStatus", ok ? "pulse_sent" : "pulse_failed");
        statusOk = Firebase.RTDB.setDouble(&fbdo, "/home/state/gateStatusAt", (double)commandTimestamp) && statusOk;
        statusOk = Firebase.RTDB.setDouble(&fbdo, "/home/state/updatedAt", (double)nowSec * 1000.0) && statusOk;
        if (!statusOk) {
            Serial.printf("[Portón] Error al publicar resultado: %s\n", fbdo.errorReason().c_str());
        }
    } else {
        Serial.println("[Portón] No se publica estado porque el reloj NTP no está sincronizado.");
    }
}

// =========================================================================
// CONTROL ANDROID TV DIRECTO POR WI-FI (mTLS puerto 6466 - Google TV v2)
// CERO PC - Ejecutado 100% en el ESP32
// =========================================================================

bool sendAndroidTvKeyPacket(WiFiClientSecure& client, int keyCode) {
    uint8_t keyBytes[4];
    size_t kLen = 0;
    if (keyCode < 128) {
        keyBytes[kLen++] = (uint8_t)keyCode;
    } else {
        keyBytes[kLen++] = (uint8_t)((keyCode & 0x7F) | 0x80);
        keyBytes[kLen++] = (uint8_t)(keyCode >> 7);
    }
    uint8_t subLen = 1 + kLen + 2;
    uint8_t totalLen = 2 + subLen;

    uint8_t packet[16];
    size_t p = 0;
    packet[p++] = totalLen;
    packet[p++] = 82; // Field 10 (remote_key_inject), wire type 2
    packet[p++] = subLen;
    packet[p++] = 8;  // Field 1 (key_code), wire type 0
    for (size_t i = 0; i < kLen; i++) packet[p++] = keyBytes[i];
    packet[p++] = 16; // Field 2 (direction), wire type 0
    packet[p++] = 3;  // RemoteDirection.SHORT (3)
    return client.write(packet, p) == p;
}

bool sendAndroidTvAppLinkPacket(WiFiClientSecure& client, const String& appLink) {
    size_t strLen = appLink.length();
    size_t subLen = 1 + (strLen < 128 ? 1 : 2) + strLen;
    size_t totalLen = 2 + (subLen < 128 ? 1 : 2) + subLen;

    uint8_t packet[256];
    size_t p = 0;
    if (totalLen < 128) packet[p++] = (uint8_t)totalLen;
    else { packet[p++] = (uint8_t)((totalLen & 0x7F) | 0x80); packet[p++] = (uint8_t)(totalLen >> 7); }

    // Tag 90 (remote_app_link_launch_request) -> [210, 5]
    packet[p++] = 210;
    packet[p++] = 5;

    if (subLen < 128) packet[p++] = (uint8_t)subLen;
    else { packet[p++] = (uint8_t)((subLen & 0x7F) | 0x80); packet[p++] = (uint8_t)(subLen >> 7); }

    packet[p++] = 10; // Tag 1 (app_link), wire type 2
    if (strLen < 128) packet[p++] = (uint8_t)strLen;
    else { packet[p++] = (uint8_t)((strLen & 0x7F) | 0x80); packet[p++] = (uint8_t)(strLen >> 7); }

    for (size_t i = 0; i < strLen; i++) packet[p++] = appLink[i];

    return client.write(packet, p) == p;
}

const uint32_t ANDROID_TV_FEATURE_KEY = 1U << 1;
const uint32_t ANDROID_TV_FEATURE_POWER = 1U << 5;
const uint32_t ANDROID_TV_FEATURE_VOLUME = 1U << 6;
const uint32_t ANDROID_TV_FEATURE_APP_LINK = 1U << 9;
const uint32_t ANDROID_TV_SUPPORTED_FEATURES =
    ANDROID_TV_FEATURE_KEY | ANDROID_TV_FEATURE_POWER |
    ANDROID_TV_FEATURE_VOLUME | ANDROID_TV_FEATURE_APP_LINK;

bool appendProtoVarint(uint8_t* buffer, size_t capacity, size_t& length, uint32_t value) {
    do {
        if (length >= capacity) { return false; }
        uint8_t byte = static_cast<uint8_t>(value & 0x7F);
        value >>= 7;
        if (value > 0) { byte |= 0x80; }
        buffer[length++] = byte;
    } while (value > 0);
    return true;
}

bool appendProtoVarintField(uint8_t* buffer, size_t capacity, size_t& length, uint32_t field, uint32_t value) {
    return appendProtoVarint(buffer, capacity, length, field << 3) &&
        appendProtoVarint(buffer, capacity, length, value);
}

bool appendProtoBytesField(uint8_t* buffer, size_t capacity, size_t& length, uint32_t field, const uint8_t* value, size_t valueLength) {
    if (!appendProtoVarint(buffer, capacity, length, (field << 3) | 2) ||
        !appendProtoVarint(buffer, capacity, length, static_cast<uint32_t>(valueLength)) ||
        valueLength > capacity - length) {
        return false;
    }
    memcpy(buffer + length, value, valueLength);
    length += valueLength;
    return true;
}

bool sendAndroidTvMessage(WiFiClientSecure& client, const uint8_t* message, size_t messageLength) {
    uint8_t header[5];
    size_t headerLength = 0;
    if (!appendProtoVarint(header, sizeof(header), headerLength, static_cast<uint32_t>(messageLength))) {
        return false;
    }
    return client.write(header, headerLength) == headerLength &&
        client.write(message, messageLength) == messageLength;
}

bool sendAndroidTvConfigurePacket(WiFiClientSecure& client, uint32_t features) {
    uint8_t deviceInfo[48];
    size_t deviceInfoLength = 0;
    const uint8_t unknown2[] = "1";
    const uint8_t packageName[] = "atvremote";
    const uint8_t appVersion[] = "1.0.0";
    if (!appendProtoVarintField(deviceInfo, sizeof(deviceInfo), deviceInfoLength, 3, 1) ||
        !appendProtoBytesField(deviceInfo, sizeof(deviceInfo), deviceInfoLength, 4, unknown2, sizeof(unknown2) - 1) ||
        !appendProtoBytesField(deviceInfo, sizeof(deviceInfo), deviceInfoLength, 5, packageName, sizeof(packageName) - 1) ||
        !appendProtoBytesField(deviceInfo, sizeof(deviceInfo), deviceInfoLength, 6, appVersion, sizeof(appVersion) - 1)) {
        return false;
    }

    uint8_t configure[80];
    size_t configureLength = 0;
    if (!appendProtoVarintField(configure, sizeof(configure), configureLength, 1, features) ||
        !appendProtoBytesField(configure, sizeof(configure), configureLength, 2, deviceInfo, deviceInfoLength)) {
        return false;
    }

    uint8_t message[96];
    size_t messageLength = 0;
    if (!appendProtoBytesField(message, sizeof(message), messageLength, 1, configure, configureLength)) {
        return false;
    }
    return sendAndroidTvMessage(client, message, messageLength);
}

bool sendAndroidTvSetActivePacket(WiFiClientSecure& client, uint32_t features) {
    uint8_t setActive[8];
    size_t setActiveLength = 0;
    if (!appendProtoVarintField(setActive, sizeof(setActive), setActiveLength, 1, features)) {
        return false;
    }

    uint8_t message[16];
    size_t messageLength = 0;
    if (!appendProtoBytesField(message, sizeof(message), messageLength, 2, setActive, setActiveLength)) {
        return false;
    }
    return sendAndroidTvMessage(client, message, messageLength);
}

bool readAndroidTvByte(WiFiClientSecure& client, uint8_t& value, unsigned long startedAt, uint32_t timeoutMs) {
    while (client.available() <= 0) {
        if (!client.connected() || millis() - startedAt >= timeoutMs) { return false; }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    int byte = client.read();
    if (byte < 0) { return false; }
    value = static_cast<uint8_t>(byte);
    return true;
}

bool readAndroidTvFrame(WiFiClientSecure& client, uint8_t* frame, size_t capacity, size_t& frameLength, uint32_t timeoutMs) {
    const unsigned long startedAt = millis();
    uint32_t length = 0;
    for (uint8_t shift = 0; shift < 35; shift += 7) {
        uint8_t byte = 0;
        if (!readAndroidTvByte(client, byte, startedAt, timeoutMs) ||
            (shift == 28 && (byte & 0xF0) != 0)) {
            return false;
        }
        length |= static_cast<uint32_t>(byte & 0x7F) << shift;
        if ((byte & 0x80) == 0) { break; }
        if (shift == 28) { return false; }
    }
    if (length == 0 || length > capacity) { return false; }

    for (uint32_t index = 0; index < length; index++) {
        if (!readAndroidTvByte(client, frame[index], startedAt, timeoutMs)) { return false; }
    }
    frameLength = length;
    return true;
}

bool readProtoVarint(const uint8_t* data, size_t length, size_t& offset, uint32_t& value) {
    value = 0;
    for (uint8_t shift = 0; shift < 35; shift += 7) {
        if (offset >= length) { return false; }
        const uint8_t byte = data[offset++];
        if (shift == 28 && (byte & 0xF0) != 0) { return false; }
        value |= static_cast<uint32_t>(byte & 0x7F) << shift;
        if ((byte & 0x80) == 0) { return true; }
    }
    return false;
}

bool skipProtoField(const uint8_t* data, size_t length, size_t& offset, uint32_t wireType) {
    uint32_t fieldLength = 0;
    switch (wireType) {
        case 0:
            return readProtoVarint(data, length, offset, fieldLength);
        case 1:
            if (length - offset < 8) { return false; }
            offset += 8;
            return true;
        case 2:
            if (!readProtoVarint(data, length, offset, fieldLength) || fieldLength > length - offset) { return false; }
            offset += fieldLength;
            return true;
        case 5:
            if (length - offset < 4) { return false; }
            offset += 4;
            return true;
        default:
            return false;
    }
}

bool findProtoBytesField(const uint8_t* data, size_t length, uint32_t targetField, const uint8_t*& value, size_t& valueLength) {
    size_t offset = 0;
    while (offset < length) {
        uint32_t tag = 0;
        if (!readProtoVarint(data, length, offset, tag) || tag == 0) { return false; }
        const uint32_t field = tag >> 3;
        const uint32_t wireType = tag & 7;
        if (field == targetField) {
            if (wireType != 2) { return false; }
            uint32_t fieldLength = 0;
            if (!readProtoVarint(data, length, offset, fieldLength) || fieldLength > length - offset) { return false; }
            value = data + offset;
            valueLength = fieldLength;
            return true;
        }
        if (!skipProtoField(data, length, offset, wireType)) { return false; }
    }
    return false;
}

bool findProtoVarintField(const uint8_t* data, size_t length, uint32_t targetField, uint32_t& value) {
    size_t offset = 0;
    while (offset < length) {
        uint32_t tag = 0;
        if (!readProtoVarint(data, length, offset, tag) || tag == 0) { return false; }
        const uint32_t field = tag >> 3;
        const uint32_t wireType = tag & 7;
        if (field == targetField) {
            return wireType == 0 && readProtoVarint(data, length, offset, value);
        }
        if (!skipProtoField(data, length, offset, wireType)) { return false; }
    }
    return false;
}

bool parseAndroidTvVolume(const uint8_t* data, size_t length, int& currentVolume, int& maxVolume) {
    const uint8_t* volumeInfo = nullptr;
    size_t volumeInfoLength = 0;
    uint32_t current = 0;
    uint32_t maximum = 0;
    if (!findProtoBytesField(data, length, 50, volumeInfo, volumeInfoLength) ||
        !findProtoVarintField(volumeInfo, volumeInfoLength, 6, maximum) ||
        !findProtoVarintField(volumeInfo, volumeInfoLength, 7, current) ||
        maximum == 0 || current > maximum || maximum > 10000) {
        return false;
    }
    currentVolume = static_cast<int>(current);
    maxVolume = static_cast<int>(maximum);
    return true;
}

bool executeAndroidTvRemoteUnlocked(const char* host, const char* tlsHostname, const char* serverCertPem, const char* certPem, const char* keyPem, int keyCode, const String& appLink, int volumeLevel, String& errorMsg, bool* powerState) {
    WiFiClientSecure client;
    client.setTimeout(4000);
    client.setHandshakeTimeout(8);

    Serial.printf("[AndroidTV] Conectando por TLS a %s:6466...\n", host);
    IPAddress remoteIp;
    if (!remoteIp.fromString(host)) {
        errorMsg = String("IP del televisor inválida: ") + host;
        return false;
    }
    if (!client.connect(remoteIp, 6466, tlsHostname, serverCertPem, certPem, keyPem)) {
        char tlsError[128] = {};
        int tlsErrorCode = client.lastError(tlsError, sizeof(tlsError));
        errorMsg = String("TLS no pudo conectar a ") + host + ":6466 (" +
            String(tlsErrorCode) + ": " + tlsError + ")";
        Serial.printf("[AndroidTV] %s\n", errorMsg.c_str());
        return false;
    }

    uint8_t rxBuf[256];
    size_t rxLen = 0;
    if (!readAndroidTvFrame(client, rxBuf, sizeof(rxBuf), rxLen, 3000)) {
        client.stop();
        errorMsg = "La TV no envió la configuración inicial del control remoto";
        Serial.printf("[AndroidTV] %s\n", errorMsg.c_str());
        return false;
    }

    const uint8_t* remoteConfigure = nullptr;
    size_t remoteConfigureLength = 0;
    uint32_t supportedFeatures = 0;
    if (!findProtoBytesField(rxBuf, rxLen, 1, remoteConfigure, remoteConfigureLength) ||
        !findProtoVarintField(remoteConfigure, remoteConfigureLength, 1, supportedFeatures)) {
        client.stop();
        errorMsg = "La configuración inicial de la TV no tiene un formato válido";
        return false;
    }

    const uint32_t activeFeatures = supportedFeatures & ANDROID_TV_SUPPORTED_FEATURES;
    uint32_t requiredFeature = powerState
        ? 0
        : (keyCode >= 0
            ? ANDROID_TV_FEATURE_KEY
            : (appLink.length() > 0 ? ANDROID_TV_FEATURE_APP_LINK : ANDROID_TV_FEATURE_VOLUME));
    if (keyCode == 26) { requiredFeature |= ANDROID_TV_FEATURE_POWER; }
    if ((activeFeatures & requiredFeature) != requiredFeature) {
        client.stop();
        errorMsg = "La TV no anunció soporte para esta acción de control remoto";
        return false;
    }

    if (!sendAndroidTvConfigurePacket(client, activeFeatures)) {
        client.stop();
        errorMsg = "Fallo al enviar configuración del cliente a la TV";
        return false;
    }

    // Android TV sends remote_set_active before remote_start; acknowledge activation first.
    bool remoteStarted = false;
    bool reportedPowerState = false;
    int currentVolume = -1;
    int maxVolume = -1;
    const unsigned long handshakeStart = millis();
    while (millis() - handshakeStart < 3000) {
        const uint32_t remainingMs = 3000 - (millis() - handshakeStart);
        if (!readAndroidTvFrame(client, rxBuf, sizeof(rxBuf), rxLen, remainingMs)) { break; }

        const uint8_t* remoteSetActive = nullptr;
        size_t remoteSetActiveLength = 0;
        if (findProtoBytesField(rxBuf, rxLen, 2, remoteSetActive, remoteSetActiveLength)) {
            if (!sendAndroidTvSetActivePacket(client, activeFeatures)) {
                client.stop();
                errorMsg = "Fallo al confirmar la activación del control remoto";
                return false;
            }
            continue;
        }

        const uint8_t* remoteStart = nullptr;
        size_t remoteStartLength = 0;
        if (findProtoBytesField(rxBuf, rxLen, 40, remoteStart, remoteStartLength)) {
            uint32_t stateValue = 0;
            if (findProtoVarintField(remoteStart, remoteStartLength, 1, stateValue) && stateValue > 1) {
                client.stop();
                errorMsg = "La TV informó un estado de encendido inválido";
                return false;
            }
            reportedPowerState = stateValue == 1;
            remoteStarted = true;
            break;
        }

        if (parseAndroidTvVolume(rxBuf, rxLen, currentVolume, maxVolume)) {
            continue;
        }

        const uint8_t* remoteError = nullptr;
        size_t remoteErrorLength = 0;
        if (findProtoBytesField(rxBuf, rxLen, 3, remoteError, remoteErrorLength)) {
            client.stop();
            errorMsg = "La TV rechazó la negociación del control remoto";
            return false;
        }
    }
    if (!remoteStarted) {
        client.stop();
        errorMsg = "La TV no confirmó el inicio de la sesión de control remoto";
        return false;
    }

    if (powerState) {
        *powerState = reportedPowerState;
        client.stop();
        return true;
    }

    if (volumeLevel >= 0 && currentVolume < 0) {
        const unsigned long volumeWaitStart = millis();
        while (millis() - volumeWaitStart < 1500) {
            const uint32_t remainingMs = 1500 - (millis() - volumeWaitStart);
            if (!readAndroidTvFrame(client, rxBuf, sizeof(rxBuf), rxLen, remainingMs)) { break; }
            if (parseAndroidTvVolume(rxBuf, rxLen, currentVolume, maxVolume)) { break; }
        }
        if (currentVolume < 0) {
            client.stop();
            errorMsg = "La TV no informó su nivel actual; no se puede ajustar el slider con seguridad";
            return false;
        }
    }

    // A remote_start confirms the session, not the visible effect of a key press.
    bool writeOk = false;
    if (keyCode >= 0) {
        writeOk = sendAndroidTvKeyPacket(client, keyCode);
    } else if (appLink.length() > 0) {
        writeOk = sendAndroidTvAppLinkPacket(client, appLink);
    } else if (volumeLevel >= 0) {
        const int targetVolume = min(volumeLevel, maxVolume);
        const int keyCode = targetVolume > currentVolume ? 24 : 25;
        const int steps = abs(targetVolume - currentVolume);
        writeOk = true;
        Serial.printf("[AndroidTV] Volumen actual %d/%d; objetivo %d/%d; pasos %d\n",
            currentVolume, maxVolume, targetVolume, maxVolume, steps);
        for (int step = 0; step < steps; step++) {
            if (!sendAndroidTvKeyPacket(client, keyCode)) {
                writeOk = false;
                break;
            }
            vTaskDelay(pdMS_TO_TICKS(60));
        }
    }

    if (!writeOk) {
        client.stop();
        errorMsg = "Fallo al transmitir la orden a la TV";
        return false;
    }

    vTaskDelay(pdMS_TO_TICKS(120)); // Tiempo de latencia para procesar el socket
    client.stop();

    Serial.printf("[AndroidTV] Orden enviada exitosamente a %s:6466\n", host);
    return true;
}

bool executeAndroidTvRemote(const char* host, const char* tlsHostname, const char* serverCertPem, const char* certPem, const char* keyPem, int keyCode, const String& appLink, int volumeLevel, String& errorMsg, bool* powerState, unsigned long mutexTimeoutMs, bool* sessionAcquired) {
    if (sessionAcquired) { *sessionAcquired = false; }
    if (tvRemoteMutex && xSemaphoreTake(tvRemoteMutex, pdMS_TO_TICKS(mutexTimeoutMs)) != pdTRUE) {
        errorMsg = "El control remoto de otra TV sigue ocupado; volvé a intentar";
        return false;
    }
    if (sessionAcquired) { *sessionAcquired = true; }

    const bool success = executeAndroidTvRemoteUnlocked(
        host, tlsHostname, serverCertPem, certPem, keyPem, keyCode, appLink, volumeLevel, errorMsg, powerState
    );

    if (tvRemoteMutex) { xSemaphoreGive(tvRemoteMutex); }
    return success;
}

bool readAndroidTvPowerState(const SmartTvDevice& tv, bool& powerState, bool& sessionAcquired, String& errorMsg) {
    if (!tv.ip || !tv.certPem || !tv.keyPem ||
        !tv.serverCertPem || !tv.tlsHostname ||
        strlen(tv.ip) == 0 || strlen(tv.certPem) == 0 || strlen(tv.keyPem) == 0 ||
        strlen(tv.serverCertPem) == 0 || strlen(tv.tlsHostname) == 0) {
        errorMsg = "Telemetría mTLS no configurada para esta TV";
        return false;
    }

    return executeAndroidTvRemote(
        tv.ip, tv.tlsHostname, tv.serverCertPem, tv.certPem, tv.keyPem,
        -1, "", -1, errorMsg, &powerState, 0, &sessionAcquired
    );
}

void publishTvPowerState(const SmartTvDevice& tv, const char* powerState, const char* reason) {
    const time_t nowSec = time(nullptr);
    if (nowSec < 100000) {
        Serial.println("[TV Status] Esperando sincronización NTP; no se publica un estado sin hora válida.");
        return;
    }

    FirebaseJson status;
    status.set("status", powerState);
    status.set("observedAt", (double)nowSec * 1000.0);
    status.set("reason", reason);
    const String path = String("/home/state/tvPower/") + tv.id;
    if (!Firebase.RTDB.setJSON(&tvStatusData, path.c_str(), &status)) {
        Serial.printf("[TV Status] No se pudo publicar %s: %s\n", tv.id, tvStatusData.errorReason().c_str());
        return;
    }
    Serial.printf("[TV Status] %s: %s (%s)\n", tv.id, powerState, reason);
}

void tvStatusTask(void* param) {
    bool hasPolled = false;
    unsigned long lastPoll = 0;
    for (;;) {
        const bool refreshRequested = tvStatusRefreshRequested;
        const bool intervalElapsed = !hasPolled || millis() - lastPoll >= TV_STATUS_POLL_INTERVAL_MS;
        if (!refreshRequested && !intervalElapsed) {
            vTaskDelay(pdMS_TO_TICKS(500));
            continue;
        }
        if (WiFi.status() != WL_CONNECTED || !Firebase.ready() || time(nullptr) < 100000) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        if (uxQueueMessagesWaiting(cmdQueue) > 0) {
            tvStatusRefreshRequested = true;
            vTaskDelay(pdMS_TO_TICKS(250));
            continue;
        }

        tvStatusRefreshRequested = false;
        hasPolled = true;
        lastPoll = millis();
        for (size_t i = 0; i < NUM_TVS; i++) {
            if (WiFi.status() != WL_CONNECTED || !Firebase.ready()) { break; }
            if (uxQueueMessagesWaiting(cmdQueue) > 0) {
                tvStatusRefreshRequested = true;
                break;
            }

            const SmartTvDevice& tv = SMART_TVS[i];
            bool powerState = false;
            bool sessionAcquired = false;
            String errorMsg;
            const bool hasTlsConfig = tv.certPem && tv.keyPem && tv.serverCertPem && tv.tlsHostname &&
                strlen(tv.certPem) > 0 && strlen(tv.keyPem) > 0 &&
                strlen(tv.serverCertPem) > 0 && strlen(tv.tlsHostname) > 0;
            const bool reported = hasTlsConfig && readAndroidTvPowerState(tv, powerState, sessionAcquired, errorMsg);
            if (hasTlsConfig && !sessionAcquired) {
                Serial.println("[TV Status] Sondeo omitido: hay una orden TV en curso.");
                break;
            }
            publishTvPowerState(
                tv,
                reported ? (powerState ? "on" : "off") : "unknown",
                reported ? "reported" : (hasTlsConfig ? "connection_failed" : "not_configured")
            );
            vTaskDelay(pdMS_TO_TICKS(100));
        }
    }
}

bool handleTvCommand(const String& targetId, const String& action, const String& value, String& errorMsg) {
    Serial.printf("[TV Directo] %s | Acción: %s | Valor: %s\n", targetId.c_str(), action.c_str(), value.c_str());

    const SmartTvDevice* tv = nullptr;
    for (size_t i = 0; i < NUM_TVS; i++) {
        if (targetId == SMART_TVS[i].id) {
            tv = &SMART_TVS[i];
            break;
        }
    }
    if (!tv || !tv->ip || strlen(tv->ip) == 0) {
        errorMsg = "Televisor no encontrado en la configuración";
        Serial.printf("[TV Directo] %s\n", errorMsg.c_str());
        return false;
    }
    if (!tv->certPem || !tv->keyPem || strlen(tv->certPem) == 0) {
        errorMsg = "Televisor sin credenciales mTLS emparejadas";
        Serial.printf("[TV Directo] %s\n", errorMsg.c_str());
        return false;
    }
    if (!tv->serverCertPem || strlen(tv->serverCertPem) == 0 ||
        !tv->tlsHostname || strlen(tv->tlsHostname) == 0) {
        errorMsg = "Televisor sin certificado TLS del servidor configurado";
        Serial.printf("[TV Directo] %s\n", errorMsg.c_str());
        return false;
    }

    if (WiFi.status() != WL_CONNECTED) {
        errorMsg = "ESP32 sin conexión Wi-Fi";
        Serial.printf("[TV Directo] %s\n", errorMsg.c_str());
        return false;
    }

    int keyCode = -1;
    String appLink = "";
    int volumeLevel = -1;

    if (action == "power") {
        keyCode = 26; // KEYCODE_POWER
    } else if (action == "toggle_mute") {
        keyCode = 164; // KEYCODE_VOLUME_MUTE
    } else if (action == "set_volume") {
        volumeLevel = value.toInt();
    } else if (action == "remote_key") {
        if (value == "UP") keyCode = 19;
        else if (value == "DOWN") keyCode = 20;
        else if (value == "LEFT") keyCode = 21;
        else if (value == "RIGHT") keyCode = 22;
        else if (value == "OK" || value == "ENTER") keyCode = 23;
        else if (value == "BACK") keyCode = 4;
        else if (value == "HOME") keyCode = 3;
        else if (value == "MENU") keyCode = 82;
        else if (value == "PLAY_PAUSE") keyCode = 85;
        else if (value == "VOLUME_UP") keyCode = 24;
        else if (value == "VOLUME_DOWN") keyCode = 25;
        else {
            errorMsg = "Tecla no admitida: " + value;
            return false;
        }
    } else if (action == "launch_app") {
        if (value == "YouTube") appLink = "https://www.youtube.com";
        else if (value == "Netflix") appLink = "https://www.netflix.com/title";
        else if (value == "Disney+") appLink = "https://www.disneyplus.com";
        else if (value == "Prime Video") appLink = "https://app.primevideo.com";
        else if (value == "Spotify") appLink = "spotify:";
        else if (value == "Flow") appLink = "https://play.google.com/store/apps/details?id=ar.com.flow.androidtv";
        else appLink = value;
    } else {
        errorMsg = "Acción no reconocida: " + action;
        return false;
    }

    return executeAndroidTvRemote(tv->ip, tv->tlsHostname, tv->serverCertPem, tv->certPem, tv->keyPem, keyCode, appLink, volumeLevel, errorMsg);
}
