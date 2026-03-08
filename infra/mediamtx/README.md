# MediaMTX (RTSP -> HLS) para o app

Este setup converte streams RTSP das cameras em HLS (`.m3u8`), que funciona no player interno do app.

## 1) Subir o MediaMTX

No servidor:

```bash
cd infra/mediamtx
docker compose up -d
```

Ver logs:

```bash
docker compose logs -f mediamtx
```

## 2) Configurar cameras no `mediamtx.yml`

Edite:

- `USUARIO`, `SENHA`, `IP_DA_CAMERA`
- nomes de path (`cam-casa-01-frente`, etc.)
- senhas `TROCAR_SENHA_ADMIN` e `TROCAR_SENHA_MOBILE`

Reinicie:

```bash
docker compose restart mediamtx
```

## 3) URL HLS para usar no app

Formato:

```text
http://mobile:TROCAR_SENHA_MOBILE@SEU_SERVIDOR:8888/NOME_DA_PATH/index.m3u8
```

Exemplo:

```text
http://mobile:minhaSenhaForte@203.0.113.10:8888/cam-casa-01-frente/index.m3u8
```

No app:

- Aba `CAMERAS`
- Editar câmera
- Colar essa URL no campo `URL de reprodução interna`
- Manter a `URL RTSP` original cadastrada

## 4) Segurança recomendada

- Não exponha `8554` para internet; deixe apenas rede interna/VPN.
- Exponha `8888` somente com firewall/IP allowlist.
- Ideal: colocar Nginx/Caddy com HTTPS na frente do `8888`.
- Troque todas as senhas padrão antes de usar.

## 5) Teste rápido

No navegador do computador:

```text
http://mobile:TROCAR_SENHA_MOBILE@SEU_SERVIDOR:8888/cam-casa-01-frente/index.m3u8
```

Se abrir/vídeo carregar, vai funcionar no app no campo de reprodução interna.

