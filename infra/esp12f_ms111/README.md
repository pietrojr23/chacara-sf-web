# ESP-12F + MS-111 (Portao PPA)

Firmware gravado em:
- Porta: `/dev/cu.usbserial-140`
- Chip: `ESP8266EX`
- Sketch: `esp12f_ms111.ino`

## 1) Configurar Wi-Fi (primeira vez)
Ao ligar o ESP sem rede salva, ele cria um AP:
- SSID: `Portao-ESP12F-Setup`
- Senha: `12345678`

Conecte no AP e abra no navegador:
- `http://192.168.4.1`

Selecione seu Wi-Fi da casa e salve.

## 2) Endpoints HTTP
Chave API atual no firmware:
- `N0vaMS111_2026`

Health:
- `GET /health`

Abertura:
- `POST /gate/open?k=N0vaMS111_2026`

Fechamento:
- `POST /gate/close?k=N0vaMS111_2026`

Opcional (endpoint único):
- `POST /gate?k=N0vaMS111_2026` com body contendo `aberto` ou `fechado`.

## 3) Configurar no app
No menu Configurações (proprietário):
- Webhook abrir portão:
  - `http://IP_DO_ESP/gate/open?k=N0vaMS111_2026`
- Webhook fechar portão:
  - `http://IP_DO_ESP/gate/close?k=N0vaMS111_2026`

Substitua `IP_DO_ESP` pelo IP mostrado no seu roteador.

## 4) Teste rápido
```bash
curl -X POST "http://IP_DO_ESP/gate/open?k=N0vaMS111_2026"
curl -X POST "http://IP_DO_ESP/gate/close?k=N0vaMS111_2026"
```

## 5) Pinos (ESP-12F)
- Abrir: GPIO5
- Fechar: GPIO4
- Modo relé: `active low`
