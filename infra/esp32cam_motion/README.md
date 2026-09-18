# ESP32-CAM: movimento + deteccao de pessoa/carro

Fluxo:
- ESP32-CAM faz scans periodicos sem flash.
- O PC (`detector_server.py`) compara os frames para detectar movimento.
- Quando houver evento, a ESP32-CAM tira uma foto oficial com flash.
- O PC detecta `pessoa` e `carro` (inclui bus/truck/motorcycle como veiculo).

## 1) Arquivos desta pasta
- `esp32cam_motion.ino`: firmware para ESP32-CAM.
- `detector_server.py`: API local de deteccao (YOLO).
- `requirements.txt`: dependencias Python.
- `start-detector.sh`: inicializacao rapida no PC.
- `start-detector-bg.sh`: inicia detector em background.
- `stop-detector-bg.sh`: para detector em background.
- `install-detector-launchd.sh`: instala servico automatico no macOS (inicia no boot).

## 1.1) Gravar firmware via terminal (opcional)
```bash
cd "/Users/junior/Downloads/Chacara Sao Francisco"
arduino-cli compile --fqbn esp32:esp32:esp32cam infra/esp32cam_motion
arduino-cli upload -p /dev/cu.usbserial-140 --fqbn esp32:esp32:esp32cam infra/esp32cam_motion
```

## 2) Rodar detector no PC
Recomendado: Python 3.11 ou 3.12.

```bash
cd "/Users/junior/Downloads/Chacara Sao Francisco/infra/esp32cam_motion"
chmod +x start-detector.sh
./start-detector.sh
```

Health:
```bash
curl http://127.0.0.1:5055/health
```

Rodar em background:
```bash
./start-detector-bg.sh
```

Parar:
```bash
./stop-detector-bg.sh
```

Serviço automático no macOS (recomendado):
```bash
./install-detector-launchd.sh
```

## 3) Configurar ESP32-CAM (sem editar senha no codigo)
Depois de gravar o firmware:

1. Conecte no Wi-Fi do ESP:
- SSID: `ESP32CAM-Setup`
- Senha: `12345678`

2. Abra no navegador:
- `http://192.168.4.1`

3. Preencha:
- `WiFi SSID` da sua casa
- `WiFi Password`
- `Detector URL` (IP do PC), ex:
  - `http://192.168.1.89:5055/analyze`
- `API Key` opcional

4. Salve. O ESP reinicia e conecta no Wi-Fi informado.

## 4) Modo padrao atual
- O firmware esta em modo `scan` por padrao (`USE_PIR = false`).
- A camera faz um scan leve a cada poucos segundos.
- Se o servidor confirmar movimento, a camera faz a foto oficial com flash.
- Para teste manual:
  - `http://192.168.1.93/trigger`
  - `http://192.168.1.93/status`

## 5) Ligacao PIR (HC-SR501) no ESP32-CAM
- `VCC` -> `5V`
- `GND` -> `GND`
- `OUT` -> `GPIO13` (padrao no sketch)

Se quiser voltar a usar PIR:
- no sketch, mude `USE_PIR = true`
- recompilar e gravar de novo

## 6) Resultado da deteccao
A API responde JSON com:
- `kind`: `pessoa`, `carro` ou `outro`
- `has_person`: true/false
- `has_vehicle`: true/false
- `detections`: labels e confiancas

As imagens ficam em:
- `infra/esp32cam_motion/captures/YYYY-MM-DD/`

Log JSONL:
- `infra/esp32cam_motion/captures/detections.jsonl`

## 7) Dicas importantes
- Use fonte estavel para ESP32-CAM (5V, boa corrente).
- Se der reset/camera fail, reduza `frame_size` no sketch.
- Se o detector estiver lento no PC, use menos resolucao no ESP.
