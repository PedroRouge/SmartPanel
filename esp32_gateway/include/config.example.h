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
#define OTA_PASSWORD "YOUR_SECURE_OTA_PASSWORD"

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
// Replace with each TV's Wi-Fi MAC. The all-zero placeholder deliberately fails WoL validation.
#define TV_LIVING_MAC "00:00:00:00:00:00"
#define TV_PEDRO_MAC "00:00:00:00:00:00"
#define TV_PADRES_MAC "00:00:00:00:00:00"
#define TV_LUCAS_MAC "00:00:00:00:00:00"

#if __has_include("tv_certs.local.h")
#include "tv_certs.local.h"
const SmartTvDevice SMART_TVS[] = {
    { "tv-pedro",  TV_PEDRO_IP,  TV_PEDRO_CERT,  TV_PEDRO_KEY,  TV_PEDRO_SERVER_CERT,  TV_PEDRO_TLS_HOST,  TV_PEDRO_MAC },
    { "tv-living", TV_LIVING_IP, TV_LIVING_CERT, TV_LIVING_KEY, TV_LIVING_SERVER_CERT, TV_LIVING_TLS_HOST, TV_LIVING_MAC },
    { "tv-padres", TV_PADRES_IP, TV_PADRES_CERT, TV_PADRES_KEY, TV_PADRES_SERVER_CERT, TV_PADRES_TLS_HOST, TV_PADRES_MAC },
    { "tv-lucas",  TV_LUCAS_IP,  TV_LUCAS_CERT, TV_LUCAS_KEY, TV_LUCAS_SERVER_CERT, TV_LUCAS_TLS_HOST, TV_LUCAS_MAC }
};
const size_t NUM_TVS = sizeof(SMART_TVS) / sizeof(SMART_TVS[0]);
#else
const SmartTvDevice SMART_TVS[] = {};
const size_t NUM_TVS = 0;
#endif
