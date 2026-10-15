#pragma once

// Copy to config.local.h (ignored by Git) and replace every value.
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ESP32-S3-N16R8 dual-USB board: onboard RGB LED is on GPIO48.
// #define RGB_LED_PIN 48

#define FIREBASE_API_KEY "YOUR_FIREBASE_WEB_API_KEY"
#define FIREBASE_DATABASE_URL "https://YOUR_PROJECT-default-rtdb.firebaseio.com"
#define FIREBASE_USER_EMAIL "esp32@YOUR_PROJECT.local"
#define FIREBASE_USER_PASSWORD "REPLACE_WITH_A_UNIQUE_DEVICE_PASSWORD"

#define SMART_PANEL_LOCAL_NETWORK_CONFIG
const WifiSmartDevice SMART_LIGHTS[] = {
    { "living", "192.168.1.101", PROTO_TASMOTA },
    { "kitchen", "192.168.1.102", PROTO_SHELLY },
    { "bedroom", "192.168.1.103", PROTO_TASMOTA },
    { "garden", "192.168.1.104", PROTO_SHELLY }
};
const size_t NUM_LIGHTS = sizeof(SMART_LIGHTS) / sizeof(SMART_LIGHTS[0]);

#define POOL_RELAY_IP "192.168.1.110"
#define POOL_RELAY_PROTOCOL PROTO_SHELLY
#define GATE_RELAY_IP "192.168.1.111"
#define GATE_RELAY_PULSE_URL "http://192.168.1.111/relay/0?turn=on&timer=1"
#define TV_LIVING_IP "192.168.1.52"
#define TV_PEDRO_IP "192.168.1.10"
#define TV_PADRES_IP "192.168.1.53"
#define TV_LUCAS_IP "192.168.1.51"
