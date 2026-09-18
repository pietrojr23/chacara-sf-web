#include "esp_camera.h"
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>

const char* CONFIG_AP_NAME = "ESP32CAM-Setup";
const char* CONFIG_AP_PASS = "12345678";
const char* DEVICE_ID = "esp32cam-portao";

const bool USE_PIR = false;
const int PIR_PIN = 13;
const unsigned long MOTION_COOLDOWN_MS = 12000;
const unsigned long AUTO_TRIGGER_MS = 3000;
const bool USE_FLASH = true;
const int FLASH_PIN = 4;
const int FLASH_BRIGHTNESS = 72;  // 0..255 (evita pico de corrente alto)
const unsigned long PIR_REARM_LOW_MS = 500;
const unsigned long PIR_DEBOUNCE_MS = 120;
const unsigned long FLASH_PREPARE_MS = 120;
const unsigned long FLASH_AFTER_CAPTURE_MS = 40;

const framesize_t CAMERA_FRAME_SIZE = FRAMESIZE_VGA;
const int CAMERA_JPEG_QUALITY = 12;

const char* DEFAULT_DETECTOR_URL = "http://192.168.1.89:5055/analyze";

unsigned long lastTriggerMs = 0;
unsigned long lastHeartbeatMs = 0;
unsigned long lastWifiReconnectTryMs = 0;
unsigned long pirLowSinceMs = 0;
unsigned long lastPirChangeMs = 0;
bool pirArmed = true;
bool manualTriggerRequested = false;
int lastPirRaw = LOW;

char wifiSsid[33] = "";
char wifiPassword[65] = "";
char detectorUrl[192] = "";
char detectorApiKey[65] = "";

WebServer configServer(80);
Preferences prefs;

struct DetectorReply {
  bool ok;
  bool shouldCaptureEvent;
  bool motionDetected;
  bool hasPerson;
  bool hasVehicle;
  int httpCode;
  String body;
};

// AI Thinker ESP32-CAM pins
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

void copyStringToBuffer(const String& src, char* dst, size_t dstSize) {
  if (dstSize == 0) return;
  src.toCharArray(dst, dstSize);
  dst[dstSize - 1] = '\0';
}

void loadConfig() {
  prefs.begin("esp32cam", true);
  copyStringToBuffer(prefs.getString("ssid", ""), wifiSsid, sizeof(wifiSsid));
  copyStringToBuffer(prefs.getString("pass", ""), wifiPassword, sizeof(wifiPassword));
  copyStringToBuffer(prefs.getString("url", DEFAULT_DETECTOR_URL), detectorUrl, sizeof(detectorUrl));
  copyStringToBuffer(prefs.getString("api", ""), detectorApiKey, sizeof(detectorApiKey));
  prefs.end();
}

void saveConfig(const String& ssid, const String& pass, const String& url, const String& apiKey) {
  prefs.begin("esp32cam", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putString("url", url);
  prefs.putString("api", apiKey);
  prefs.end();
}

String htmlFormPage() {
  String page;
  page += "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  page += "<title>ESP32-CAM Setup</title></head><body style='font-family:Arial;padding:16px'>";
  page += "<h2>ESP32-CAM Motion Setup</h2>";
  page += "<form method='POST' action='/save'>";
  page += "WiFi SSID:<br><input name='ssid' style='width:100%' value='" + String(wifiSsid) + "'><br><br>";
  page += "WiFi Password:<br><input name='pass' type='password' style='width:100%' value='" + String(wifiPassword) + "'><br><br>";
  page += "Detector URL:<br><input name='url' style='width:100%' value='" + String(detectorUrl) + "'><br><br>";
  page += "API Key (opcional):<br><input name='api' style='width:100%' value='" + String(detectorApiKey) + "'><br><br>";
  page += "<button type='submit' style='padding:10px 16px'>Salvar e reiniciar</button></form>";
  page += "<p><a href='/status'>Ver status JSON</a></p>";
  page += "<p><a href='/trigger'>Disparar captura manual</a></p>";
  page += "</body></html>";
  return page;
}

void handleRoot() {
  configServer.send(200, "text/html", htmlFormPage());
}

void handleSave() {
  const String ssid = configServer.arg("ssid");
  const String pass = configServer.arg("pass");
  const String url = configServer.arg("url");
  const String api = configServer.arg("api");

  if (ssid.length() == 0 || url.length() == 0) {
    configServer.send(400, "text/plain", "SSID e Detector URL sao obrigatorios.");
    return;
  }

  saveConfig(ssid, pass, url, api);
  configServer.send(200, "text/html", "<h3>Salvo. Reiniciando em 2s...</h3>");
  delay(2000);
  ESP.restart();
}

void handleStatus() {
  const int pirNow = USE_PIR ? digitalRead(PIR_PIN) : -1;
  String json = "{";
  json += "\"ok\":true,";
  json += "\"device\":\"" + String(DEVICE_ID) + "\",";
  json += "\"ssid\":\"" + String(wifiSsid) + "\",";
  json += "\"detector_url\":\"" + String(detectorUrl) + "\",";
  json += "\"mode\":\"" + String(USE_PIR ? "pir" : "scan") + "\",";
  json += "\"wifi_connected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",";
  json += "\"sta_ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"ap_ip\":\"" + WiFi.softAPIP().toString() + "\",";
  json += "\"pir\":" + String(pirNow) + ",";
  json += "\"pir_armed\":" + String(pirArmed ? "true" : "false") + ",";
  json += "\"manual_trigger_pending\":" + String(manualTriggerRequested ? "true" : "false");
  json += "}";
  configServer.send(200, "application/json", json);
}

void handleTrigger() {
  manualTriggerRequested = true;
  configServer.send(200, "text/plain", "OK - captura manual solicitada.");
}

void startConfigPortal() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(CONFIG_AP_NAME, CONFIG_AP_PASS);

  configServer.on("/", HTTP_GET, handleRoot);
  configServer.on("/save", HTTP_POST, handleSave);
  configServer.on("/status", HTTP_GET, handleStatus);
  configServer.on("/trigger", HTTP_GET, handleTrigger);
  configServer.begin();

  Serial.print("Portal de setup: http://");
  Serial.println(WiFi.softAPIP());
}

void connectWiFi(bool force = false) {
  if (!force && WiFi.status() == WL_CONNECTED) return;
  if (strlen(wifiSsid) == 0) return;

  Serial.print("Conectando WiFi SSID: ");
  Serial.println(wifiSsid);

  WiFi.begin(wifiSsid, wifiPassword);
  for (int i = 0; i < 30; i++) {
    if (WiFi.status() == WL_CONNECTED) break;
    delay(400);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi conectado. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi nao conectou.");
  }
}

void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) return;
  const unsigned long now = millis();
  if (now - lastWifiReconnectTryMs < 10000) return;
  lastWifiReconnectTryMs = now;
  connectWiFi(true);
}

void initFlash() {
  if (!USE_FLASH) return;
  ledcAttach(FLASH_PIN, 5000, 8);
  ledcWrite(FLASH_PIN, 0);
}

void setFlash(bool on) {
  if (!USE_FLASH) return;
  ledcWrite(FLASH_PIN, on ? FLASH_BRIGHTNESS : 0);
}

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = CAMERA_FRAME_SIZE;
  config.jpeg_quality = CAMERA_JPEG_QUALITY;
  config.fb_count = 1;
  config.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Erro camera init: 0x%x\n", err);
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
  }

  Serial.println("Camera inicializada.");
  return true;
}

bool shouldTrigger() {
  const unsigned long now = millis();

  if (USE_PIR) {
    const int pirRaw = digitalRead(PIR_PIN);
    if (pirRaw != lastPirRaw) {
      lastPirRaw = pirRaw;
      lastPirChangeMs = now;
    }

    // Debounce simples de borda.
    if (now - lastPirChangeMs < PIR_DEBOUNCE_MS) {
      return false;
    }

    const bool pirHigh = pirRaw == HIGH;

    // Rearma apenas quando o PIR realmente voltar para LOW por um curto periodo.
    if (!pirHigh) {
      if (pirLowSinceMs == 0) {
        pirLowSinceMs = now;
      }
      if (now - pirLowSinceMs >= PIR_REARM_LOW_MS) {
        pirArmed = true;
      }
      return false;
    }

    pirLowSinceMs = 0;
    if (!pirArmed) {
      return false;
    }
    if (now - lastTriggerMs < MOTION_COOLDOWN_MS) {
      return false;
    }
    pirArmed = false;
    return true;
  }

  if (now - lastTriggerMs < AUTO_TRIGGER_MS) {
    return false;
  }
  return true;
}

bool responseFieldIsTrue(const String& body, const char* fieldName) {
  const String needle = String("\"") + fieldName + "\":true";
  return body.indexOf(needle) >= 0;
}

DetectorReply sendFrameToDetector(camera_fb_t* fb, bool scanOnly) {
  DetectorReply reply = {false, false, false, false, false, 0, ""};

  if (!fb || fb->len == 0) {
    Serial.println("Frame vazio.");
    return reply;
  }

  ensureWiFiConnected();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Sem WiFi para enviar frame.");
    return reply;
  }

  if (strlen(detectorUrl) == 0) {
    Serial.println("Detector URL vazio. Configure no portal.");
    return reply;
  }

  HTTPClient http;
  http.setConnectTimeout(6000);
  http.setTimeout(15000);
  http.begin(detectorUrl);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Device-Id", DEVICE_ID);
  if (scanOnly) {
    http.addHeader("X-Scan-Only", "1");
  }
  if (strlen(detectorApiKey) > 0) {
    http.addHeader("X-Api-Key", detectorApiKey);
  }

  reply.httpCode = http.POST(fb->buf, fb->len);
  reply.body = http.getString();
  http.end();

  reply.ok = reply.httpCode >= 200 && reply.httpCode < 300;
  if (reply.ok) {
    reply.shouldCaptureEvent = responseFieldIsTrue(reply.body, "should_capture_event");
    reply.motionDetected = responseFieldIsTrue(reply.body, "motion_detected");
    reply.hasPerson = responseFieldIsTrue(reply.body, "has_person");
    reply.hasVehicle = responseFieldIsTrue(reply.body, "has_vehicle");
  }

  Serial.printf("Detector HTTP %d\n", reply.httpCode);
  if (reply.body.length() > 0) {
    Serial.println(reply.body);
  }

  return reply;
}

camera_fb_t* captureFrame(bool withFlash) {
  if (withFlash && USE_FLASH) {
    Serial.println("Flash ON");
  }
  setFlash(withFlash);
  if (withFlash) {
    delay(FLASH_PREPARE_MS);
  }

  camera_fb_t* fb = esp_camera_fb_get();
  if (withFlash) {
    delay(FLASH_AFTER_CAPTURE_MS);
    setFlash(false);
    Serial.println("Flash OFF");
  }

  if (!fb) {
    Serial.println("Falha ao capturar imagem.");
    return nullptr;
  }

  return fb;
}

void captureAndSendEvent(const char* reason) {
  camera_fb_t* fb = captureFrame(true);
  if (!fb) {
    return;
  }

  Serial.printf("Evento %s! Captura %u bytes\n", reason, fb->len);
  const DetectorReply reply = sendFrameToDetector(fb, false);
  esp_camera_fb_return(fb);

  if (reply.ok) {
    Serial.println("Evento enviado com sucesso.");
  } else {
    Serial.println("Falha ao enviar evento para detector.");
  }
}

void runScanCycle() {
  camera_fb_t* fb = captureFrame(false);
  if (!fb) {
    return;
  }

  Serial.printf("Scan %u bytes\n", fb->len);
  const DetectorReply reply = sendFrameToDetector(fb, true);
  esp_camera_fb_return(fb);

  if (!reply.ok) {
    Serial.println("Falha no scan.");
    return;
  }

  if (reply.shouldCaptureEvent) {
    Serial.println("Evento confirmado no scan. Capturando foto oficial.");
    captureAndSendEvent("movimento");
  }
}

void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\nBoot ESP32-CAM motion detector");

  if (USE_PIR) {
    pinMode(PIR_PIN, INPUT);
    lastPirRaw = digitalRead(PIR_PIN);
    lastPirChangeMs = millis();
  }
  initFlash();

  loadConfig();
  if (strlen(detectorUrl) == 0) {
    copyStringToBuffer(String(DEFAULT_DETECTOR_URL), detectorUrl, sizeof(detectorUrl));
  }

  if (!initCamera()) {
    Serial.println("Camera indisponivel. Reinicie.");
  }

  startConfigPortal();
  connectWiFi(true);
}

void loop() {
  configServer.handleClient();
  ensureWiFiConnected();

  if (manualTriggerRequested && millis() - lastTriggerMs >= 1000) {
    manualTriggerRequested = false;
    lastTriggerMs = millis();
    captureAndSendEvent("manual");
  } else if (shouldTrigger()) {
    lastTriggerMs = millis();
    if (USE_PIR) {
      captureAndSendEvent("pir");
    } else {
      runScanCycle();
    }
  }

  const unsigned long now = millis();
  if (now - lastHeartbeatMs >= 5000) {
    lastHeartbeatMs = now;
    Serial.print("WiFi=");
    Serial.print(WiFi.status());
    Serial.print(" STA_IP=");
    Serial.print(WiFi.localIP());
    Serial.print(" AP_IP=");
    Serial.print(WiFi.softAPIP());
    Serial.print(" PIR=");
    if (USE_PIR) {
      Serial.print(digitalRead(PIR_PIN));
      Serial.print(" armed=");
      Serial.println(pirArmed ? "1" : "0");
    } else {
      Serial.println("AUTO");
    }
  }

  delay(120);
}
