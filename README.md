# Chácara Sao Francisco (Expo + Supabase)

Aplicativo mobile (Android/iOS) para gestão da propriedade rural **Chácara São Francisco**.

## Stack atual

- React Native + Expo
- TypeScript
- Supabase Auth
- Supabase Postgres (tabelas separadas por coleção)
- Cloudinary (uploads de imagens/PDF)
- Expo Notifications

## Estrutura

- `src/` app mobile
- `supabase/sql/bootstrap.sql` schema + policies necessárias
- `supabase/sql/relational_tables.sql` tabelas separadas (`users`, `casas`, `chamados`, etc.)
- `scripts/migrate-firebase-to-supabase.mjs` migração de dados legados
- `scripts/migrate-documents-to-relational.mjs` migração de `documents` para tabelas separadas
- `firebase/` artefatos legados (rules/functions antigas)

## Configuração rápida

1. Copie variáveis de ambiente:

```bash
cp .env.example .env
```

2. Preencha `.env` com Supabase:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_SUPABASE_STORAGE_BUCKET=app-files
EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME=
EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET=
EXPO_PUBLIC_SUPABASE_PASSWORD_RESET_URL=
EXPO_PUBLIC_OPENWEATHER_KEY=
EXPO_PUBLIC_EXPO_PROJECT_ID=
```

3. Instale dependências:

```bash
npm install
```

4. No Supabase SQL Editor, execute:

- `supabase/sql/bootstrap.sql`
- `supabase/sql/relational_tables.sql`

5. Rode o app:

```bash
npm run start
```

## Migração de dados do Firebase

Pré-requisitos:

- JSON de Service Account do Firebase
- `SUPABASE_SERVICE_ROLE_KEY` do projeto Supabase

Comando:

```bash
FIREBASE_SERVICE_ACCOUNT_PATH=/caminho/service-account.json \
SUPABASE_URL=https://seu-projeto.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run migrate:firebase-to-supabase
```

Opcional para limpar destino antes da migração:

```bash
CLEAR_SUPABASE_DOCUMENTS=true npm run migrate:firebase-to-supabase
```

## Migração de `documents` para tabelas separadas

Após executar o SQL das tabelas separadas:

```bash
SUPABASE_URL=https://seu-projeto.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run migrate:documents-to-relational
```

Opcional para limpar as tabelas separadas antes de remigrar:

```bash
CLEAR_RELATIONAL_TABLES=true npm run migrate:documents-to-relational
```

## Comandos úteis

```bash
npm run typecheck
```

## Câmeras RTSP no app (MediaMTX)

Para converter RTSP em HLS e tocar dentro do app, use o setup pronto em:

- `infra/mediamtx/docker-compose.yml`
- `infra/mediamtx/mediamtx.yml`
- `infra/mediamtx/README.md`

Resumo:

1. Suba o MediaMTX com Docker Compose.
2. Configure as paths RTSP no `mediamtx.yml`.
3. Use URL HLS (`.../index.m3u8`) no campo **URL de reprodução interna** da aba `CAMERAS`.
4. Para acesso fora da rede local, suba o `cloudflared` (`docker compose --profile tunnel up -d`) e configure também **URL de reprodução externa** com endpoint público HTTPS (`https://.../index.m3u8`).
