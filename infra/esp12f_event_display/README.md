# ESP-12F Event Display

Painel simples para ESP-12F mostrando o ultimo evento detectado pelo ThinkPad.

Exemplo na telinha:

```text
Pessoa detectada
14:32:08
Conf: 91%
Cam: cam1
```

## Assumicao usada

Este sketch assume:
- ESP8266 / ESP-12F
- OLED SSD1306 128x64 via I2C
- endereco I2C `0x3C`

Se sua telinha usar outro driver, o endpoint do ThinkPad continua igual; trocamos so o sketch.

## Endpoint usado no ThinkPad

O detector agora expõe:

- `GET /display-event`
- `GET /display-event-bitmap`

Exemplo:

```text
http://IP_DO_THINKPAD:5060/display-event
http://IP_DO_THINKPAD:5060/display-event-bitmap
```

Se o detector estiver protegido por `API_KEY`, o sketch envia `?k=...`.

## Bibliotecas Arduino

Instale:
- `ESP8266 Boards`
- `ArduinoJson`
- `Adafruit GFX Library`
- `Adafruit SSD1306`

## Configuracao

O sketch ja vem com estes defaults preenchidos:

- `EVENT_URL = http://192.168.1.218:5060/display-event`
- `EVENT_BITMAP_URL = http://192.168.1.218:5060/display-event-bitmap`
- `API_KEY` vazio

Depois de gravar o ESP, ele cria um AP:

- SSID: `ESP12F-Evento-Setup`
- Senha: `12345678`

Abra:

- `http://192.168.4.1`

E preencha:

- Wi-Fi SSID
- Wi-Fi Password
- Event URL
- Bitmap URL
- API Key se um dia voce ativar no detector

## Pinos I2C comuns

Em placas estilo NodeMCU:
- `D1 / GPIO5` = `SCL`
- `D2 / GPIO4` = `SDA`

No ESP-12F puro, confirme como sua telinha foi ligada.

## Comportamento

- o ESP consulta o ThinkPad a cada `1.5s`
- quando entra evento novo, a tela mostra os dados do evento
- depois alterna entre texto e imagem monocromatica do ultimo evento
- se nao houver evento ainda, mostra `Aguardando evento`
