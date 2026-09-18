# MS-111 Tuya Bridge (Webhook -> Tuya)

Este serviço permite que o app continue usando os campos de webhook de portão, mas o comando final vai para o módulo **NovaDigital MS-111 (Tuya/Smart Life)**.

## Como funciona
- App chama:
  - `POST /gate/open`
  - `POST /gate/close`
  - `POST /headlights/toggle` (com `virtual_id` no body)
- Bridge chama Tuya Cloud:
  - `POST /v1.0/iot-03/devices/{device_id}/commands`

## Pré-requisitos
- Conta Tuya IoT Platform vinculada ao seu app Smart Life/Tuya.
- Projeto Cloud com APIs de controle de dispositivo habilitadas.
- `Access ID`, `Access Secret`, `Device ID`, `Data Center`.

## 1) Configurar variáveis
```bash
cd "/Users/junior/Downloads/Chacara Sao Francisco/infra/ms111-tuya-bridge"
cp .env.example .env
```

Preencha no `.env`:
- `TUYA_BASE_URL` (ex.: `https://openapi.tuyaus.com`)
- `TUYA_BASE_URLS` (opcional, lista separada por vírgula para fallback automático)
- `TUYA_ACCESS_KEY`
- `TUYA_SECRET_KEY`
- `TUYA_DEVICE_ID`
- `BRIDGE_API_KEY`

Para PPA com botoeira única:
- `SINGLE_BUTTON_MODE=true`
- `OPEN_COMMAND_CODE=switch_1`
- `PULSE_MS=700`

Para faróis (interruptor):
- `HEADLIGHTS_COMMAND_CODE=switch_1`
- `HEADLIGHTS_ON_VALUE=true`
- `HEADLIGHTS_OFF_VALUE=false`

## 2) Rodar local (Node)
```bash
npm install
npm start
```

Teste:
```bash
curl "http://127.0.0.1:8787/health"
curl "http://127.0.0.1:8787/tuya/device/functions?k=SEU_BRIDGE_API_KEY"
```

Diagnóstico rápido de região Tuya:
```bash
npm run diagnose
```

## 3) Rodar com Docker
```bash
docker compose up -d --build
```

## 4) Deploy automático na VPS (Google Cloud)
```bash
./deploy-gcp-vps.sh usuario@IP_DA_VPS
```

Exemplo:
```bash
./deploy-gcp-vps.sh pietrojr2@34.151.223.146 34.151.223.146 8787
```

Esse script:
- instala Docker na VPS (se faltar)
- sobe o container do bridge
- testa `/health` local na VPS
- imprime as URLs de webhook prontas para o app

## 5) Configurar no app
No app (Configurações do proprietário):
- Webhook abrir portão:
  - `http://IP_DO_SERVIDOR:8787/gate/open?k=SEU_BRIDGE_API_KEY`
- Webhook fechar portão:
  - `http://IP_DO_SERVIDOR:8787/gate/close?k=SEU_BRIDGE_API_KEY`

## 5.1) Painel web para monitor
O bridge agora também serve uma interface web pronta para monitor/TV:

- URL local:
  - `http://IP_DO_SERVIDOR:8787/control-panel`
- URL com chave já preenchida:
  - `http://IP_DO_SERVIDOR:8787/control-panel?k=SEU_BRIDGE_API_KEY`

O painel permite:
- abrir portão
- fechar portão
- acender faróis
- apagar faróis

Na primeira abertura:
- clique em `Configurar`
- confira a `Base da API`
- informe a `Chave da bridge`
- cadastre os faróis em linhas no formato `Nome|virtual_id`

Exemplo:

```text
Farol entrada|bf34982d74bfeccf87av8b
Farol lateral|outro_virtual_id
```

## 6) Diagnóstico
- `GET /health`
- `GET /tuya/device/functions?k=...`
- `GET /tuya/device/status?k=...`

Se `/tuya/device/functions` funcionar, mas não abrir o portão:
- ajuste `OPEN_COMMAND_CODE` (ex.: `switch_1`)
- confira `OPEN_ON_VALUE` / `OPEN_OFF_VALUE`
- teste `PULSE_MS` entre `500` e `1200`

Se retornar `tuya_data_center_suspended` ou código `28841107`:
- ative o Data Center e as APIs no projeto Tuya IoT Platform
- vincule o projeto cloud à conta do app Smart Life/Tuya que contém o MS-111
- confirme que o `Device ID` pertence ao mesmo projeto/região da chave

## Referências
- Tuya Device Control API: https://developer.tuya.com/en/docs/cloud/device-control?id=K95zu01ksols7
- Tuya Command API example (`/v1.0/iot-03/devices/{device_id}/commands`): https://developer.tuya.com/en/docs/cloud/dc28096614?id=K95zu0ncb2sfr
