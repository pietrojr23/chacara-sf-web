#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>

// ======== CONFIGURACAO ========
const char* API_KEY = "N0vaMS111_2026";
const char* CONFIG_AP_NAME = "Portao-ESP12F-Setup";
const char* CONFIG_AP_PASS = "12345678";

// ESP-12F GPIOs (ajuste conforme sua ligacao no MS-111)
const uint8_t PIN_OPEN  = 5;  // GPIO5  (D1 em placas NodeMCU)
const uint8_t PIN_CLOSE = 4;  // GPIO4  (D2 em placas NodeMCU)
const bool SINGLE_BUTTON_GATE_MODE = true; // PPA normalmente usa botoeira unica (pulso unico)

const bool RELAY_ACTIVE_LOW = true;   // muitos modulos de rele acionam em nivel baixo
const unsigned long PULSE_MS = 700;   // pulso do rele (PPA costuma responder melhor entre 500-800ms)

ESP8266WebServer server(80);
unsigned long lastHeartbeatMs = 0;

void setRelayIdle(uint8_t pin) {
  digitalWrite(pin, RELAY_ACTIVE_LOW ? HIGH : LOW);
}

void pulseRelay(uint8_t pin) {
  digitalWrite(pin, RELAY_ACTIVE_LOW ? LOW : HIGH);
  delay(PULSE_MS);
  setRelayIdle(pin);
}

bool isAuthorized() {
  const String queryKey = server.arg("k");
  const String headerKey = server.header("X-Api-Key");
  return queryKey == API_KEY || headerKey == API_KEY;
}

void sendJson(int code, const String& body) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(code, "application/json", body);
}

void handleHealth() {
  const String body = String("{\"ok\":true,\"ip\":\"") + WiFi.localIP().toString() + "\"}";
  sendJson(200, body);
}

void handleOpen() {
  if (!isAuthorized()) {
    sendJson(401, "{\"ok\":false,\"error\":\"unauthorized\"}");
    return;
  }

  pulseRelay(PIN_OPEN);
  sendJson(200, SINGLE_BUTTON_GATE_MODE
    ? "{\"ok\":true,\"action\":\"aberto\",\"mode\":\"single_button\"}"
    : "{\"ok\":true,\"action\":\"aberto\"}");
}

void handleClose() {
  if (!isAuthorized()) {
    sendJson(401, "{\"ok\":false,\"error\":\"unauthorized\"}");
    return;
  }

  if (SINGLE_BUTTON_GATE_MODE) {
    // Em botoeira única, fechar também é um novo pulso no mesmo relé.
    pulseRelay(PIN_OPEN);
    sendJson(200, "{\"ok\":true,\"action\":\"fechado\",\"mode\":\"single_button\"}");
    return;
  }

  pulseRelay(PIN_CLOSE);
  sendJson(200, "{\"ok\":true,\"action\":\"fechado\"}");
}

// Endpoint unico opcional: /gate com body {"action":"aberto"|"fechado"}
void handleGateUnified() {
  if (!isAuthorized()) {
    sendJson(401, "{\"ok\":false,\"error\":\"unauthorized\"}");
    return;
  }

  const String body = server.arg("plain");
  const bool wantsOpen = body.indexOf("aberto") >= 0 || body.indexOf("open") >= 0;
  const bool wantsClose = body.indexOf("fechado") >= 0 || body.indexOf("close") >= 0;

  if (wantsOpen) {
    pulseRelay(PIN_OPEN);
    sendJson(200, SINGLE_BUTTON_GATE_MODE
      ? "{\"ok\":true,\"action\":\"aberto\",\"mode\":\"single_button\"}"
      : "{\"ok\":true,\"action\":\"aberto\"}");
    return;
  }

  if (wantsClose) {
    if (SINGLE_BUTTON_GATE_MODE) {
      pulseRelay(PIN_OPEN);
      sendJson(200, "{\"ok\":true,\"action\":\"fechado\",\"mode\":\"single_button\"}");
      return;
    }

    pulseRelay(PIN_CLOSE);
    sendJson(200, "{\"ok\":true,\"action\":\"fechado\"}");
    return;
  }

  sendJson(400, "{\"ok\":false,\"error\":\"invalid_action\"}");
}

void handleNotFound() {
  sendJson(404, "{\"ok\":false,\"error\":\"not_found\"}");
}

void setup() {
  pinMode(PIN_OPEN, OUTPUT);
  pinMode(PIN_CLOSE, OUTPUT);
  setRelayIdle(PIN_OPEN);
  setRelayIdle(PIN_CLOSE);

  Serial.begin(115200);
  delay(200);
  Serial.println("\nBoot ESP gate server");

  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(CONFIG_AP_NAME, CONFIG_AP_PASS);
  delay(100);
  Serial.print("AP ativo em http://");
  Serial.println(WiFi.softAPIP());

  // Tenta conectar no ultimo Wi-Fi salvo no ESP (se houver)
  WiFi.begin();

  server.on("/health", HTTP_GET, handleHealth);
  server.on("/gate/open", HTTP_POST, handleOpen);
  server.on("/gate/close", HTTP_POST, handleClose);
  server.on("/gate", HTTP_POST, handleGateUnified);

  server.onNotFound(handleNotFound);
  server.begin();

  Serial.println("ESP gate server pronto");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  server.handleClient();

  const unsigned long now = millis();
  if (now - lastHeartbeatMs >= 5000) {
    lastHeartbeatMs = now;
    Serial.print("WiFi status=");
    Serial.print((int)WiFi.status());
    Serial.print(" STA_IP=");
    Serial.print(WiFi.localIP());
    Serial.print(" AP_IP=");
    Serial.print(WiFi.softAPIP());
    Serial.print(" SSID=");
    Serial.println(WiFi.SSID());
  }
}
