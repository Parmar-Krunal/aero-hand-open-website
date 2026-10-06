/*
 * aero_hand_fsr_sensor.ino
 * ========================
 * Arduino firmware for 5-channel FSR (Force Sensitive Resistor) sensor board
 * connected to an Aero Hand Open fingertip.
 *
 * Hardware:
 *   5× Interlink 402 FSR (or equivalent) — one per fingertip:
 *     Thumb   → A0
 *     Index   → A1
 *     Middle  → A2
 *     Ring    → A3
 *     Pinky   → A4
 *
 *   Wiring each FSR:
 *     3.3 V ──[FSR]── A_pin ──[10 kΩ]── GND
 *     (voltage divider: higher force → lower resistance → higher ADC reading)
 *
 * Output format (9600 baud, one line per sample at ~50 Hz):
 *   FSR:512,341,280,190,420
 *   Where each value is a raw 10-bit ADC reading (0–1023)
 *
 * The digital_twin_bridge.py reads these values and converts to Newtons:
 *   Force(N) ≈ raw / 1023 × 15.0
 *
 * Optional: also streams finger bend in compact JSON every 250 ms
 *   (useful for debugging without the bridge):
 *   {"t":1234567,"fsr":[512,341,280,190,420],"force_n":[7.5,5.0,4.1,2.8,6.2]}
 *
 * License: Apache-2.0 (same as Aero Hand Open firmware)
 */

// ── Pin configuration ────────────────────────────────────────────────────
const int FSR_PINS[5] = { A0, A1, A2, A3, A4 };
const char* FINGER_NAMES[5] = { "thumb", "index", "middle", "ring", "pinky" };

// ── Settings ─────────────────────────────────────────────────────────────
const int    SAMPLE_RATE_HZ    = 50;         // compact serial output rate
const int    JSON_RATE_MS      = 250;        // optional JSON debug output
const float  FSR_MAX_FORCE_N   = 15.0f;     // full-scale force (Interlink 402 ~15 N)
const float  ADC_MAX           = 1023.0f;

// ── State ─────────────────────────────────────────────────────────────────
int   fsr_raw[5];
float fsr_force_n[5];
unsigned long last_sample_us   = 0;
unsigned long last_json_ms     = 0;
const unsigned long PERIOD_US  = 1000000UL / SAMPLE_RATE_HZ;

// ── Setup ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(9600);
  // Allow ADC to settle
  delay(100);
  for (int i = 0; i < 5; i++) {
    pinMode(FSR_PINS[i], INPUT);
  }
  Serial.println("# Aero Hand FSR Sensor Board ready");
  Serial.println("# Format: FSR:thumb,index,middle,ring,pinky (raw 0-1023)");
}

// ── Main loop ─────────────────────────────────────────────────────────────
void loop() {
  unsigned long now_us = micros();
  if ((now_us - last_sample_us) >= PERIOD_US) {
    last_sample_us = now_us;

    // Sample all 5 FSR channels
    for (int i = 0; i < 5; i++) {
      fsr_raw[i]     = analogRead(FSR_PINS[i]);
      fsr_force_n[i] = (fsr_raw[i] / ADC_MAX) * FSR_MAX_FORCE_N;
    }

    // Compact output (parsed by digital_twin_bridge.py)
    Serial.print("FSR:");
    for (int i = 0; i < 5; i++) {
      Serial.print(fsr_raw[i]);
      if (i < 4) Serial.print(',');
    }
    Serial.println();
  }

  // Optional JSON debug output every 250 ms
  unsigned long now_ms = millis();
  if ((now_ms - last_json_ms) >= (unsigned long)JSON_RATE_MS) {
    last_json_ms = now_ms;
    print_json(now_ms);
  }
}

// ── JSON debug helper ──────────────────────────────────────────────────────
void print_json(unsigned long ts) {
  Serial.print("{\"t\":");
  Serial.print(ts);
  Serial.print(",\"fsr\":[");
  for (int i = 0; i < 5; i++) {
    Serial.print(fsr_raw[i]);
    if (i < 4) Serial.print(',');
  }
  Serial.print("],\"force_n\":[");
  for (int i = 0; i < 5; i++) {
    Serial.print(fsr_force_n[i], 2);
    if (i < 4) Serial.print(',');
  }
  Serial.println("]}");
}
