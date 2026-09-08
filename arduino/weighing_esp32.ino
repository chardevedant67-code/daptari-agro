// ============================================================
//  WeighingQR — ESP32 Seed Scale Firmware
//  Hardware: ESP32 + HX711 + Load Cell (5kg or 10kg)
//
//  Connections:
//    HX711 DT  → GPIO 4
//    HX711 SCK → GPIO 5
//    HX711 VCC → 3.3V
//    HX711 GND → GND
// ============================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "HX711.h"

// ─── CONFIG — CHANGE THESE ───────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_NAME";       // apna WiFi naam
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";   // apna WiFi password

const char* SERVER_IP     = "192.168.31.141";        // server wala machine ka IP (.env mein hai)
const int   SERVER_PORT   = 5001;
const char* MACHINE_ID    = "MACHINE-001";           // admin panel mein jo machineId daala hai

// Calibration factor — pehle run karo phir adjust karo (neeche samjhaya hai)
float CALIBRATION_FACTOR = -430.0;

// ─── PINS ────────────────────────────────────────────────────
#define HX711_DT  4
#define HX711_SCK 5

// ─── TIMING ──────────────────────────────────────────────────
const unsigned long PUSH_INTERVAL_MS   = 1000;   // har 1 sec mein server pe push
const unsigned long STABLE_WINDOW_MS   = 800;    // kitne ms stable rahe toh "stable" maane
const float         STABLE_THRESHOLD_G = 2.0;    // ±2g ke andar rahe toh stable

// ─── GLOBALS ─────────────────────────────────────────────────
HX711 scale;
unsigned long lastPushMs    = 0;
unsigned long stableStartMs = 0;
float         lastReading   = 0;
bool          isStable      = false;

// ─────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n=== WeighingQR ESP32 Firmware ===");

  // HX711 init
  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare();   // zero karo startup pe
  Serial.println("[SCALE] Tared (zeroed)");

  // WiFi connect
  connectWiFi();
}

void loop() {
  // WiFi gira toh reconnect
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Disconnected, reconnecting...");
    connectWiFi();
    return;
  }

  if (!scale.is_ready()) return;

  // Weight padho (grams mein)
  float grams = scale.get_units(3);   // 3 readings ka average
  if (grams < 0) grams = 0;           // negative nahi chahiye

  float kg = grams / 1000.0;

  // Stability check
  checkStability(grams);

  // Serial monitor pe dikhao
  Serial.printf("[WEIGHT] %.1f g  (%.3f kg)  %s\n",
                grams, kg, isStable ? "STABLE ✓" : "...");

  // Push to server har PUSH_INTERVAL_MS
  unsigned long now = millis();
  if (now - lastPushMs >= PUSH_INTERVAL_MS) {
    lastPushMs = now;
    pushWeight(kg);
  }

  delay(200);
}

// ─── WiFi Connect ────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Failed — will retry in loop");
  }
}

// ─── Push weight to server ───────────────────────────────────
void pushWeight(float kg) {
  if (WiFi.status() != WL_CONNECTED) return;

  String url = String("http://") + SERVER_IP + ":" + SERVER_PORT + "/p/api/weight/push";

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(3000);

  // JSON body
  StaticJsonDocument<128> doc;
  doc["weight"]    = round(kg * 1000.0) / 1000.0;  // 3 decimal places
  doc["unit"]      = "kg";
  doc["machineId"] = MACHINE_ID;

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);

  if (httpCode == 200) {
    Serial.printf("[HTTP] Pushed %.3f kg ✓\n", kg);
  } else {
    Serial.printf("[HTTP] Error %d\n", httpCode);
  }

  http.end();
}

// ─── Stability check ─────────────────────────────────────────
void checkStability(float grams) {
  if (abs(grams - lastReading) <= STABLE_THRESHOLD_G) {
    if (!isStable && (millis() - stableStartMs >= STABLE_WINDOW_MS)) {
      isStable = true;
    }
  } else {
    isStable      = false;
    stableStartMs = millis();
  }
  lastReading = grams;
}
