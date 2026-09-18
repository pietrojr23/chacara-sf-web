# ThinkPad RTSP Detector

Detector leve para o ThinkPad T430:
- puxa RTSP da `cam1`
- roda deteccao com YOLO em CPU
- identifica pessoa, carro, moto, onibus, caminhao e animais comuns
- salva eventos com snapshot
- organiza snapshots em subpastas por tipo dentro de cada dia
- grava log CSV em `detections_log.csv`
- expõe painel web local simples em `http://127.0.0.1:5060/`
- por padrao usa so o substream e salva apenas deteccoes relevantes

## Por que nao Frigate neste caso

O Frigate e excelente quando ha hardware compativel para detector, mas no T430 a melhor aposta e um detector proprio em Python:
- docs do Frigate indicam OpenVINO suportado em Intel 6th Gen+ e CPU puro geralmente nao e o caminho recomendado
- o T430 costuma ser 3rd Gen Intel, entao esse notebook tende a aproveitar melhor um pipeline YOLO leve em cima de um stream RTSP reduzido

## Fluxo padrao

1. No ThinkPad, conecte o detector no substream RTSP da camera.
2. Use stream baixo e H.264 sempre que possivel.
3. O detector roda YOLO em intervalos curtos e so salva quando passa nos filtros de confianca, tamanho e cooldown.

Exemplos de RTSP:

```text
rtsp://USUARIO:SENHA@IP_DA_CAMERA:554/stream2
rtsp://admin:SENHA@IP_DA_CAMERA:554/cam/realmonitor?channel=1&subtype=1
```

### Modo simples recomendado

Use estes ajustes no `.env`:

```env
SIMPLE_DETECTION_MODE=true
SUBSTREAM_ONLY=true
RTSP_TRANSPORT=tcp
DEFAULT_ALLOWED_MIN_CONF=0.60
MIN_BBOX_AREA_RATIO=0.012
ANNOTATE_SAVED_IMAGES=true
SEMANTIC_FILTERS_ENABLED=false
SAVE_ALL_DETECTIONS=true
SNAPSHOT_INTERVAL_S=0.0
SAVE_BEST_ONLY=false
DETECT_INTERVAL_S=1.5
MOTION_MIN_RATIO=0.03
JPEG_QUALITY=80
```

Com isso, o detector:
- usa so o substream
- aceita apenas estas classes para salvar: `person`, `car`, `motorcycle`, `bus`, `truck`, `dog`, `cat`, `horse`, `sheep`, `cow`
- aplica confianca minima por classe
- rejeita caixa menor que 1.2% da imagem
- aplica cooldown de 1 segundo para todas as classes permitidas
- grava uma linha por deteccao salva em `detections_log.csv`
- nao tenta confirmar em `subtype=0`
- salva a imagem anotada, mas nao desenha bbox no preview ao vivo

### Modo avancado opcional

```env
SIMPLE_DETECTION_MODE=false
SUBSTREAM_ONLY=false
VERIFY_RTSP_URL=rtsp://admin:SENHA@IP_DA_CAMERA:554/cam/realmonitor?channel=1&subtype=0
VERIFY_MODEL_PATH=yolo11s.pt
SEMANTIC_FILTERS_ENABLED=true
```

Esse modo deixa disponivel a verificacao em alta e os filtros semanticos, caso voce queira voltar a tentar reduzir falsos positivos.

## Instalar localmente no ThinkPad

```bash
cd /CAMINHO/para/esta/pasta
chmod +x install-thinkpad-service.sh
./install-thinkpad-service.sh
```

Depois:

```bash
sudo nano /opt/chacara-ai-detector/rtsp-detector/.env
sudo systemctl restart chacara-rtsp-detector.service
```

## Atualizar puxando deste PC

```bash
BASE_URL="http://192.168.1.20:8878/infra/thinkpad-rtsp-detector" \
bash /opt/chacara-ai-detector/rtsp-detector/update-thinkpad-detector.sh
```

## Adicionar outra camera no mesmo ThinkPad

Depois de atualizar a instancia base, crie uma segunda instancia com porta propria:

```bash
/opt/chacara-ai-detector/rtsp-detector/add-camera-instance.sh cam2 5061 \
  'rtsp://pietrojr2:guglielmi007310899@192.168.1.26:554/stream2'
```

Atalho pronto para esta camera:

```bash
/opt/chacara-ai-detector/rtsp-detector/setup-cam2.sh
```

Para uma terceira camera na porta `5062`:

```bash
/opt/chacara-ai-detector/rtsp-detector/setup-cam3.sh
```

Para subir `cam1`, `cam2` e `cam3` em modo leve no T430:

```bash
/opt/chacara-ai-detector/rtsp-detector/setup-all-cameras-efficient.sh
```

Esse perfil leve:
- força `yolo11n.pt` em todas as cameras
- mantém `cam1` mais responsiva com `DETECT_INTERVAL_S=1.5`
- deixa `cam2` e `cam3` em `DETECT_INTERVAL_S=2.0`
- usa somente modo simples com substream
- reduz carga de CPU para nao deixar o ThinkPad cravado

Os ajustes aplicados sao estes:

```env
MODEL_PATH=yolo11n.pt
MIN_CONF=0.35
DEFAULT_ALLOWED_MIN_CONF=0.60
TARGET_LABELS=person,car,motorcycle,bus,truck,dog,cat,horse,sheep,cow
PERSON_SAVE_MIN_CONF=0.50
CAR_SAVE_MIN_CONF=0.55
MOTORCYCLE_SAVE_MIN_CONF=0.55
BUS_SAVE_MIN_CONF=0.55
TRUCK_SAVE_MIN_CONF=0.55
DOG_SAVE_MIN_CONF=0.60
CAT_SAVE_MIN_CONF=0.60
HORSE_SAVE_MIN_CONF=0.60
SHEEP_SAVE_MIN_CONF=0.60
COW_SAVE_MIN_CONF=0.60
PRIMARY_IMGSZ=640
MAX_INFER_WIDTH=640
DETECT_INTERVAL_S=1.5 ou 2.0
MOTION_MIN_RATIO=0.03
MIN_BBOX_AREA_RATIO=0.012
SIMPLE_DETECTION_MODE=true
SUBSTREAM_ONLY=true
```

Isso cria:
- pasta `/opt/chacara-ai-detector/cam2`
- servico `chacara-cam2.service`
- painel local em `http://127.0.0.1:5061/`
- imagens novas da `cam2` salvas junto com a pasta `events` da `cam1`

Se voce quiser modo avancado com verificacao em alta, pode passar o RTSP de verificacao como quarto parametro.

Para uma camera focada em pessoa, voce pode ajustar o `.env` da instancia com:

```env
TARGET_LABELS=person
PERSON_SAVE_MIN_CONF=0.35
MIN_BBOX_AREA_RATIO=0.005
PRIMARY_IMGSZ=960
MAX_INFER_WIDTH=960
SEMANTIC_FILTERS_ENABLED=true
PERSON_MIN_CONF=0.20
PERSON_MIN_AREA_RATIO=0.003
PERSON_MIN_BOTTOM_RATIO=0.15
```

## Remover uma camera extra

```bash
/opt/chacara-ai-detector/rtsp-detector/remove-camera-instance.sh cam2
```

Isso remove:
- servico `chacara-cam2.service`
- pasta `/opt/chacara-ai-detector/cam2`

## Endpoints

- `GET /health`
- `GET /status`
- `GET /events`
- `GET /display-event`
- `GET /display-event-bitmap`
- `GET /event-image/<relpath>`
- `GET /latest.jpg`
- `GET /`

## Estrutura das fotos salvas

Os snapshots ficam assim:

```text
events/
  2026-03-28/
    pessoa/
    animal/
    veiculo/
    outro/
```

## Dicas de desempenho no T430

- mantenha `MODEL_PATH=yolo11n.pt`
- use o substream RTSP baixo da camera
- no modo simples, deixe `SIMPLE_DETECTION_MODE=true`
- com 3 cameras no T430, prefira `DETECT_INTERVAL_S=1.5` na `cam1` e `2.0` nas extras
- se quiser modo avancado depois, ligue `VERIFY_RTSP_URL` e `SEMANTIC_FILTERS_ENABLED`
