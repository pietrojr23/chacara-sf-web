#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <EEPROM.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <time.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// Assumindo OLED SSD1306 128x64 via I2C.
// Agora o ESP cria um portal de configuracao, entao nao precisa editar Wi-Fi no codigo.

const char* CONFIG_AP_NAME = "ESP12F-Evento-Setup";
const char* CONFIG_AP_PASS = "12345678";
const char* DEFAULT_EVENT_URL = "http://IP_DO_THINKPAD:5060/display-event";
const uint32_t POLL_MS = 1500;
const uint32_t WIFI_RETRY_MS = 5000;
const uint32_t EVENT_HOLD_MS = 5UL * 60UL * 1000UL;
const int32_t THINKPAD_UTC_OFFSET_SECONDS = -3 * 60 * 60;

const uint8_t SCREEN_WIDTH = 128;
const uint8_t SCREEN_HEIGHT = 64;
const int8_t OLED_RESET = -1;
const uint8_t OLED_ADDR = 0x3C;
const size_t WIFI_SSID_SIZE = 33;
const size_t WIFI_PASS_SIZE = 65;
const size_t URL_SIZE = 192;
const size_t API_KEY_SIZE = 65;
const char CONFIG_MAGIC[] = "EVTDSP1";

struct SavedConfig {
  char magic[8];
  char wifiSsid[WIFI_SSID_SIZE];
  char wifiPass[WIFI_PASS_SIZE];
  char eventUrl[URL_SIZE];
  char apiKey[API_KEY_SIZE];
};

struct EventPanel {
  bool hasEvent = false;
  String eventId;
  String rawLabel = "";
  String title = "Aguardando";
  String displayLabel = "Evento";
  String timestamp = "";
  String timeText = "--:--:--";
  int confidencePct = 0;
  String cameraName = "cam1";
  bool hasEventAgeMs = false;
  uint32_t eventAgeMs = 0;
};

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
ESP8266WebServer configServer(80);

SavedConfig config;
EventPanel currentPanel;
String lastEventId;
uint32_t lastPollMs = 0;
uint32_t lastWifiRetryMs = 0;
uint32_t lastEventSeenMs = 0;
bool displaySleeping = false;

void copyStringToBuffer(const String& src, char* dst, size_t dstSize) {
  if (dstSize == 0) {
    return;
  }
  src.toCharArray(dst, dstSize);
  dst[dstSize - 1] = '\0';
}

String shortenLine(const String& value, size_t maxLen) {
  if (value.length() <= maxLen) {
    return value;
  }
  if (maxLen <= 3) {
    return value.substring(0, maxLen);
  }
  return value.substring(0, maxLen - 3) + "...";
}

String htmlEscape(String value) {
  value.replace("&", "&amp;");
  value.replace("<", "&lt;");
  value.replace(">", "&gt;");
  value.replace("\"", "&quot;");
  value.replace("'", "&#39;");
  return value;
}

bool isDisplayableLabel(String label) {
  label.trim();
  label.toLowerCase();
  return label == "person" || label == "bicycle" || label == "car" || label == "motorcycle" || label == "bus" ||
         label == "truck";
}

int monthFromHttpName(const char* monthName) {
  if (strcmp(monthName, "Jan") == 0) return 1;
  if (strcmp(monthName, "Feb") == 0) return 2;
  if (strcmp(monthName, "Mar") == 0) return 3;
  if (strcmp(monthName, "Apr") == 0) return 4;
  if (strcmp(monthName, "May") == 0) return 5;
  if (strcmp(monthName, "Jun") == 0) return 6;
  if (strcmp(monthName, "Jul") == 0) return 7;
  if (strcmp(monthName, "Aug") == 0) return 8;
  if (strcmp(monthName, "Sep") == 0) return 9;
  if (strcmp(monthName, "Oct") == 0) return 10;
  if (strcmp(monthName, "Nov") == 0) return 11;
  if (strcmp(monthName, "Dec") == 0) return 12;
  return 0;
}

int64_t civilDaysSinceUnixEpoch(int year, unsigned month, unsigned day) {
  year -= month <= 2;
  const int era = (year >= 0 ? year : year - 399) / 400;
  const unsigned yoe = static_cast<unsigned>(year - era * 400);
  const unsigned doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097LL + static_cast<int64_t>(doe) - 719468LL;
}

int64_t civilToUnixSeconds(int year, unsigned month, unsigned day, unsigned hour, unsigned minute, unsigned second) {
  return civilDaysSinceUnixEpoch(year, month, day) * 86400LL + static_cast<int64_t>(hour) * 3600LL +
         static_cast<int64_t>(minute) * 60LL + static_cast<int64_t>(second);
}

bool parseIsoTimestampLocal(const String& text, int& year, int& month, int& day, int& hour, int& minute, int& second) {
  return sscanf(text.c_str(), "%d-%d-%dT%d:%d:%d", &year, &month, &day, &hour, &minute, &second) == 6;
}

bool parseHttpDateUtc(const String& text, int& year, int& month, int& day, int& hour, int& minute, int& second) {
  char weekDay[4] = {0};
  char monthName[4] = {0};
  char timezone[4] = {0};
  if (sscanf(text.c_str(), "%3s, %d %3s %d %d:%d:%d %3s", weekDay, &day, monthName, &year, &hour, &minute, &second,
             timezone) != 8) {
    return false;
  }
  month = monthFromHttpName(monthName);
  return month > 0;
}

bool tryBuildEventAgeMs(const String& eventTimestamp, const String& serverDate, uint32_t& eventAgeMs) {
  int eventYear = 0;
  int eventMonth = 0;
  int eventDay = 0;
  int eventHour = 0;
  int eventMinute = 0;
  int eventSecond = 0;
  int serverYear = 0;
  int serverMonth = 0;
  int serverDay = 0;
  int serverHour = 0;
  int serverMinute = 0;
  int serverSecond = 0;

  if (!parseIsoTimestampLocal(eventTimestamp, eventYear, eventMonth, eventDay, eventHour, eventMinute, eventSecond)) {
    return false;
  }

  if (!parseHttpDateUtc(serverDate, serverYear, serverMonth, serverDay, serverHour, serverMinute, serverSecond)) {
    return false;
  }

  const int64_t eventUtcSeconds = civilToUnixSeconds(eventYear, eventMonth, eventDay, eventHour, eventMinute, eventSecond)
                                  - static_cast<int64_t>(THINKPAD_UTC_OFFSET_SECONDS);
  const int64_t serverUtcSeconds =
      civilToUnixSeconds(serverYear, serverMonth, serverDay, serverHour, serverMinute, serverSecond);

  if (serverUtcSeconds <= eventUtcSeconds) {
    eventAgeMs = 0;
    return true;
  }

  const int64_t deltaSeconds = serverUtcSeconds - eventUtcSeconds;
  if (deltaSeconds >= static_cast<int64_t>(UINT32_MAX / 1000UL)) {
    eventAgeMs = UINT32_MAX;
  } else {
    eventAgeMs = static_cast<uint32_t>(deltaSeconds * 1000LL);
  }
  return true;
}

uint32_t buildEventSeenMs(const EventPanel& panel, uint32_t now) {
  if (!panel.hasEventAgeMs) {
    return now;
  }
  const uint32_t effectiveAgeMs = min<uint32_t>(panel.eventAgeMs, EVENT_HOLD_MS);
  return now - effectiveAgeMs;
}

void setDefaultConfig() {
  memset(&config, 0, sizeof(config));
  strncpy(config.magic, CONFIG_MAGIC, sizeof(config.magic) - 1);
  copyStringToBuffer("", config.wifiSsid, sizeof(config.wifiSsid));
  copyStringToBuffer("", config.wifiPass, sizeof(config.wifiPass));
  copyStringToBuffer(DEFAULT_EVENT_URL, config.eventUrl, sizeof(config.eventUrl));
  copyStringToBuffer("", config.apiKey, sizeof(config.apiKey));
}

void loadConfig() {
  EEPROM.begin(sizeof(SavedConfig));
  EEPROM.get(0, config);

  if (strncmp(config.magic, CONFIG_MAGIC, strlen(CONFIG_MAGIC)) != 0) {
    setDefaultConfig();
    return;
  }

  config.magic[sizeof(config.magic) - 1] = '\0';
  config.wifiSsid[sizeof(config.wifiSsid) - 1] = '\0';
  config.wifiPass[sizeof(config.wifiPass) - 1] = '\0';
  config.eventUrl[sizeof(config.eventUrl) - 1] = '\0';
  config.apiKey[sizeof(config.apiKey) - 1] = '\0';

  if (strlen(config.eventUrl) == 0) {
    copyStringToBuffer(DEFAULT_EVENT_URL, config.eventUrl, sizeof(config.eventUrl));
  }

  // Migra configuracoes da versao antiga com bitmap_url salvo em EEPROM.
  const String migratedApiKey = String(config.apiKey);
  if (migratedApiKey.startsWith("http://") || migratedApiKey.startsWith("https://")) {
    copyStringToBuffer("", config.apiKey, sizeof(config.apiKey));
    saveConfig();
  }
}

void saveConfig() {
  strncpy(config.magic, CONFIG_MAGIC, sizeof(config.magic) - 1);
  config.magic[sizeof(config.magic) - 1] = '\0';
  EEPROM.put(0, config);
  EEPROM.commit();
}

String buildUrlWithKey(const char* baseUrl) {
  String url = String(baseUrl);
  if (strlen(config.apiKey) == 0) {
    return url;
  }

  if (url.indexOf('?') >= 0) {
    url += "&k=";
  } else {
    url += "?k=";
  }
  url += config.apiKey;
  return url;
}

void wakeDisplayIfNeeded() {
  if (displaySleeping) {
    display.ssd1306_command(SSD1306_DISPLAYON);
    displaySleeping = false;
    delay(10);
  }
}

void drawLines(const String& l1, const String& l2, const String& l3, const String& l4) {
  wakeDisplayIfNeeded();
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 0);
  display.println(shortenLine(l1, 21));
  display.setCursor(0, 18);
  display.println(shortenLine(l2, 21));
  display.setCursor(0, 34);
  display.println(shortenLine(l3, 21));
  display.setCursor(0, 50);
  display.println(shortenLine(l4, 21));
  display.display();
}

void drawStatus(const String& line1, const String& line2 = "", const String& line3 = "", const String& line4 = "") {
  drawLines(line1, line2, line3, line4);
}

String buildDisplayLabel(const EventPanel& panel) {
  String label = panel.displayLabel;
  label.trim();
  if (label.length() == 0) {
    label = panel.title;
  }
  label.replace(" detectada", "");
  label.replace(" detectado", "");
  label.replace(" Detectada", "");
  label.replace(" Detectado", "");
  label.trim();
  if (label.length() == 0) {
    label = "Evento";
  }
  label.toUpperCase();
  return label;
}

void drawCenteredText(const String& text, int16_t y, uint8_t textSize, uint16_t color, bool bold = false) {
  display.setTextSize(textSize);
  display.setTextColor(color);

  int16_t x1 = 0;
  int16_t y1 = 0;
  uint16_t w = 0;
  uint16_t h = 0;
  display.getTextBounds(text, 0, y, &x1, &y1, &w, &h);

  int16_t x = (SCREEN_WIDTH - static_cast<int16_t>(w)) / 2;
  if (x < 0) {
    x = 0;
  }

  display.setCursor(x, y);
  display.print(text);
  if (bold) {
    display.setCursor(min<int16_t>(SCREEN_WIDTH - 1, x + 1), y);
    display.print(text);
  }
}

void drawEventPanel(const EventPanel& panel) {
  const String label = buildDisplayLabel(panel);
  const uint8_t labelSize = label.length() <= 10 ? 2 : 1;
  const String confidenceText = String("Confianca ") + String(panel.confidencePct) + "%";

  wakeDisplayIfNeeded();
  display.clearDisplay();
  display.drawRoundRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, 6, SSD1306_WHITE);
  display.fillRoundRect(4, 4, SCREEN_WIDTH - 8, 24, 4, SSD1306_WHITE);

  drawCenteredText(label, labelSize == 2 ? 8 : 11, labelSize, SSD1306_BLACK, true);

  display.drawLine(12, 33, SCREEN_WIDTH - 13, 33, SSD1306_WHITE);
  drawCenteredText(panel.timeText, 38, 2, SSD1306_WHITE, false);
  drawCenteredText(confidenceText, 54, 1, SSD1306_WHITE, false);

  display.display();
}

void sleepDisplayIfNeeded() {
  if (displaySleeping) {
    return;
  }
  display.clearDisplay();
  display.display();
  display.ssd1306_command(SSD1306_DISPLAYOFF);
  displaySleeping = true;
}

String htmlFormPage() {
  String page;
  page += "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  page += "<title>ESP12F Event Display Setup</title></head><body style='font-family:Arial;padding:16px'>";
  page += "<h2>ESP12F Event Display</h2>";
  page += "<p>AP: <b>" + String(CONFIG_AP_NAME) + "</b> / senha: <b>" + String(CONFIG_AP_PASS) + "</b></p>";
  page += "<form method='POST' action='/save'>";
  page += "WiFi SSID:<br><input name='ssid' style='width:100%' value='" + htmlEscape(String(config.wifiSsid)) + "'><br><br>";
  page += "WiFi Password:<br><input name='pass' type='password' style='width:100%' value='" + htmlEscape(String(config.wifiPass)) + "'><br><br>";
  page += "Event URL:<br><input name='event_url' style='width:100%' value='" + htmlEscape(String(config.eventUrl)) + "'><br><br>";
  page += "API Key (opcional):<br><input name='api_key' style='width:100%' value='" + htmlEscape(String(config.apiKey)) + "'><br><br>";
  page += "<button type='submit' style='padding:10px 16px'>Salvar e reiniciar</button></form>";
  page += "<p><a href='/status'>Ver status JSON</a></p>";
  page += "</body></html>";
  return page;
}

void handleRoot() {
  configServer.send(200, "text/html", htmlFormPage());
}

void handleSave() {
  const String ssid = configServer.arg("ssid");
  const String pass = configServer.arg("pass");
  const String eventUrl = configServer.arg("event_url");
  const String apiKey = configServer.arg("api_key");

  if (ssid.length() == 0 || eventUrl.length() == 0) {
    configServer.send(400, "text/plain", "SSID e Event URL sao obrigatorios.");
    return;
  }

  copyStringToBuffer(ssid, config.wifiSsid, sizeof(config.wifiSsid));
  copyStringToBuffer(pass, config.wifiPass, sizeof(config.wifiPass));
  copyStringToBuffer(eventUrl, config.eventUrl, sizeof(config.eventUrl));
  copyStringToBuffer(apiKey, config.apiKey, sizeof(config.apiKey));
  saveConfig();

  configServer.send(200, "text/html", "<h3>Configuracao salva. Reiniciando em 2s...</h3>");
  delay(2000);
  ESP.restart();
}

void handleStatus() {
  String json = "{";
  json += "\"ok\":true,";
  json += "\"wifi_connected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",";
  json += "\"ssid\":\"" + String(config.wifiSsid) + "\",";
  json += "\"event_url\":\"" + String(config.eventUrl) + "\",";
  json += "\"api_key_configured\":" + String(strlen(config.apiKey) > 0 ? "true" : "false") + ",";
  json += "\"sta_ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"ap_ip\":\"" + WiFi.softAPIP().toString() + "\"";
  json += "}";
  configServer.send(200, "application/json", json);
}

void startConfigPortal() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(CONFIG_AP_NAME, CONFIG_AP_PASS);

  configServer.on("/", HTTP_GET, handleRoot);
  configServer.on("/save", HTTP_POST, handleSave);
  configServer.on("/status", HTTP_GET, handleStatus);
  configServer.begin();
}

void connectWifiIfNeeded() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (strlen(config.wifiSsid) == 0) {
    drawStatus("Configurar Wi-Fi", "Abra 192.168.4.1", CONFIG_AP_NAME, CONFIG_AP_PASS);
    return;
  }

  const uint32_t now = millis();
  if (now - lastWifiRetryMs < WIFI_RETRY_MS) {
    return;
  }
  lastWifiRetryMs = now;

  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(config.wifiSsid, config.wifiPass);
  drawStatus("Conectando Wi-Fi", config.wifiSsid, "Aguarde...");
}

bool fetchLatestEvent(EventPanel& panel) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(4000);
  const char* headerKeys[] = {"Date"};
  http.collectHeaders(headerKeys, 1);

  if (!http.begin(client, buildUrlWithKey(config.eventUrl))) {
    return false;
  }

  const int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    http.end();
    return false;
  }

  const String payload = http.getString();
  const String serverDate = http.header("Date");
  http.end();

  DynamicJsonDocument doc(2048);
  const DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    return false;
  }

  panel.hasEvent = doc["has_event"] | false;
  panel.eventId = String((const char*)(doc["event_id"] | ""));
  panel.rawLabel = String((const char*)(doc["label"] | ""));
  panel.title = String((const char*)(doc["title"] | "Aguardando evento"));
  panel.displayLabel = String((const char*)(doc["label_pt"] | doc["label"] | doc["title"] | "Evento"));
  panel.timestamp = String((const char*)(doc["timestamp"] | ""));
  panel.timeText = String((const char*)(doc["time"] | "--:--:--"));
  panel.confidencePct = doc["confidence_pct"] | 0;
  panel.cameraName = String((const char*)(doc["camera_name"] | "cam1"));
  panel.hasEventAgeMs = tryBuildEventAgeMs(panel.timestamp, serverDate, panel.eventAgeMs);

  if (panel.hasEvent && !isDisplayableLabel(panel.rawLabel)) {
    panel.hasEvent = false;
    panel.eventId = "";
  }
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(200);

  Wire.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("Falha ao iniciar OLED");
    return;
  }

  loadConfig();
  startConfigPortal();

  drawStatus("Painel de evento", "Iniciando...", WiFi.softAPIP().toString());
  connectWifiIfNeeded();
}

void loop() {
  configServer.handleClient();
  connectWifiIfNeeded();

  if (WiFi.status() != WL_CONNECTED) {
    if (strlen(config.wifiSsid) == 0) {
      drawStatus("Configurar Wi-Fi", "http://192.168.4.1", CONFIG_AP_NAME, CONFIG_AP_PASS);
    } else {
      drawStatus("Wi-Fi desconectado", "Tentando reconectar", config.wifiSsid, WiFi.softAPIP().toString());
    }
    delay(250);
    return;
  }

  const uint32_t now = millis();
  if (now - lastPollMs < POLL_MS) {
    delay(50);
    return;
  }
  lastPollMs = now;

  EventPanel panel;
  if (!fetchLatestEvent(panel)) {
    drawStatus("ThinkPad offline?", WiFi.localIP().toString(), "Falha no /display-event");
    delay(250);
    return;
  }

  if (!panel.hasEvent) {
    if (lastEventId.length() == 0) {
      sleepDisplayIfNeeded();
    } else if ((millis() - lastEventSeenMs) < EVENT_HOLD_MS && currentPanel.eventId.length() > 0) {
      drawEventPanel(currentPanel);
    } else if (millis() - lastEventSeenMs >= EVENT_HOLD_MS) {
      sleepDisplayIfNeeded();
    }
    delay(100);
    return;
  }

  if (panel.eventId != lastEventId) {
    lastEventId = panel.eventId;
    currentPanel = panel;
    lastEventSeenMs = buildEventSeenMs(panel, now);
    if ((now - lastEventSeenMs) < EVENT_HOLD_MS) {
      drawEventPanel(currentPanel);
    } else {
      sleepDisplayIfNeeded();
    }
    Serial.println(String("Novo evento: ") + currentPanel.title + " " + currentPanel.timeText);
  } else if (currentPanel.eventId.length() == 0) {
    currentPanel = panel;
    lastEventSeenMs = buildEventSeenMs(panel, now);
    if ((now - lastEventSeenMs) < EVENT_HOLD_MS) {
      drawEventPanel(currentPanel);
    } else {
      sleepDisplayIfNeeded();
    }
  }

  if (currentPanel.eventId.length() > 0 && (now - lastEventSeenMs) < EVENT_HOLD_MS) {
    drawEventPanel(currentPanel);
  } else if (currentPanel.eventId.length() > 0) {
    sleepDisplayIfNeeded();
  }

  delay(100);
}
