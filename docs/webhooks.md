# Webhooks de integração

## 1) Portão

Configure em **Configurações**:
- `gateWebhookUrl`: endpoint para abrir portão
- `gateCloseWebhookUrl`: endpoint para fechar portão

### Requisição enviada pelo app

Método: `POST`

```json
{
  "action": "aberto",
  "userId": "uid_do_usuario",
  "userName": "Nome do Morador"
}
```

`action` pode ser `aberto` ou `fechado`.

### Resposta esperada

Status `2xx` para sucesso.

Exemplo:

```json
{
  "ok": true,
  "status": "aberto"
}
```

## 2) Bomba d'água

Configure em **Configurações**:
- `bombaWebhookUrl`

A versão atual salva o status da bomba no Firestore e prepara a URL para acionamento remoto.

Payload recomendado para implementação do endpoint:

```json
{
  "action": "ligar",
  "source": "owner_app",
  "timestamp": "2026-03-06T18:20:00.000Z"
}
```

## Boas práticas

- Usar HTTPS obrigatório.
- Validar assinatura (`X-Signature`) no backend do portão/bomba.
- Implementar timeout <= 8s (o app já usa timeout de 8s).
- Registrar logs de auditoria para cada acionamento.
