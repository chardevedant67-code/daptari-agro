// ============================================================
//  WeighingQR — Calibration Sketch
//  Pehle YEH run karo, calibration factor nikalo,
//  phir woh factor main sketch mein daalo.
// ============================================================

#include "HX711.h"

#define HX711_DT  4
#define HX711_SCK 5

HX711 scale;

void setup() {
  Serial.begin(115200);
  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale();   // no calibration yet
  scale.tare();        // zero

  Serial.println("=== CALIBRATION MODE ===");
  Serial.println("Platform KHALI rakho, phir Enter dabaao...");
}

void loop() {
  if (Serial.available()) {
    char c = Serial.read();

    if (c == '\n' || c == '\r') {
      scale.tare();
      Serial.println("Tared! Ab KNOWN weight rakho (jaise 500g ya 1kg)");
      Serial.println("Rakhne ke baad weight grams mein type karo aur Enter dabaao:");
    }

    // User ne weight type kiya
    if (c >= '0' && c <= '9') {
      // Read full number
      String input = String(c);
      while (Serial.available()) {
        char n = Serial.read();
        if (n == '\n' || n == '\r') break;
        input += n;
      }

      float knownWeight = input.toFloat();
      if (knownWeight <= 0) return;

      long rawReading = scale.get_value(10);  // 10 readings average
      float factor = (float)rawReading / knownWeight;

      Serial.printf("\nRaw reading: %ld\n", rawReading);
      Serial.printf("Known weight: %.1f g\n", knownWeight);
      Serial.printf("\n>>> CALIBRATION FACTOR = %.2f <<<\n", factor);
      Serial.println("Yeh value main sketch mein CALIBRATION_FACTOR mein daalo!");

      // Verify karo
      scale.set_scale(factor);
      Serial.printf("Verify: %.1f g (should be ~%.1f g)\n",
                    scale.get_units(5), knownWeight);
    }
  }

  // Live raw reading dikhao
  Serial.printf("Raw: %ld\n", scale.get_value(1));
  delay(500);
}
