# MediaMTX (RTSP -> HLS) para o app

Este setup converte streams RTSP das cameras em HLS (`.m3u8`) e permite publicar com HTTPS para funcionar em outra rede Wi-Fi/4G.

## 1) Subir MediaMTX local

No servidor:

```bash
cd /Users/junior/Downloads/Chacara\ Sao\ Francisco/infra/mediamtx
docker compose up -d mediamtx
```

Ver logs:

```bash
docker compose logs -f mediamtx
```

## 2) Configurar cameras no `mediamtx.yml`

Edite:

- `USUARIO`, `SENHA`, `IP_DA_CAMERA`
- nomes de path (`cam-casa-01-frente`, etc.)
- senhas de admin

Reinicie:

```bash
docker compose restart mediamtx
```

## 3) URL interna (mesma rede Wi-Fi)

Formato:

```text
http://SEU_SERVIDOR:8888/NOME_DA_PATH/index.m3u8
```

Exemplo:

```text
http://192.168.1.20:8888/cam-casa-01-frente/index.m3u8
```

No app:

- `URL de reprodução interna` = URL acima
- `URL RTSP` = stream original da camera

## 4A) Publicar com Google Cloud VPS (IP fixo + tunel reverso SSH)

Use este modo se voce ja tem VM no Google Cloud e quer link externo fixo sem abrir portas na rede local.

### Arquitetura

- Servidor local roda `mediamtx` (porta local `8888`).
- Tunel reverso SSH envia `VPS 127.0.0.1:18888 -> LOCAL 127.0.0.1:8888`.
- Caddy na VPS publica HTTPS no seu dominio e faz proxy para `127.0.0.1:18888`.

### 1) Configure DNS e firewall da VM

- Aponte um dominio para o IP da VPS (ou use `SEU_IP.nip.io` para teste rapido).
- No Google Cloud Firewall, libere TCP `22`, `80` e `443` para a VM.

### 2) Suba proxy HTTPS na VPS

No servidor local (este repositorio):

```bash
cd /Users/junior/Downloads/Chacara\ Sao\ Francisco/infra/mediamtx
./setup-gcp-vps.sh ubuntu@SEU_IP_DA_VPS cam.seudominio.com
```

Exemplo sem dominio proprio:

```bash
./setup-gcp-vps.sh ubuntu@SEU_IP_DA_VPS SEU_IP_DA_VPS.nip.io
```

### 3) Inicie o tunel reverso LOCAL -> VPS

```bash
./start-gcp-vps-tunnel.sh ubuntu@SEU_IP_DA_VPS 18888 8888 cam.seudominio.com
```

Para parar:

```bash
./stop-gcp-vps-tunnel.sh
```

### 4) URL externa no app

Formato:

```text
https://cam.seudominio.com/cam-casa-01-frente/index.m3u8
```

No app, em Cameras:

- `URL de reprodução interna`: `http://IP_LOCAL:8888/.../index.m3u8`
- `URL de reprodução externa`: `https://cam.seudominio.com/.../index.m3u8`

## 4) Publicar com Cloudflare Tunnel (HTTPS externo)

1. No Cloudflare Zero Trust, crie um Tunnel e copie o token.
2. Crie `.env` a partir do template:

```bash
cp .env.example .env
```

3. Edite `.env` e preencha:

```env
CLOUDFLARE_TUNNEL_TOKEN=seu_token_real
PUBLIC_CAMERA_HOST=cam.seudominio.com
```

4. No painel do Tunnel, crie um Public Hostname:
- Hostname: `cam.seudominio.com`
- Service type: `HTTP`
- URL: `mediamtx:8888`

5. Suba o tunnel (recomendado para dominio fixo):

```bash
./start-cloudflare-fixed-domain.sh cam.seudominio.com cam-casa-01-frente
```

Esse comando:
- grava `PUBLIC_CAMERA_HOST` no `.env`
- derruba tunnel temporario `trycloudflare` (se estiver rodando)
- sobe `mediamtx` + `cloudflared` (profile `tunnel`)
- testa a URL final automaticamente

Alternativa manual:

```bash
docker compose --profile tunnel up -d
```

Atalho antigo (sem atualizar dominio automaticamente):

```bash
./start-tunnel.sh
```

6. Valide URL externa:

```text
https://cam.seudominio.com/cam-casa-01-frente/index.m3u8
```

## 5) Cadastro no app para funcionar fora da rede

- `URL de reprodução interna`: `http://192.168.x.x:8888/cam.../index.m3u8`
- `URL de reprodução externa`: `https://cam.seudominio.com/cam.../index.m3u8`

O app vai usar a externa quando necessário (inclusive no botão `Abrir em app externo`).

## 6) Segurança recomendada

- Não exponha `8554` na internet.
- Não exponha `8888` diretamente sem proteção.
- Use HTTPS no endpoint público.
- Troque senhas padrão.

## 7) Se nao abrir no app com Cloudflare

Checklist objetivo:

1. Rota do tunnel deve ser publica para stream:
- Tunnel -> Route/Published application
- Hostname: `cam.seudominio.com`
- Service: `http://mediamtx:8888`
- Sem login Cloudflare Access para essa rota.

2. Teste URL externa no servidor:

```bash
./check-external-stream.sh https://cam.seudominio.com/cam-casa-01-frente/index.m3u8
```

3. Se o script mostrar HTML, o Cloudflare esta entregando pagina de login/protecao em vez de m3u8.

4. Reinicie stack apos ajustes:

```bash
docker compose restart mediamtx cloudflared
```

## 8) Modo automatico sem DNS (recomendado so para teste rapido)

Sem configurar dominio, gere um link publico instantaneo:

```bash
./start-quick-link.sh cam-casa-01-frente
```

Esse comando:
- sobe `mediamtx`
- sobe `cloudflared-quick`
- extrai a URL `https://...trycloudflare.com/.../index.m3u8`
- testa a playlist automaticamente

Para parar depois:

```bash
docker compose --profile quick down
```

## 9) Dominio fixo gratis com DuckDNS

Se voce criou `seunome.duckdns.org`, configure:

1. Em `.env`:

```env
PUBLIC_CAMERA_HOST=seunome.duckdns.org
```

2. Garanta que o DuckDNS aponta para seu IP publico (botao `update ip`).
3. No roteador, encaminhe portas 80 e 443 para este servidor.
4. Suba HTTPS com Caddy:

```bash
./start-duckdns-https.sh cam-casa-01-frente
```

Esse comando agora tenta DuckDNS primeiro e, se 80/443 estiver bloqueado (CGNAT/firewall), faz fallback automatico para `trycloudflare` e imprime uma URL externa pronta.

5. URL externa no app:

```text
https://seunome.duckdns.org/cam-casa-01-frente/index.m3u8
```

## 10) Adicionar outras cameras (modo economico balanceado)

Para cadastrar nova camera com qualidade melhor sem subir muito o consumo
(426x240, 7 fps, ~120-150 kbps):

```bash
./add-low-camera.sh cam-casa-02-fundos "rtsp://USUARIO:SENHA@IP_DA_CAMERA:554/stream2"
```

Para modelos Dahua/H264DVR (ex.: `realmonitor`), use perfil `dahua`:

```bash
./add-low-camera.sh cam-portao "rtsp://admin:SENHA@192.168.1.5:554/cam/realmonitor?channel=1&subtype=1" dahua
```

O script:
- adiciona `paths` no `mediamtx.yml`
- cria service `ffmpeg-...-low` no `docker-compose.yml`
- sobe os containers necessarios automaticamente

URL final no app (troque o host publico):

```text
https://SEU_HOST_PUBLICO/cam-casa-02-fundos/index.m3u8
```

## 11) Lubuntu: erro de conflito do Docker Compose

Se aparecer erro do `dpkg` tipo:
`tentata sovrascrittura di /usr/libexec/docker/cli-plugins/docker-compose`
(conflito entre `docker-compose-v2` e `docker-compose-plugin`), rode:

```bash
cd /opt/chacara-mediamtx
sudo ./fix-docker-lubuntu.sh
```

Depois suba a stack:

```bash
sudo ./bootstrap-lubuntu.sh
```
