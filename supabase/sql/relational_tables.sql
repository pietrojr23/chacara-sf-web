-- Tabelas separadas por coleção (modelo estilo Firebase collections)
-- Execute no Supabase SQL Editor.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  if tg_op = 'INSERT' and new.created_at is null then
    new.created_at = timezone('utc', now());
  end if;
  return new;
end;
$$;

-- Top-level collections
create table if not exists public.users (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.casas (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.chamados (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.avisos (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.visitantes (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.acessos (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.configuracoes (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.contatos_emergencia (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Subcollections
create table if not exists public.chat_mensagens (
  chat_type text not null,
  chat_id text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (chat_type, chat_id, id)
);

create index if not exists chat_mensagens_chat_lookup_idx on public.chat_mensagens (chat_type, chat_id);

create table if not exists public.chat_threads (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists chat_threads_updated_at_idx on public.chat_threads ((data->>'updatedAt'));
create index if not exists chat_threads_base_chat_id_idx on public.chat_threads ((data->>'baseChatId'));

create table if not exists public.casa_documentos (
  casa_id text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (casa_id, id)
);

create index if not exists casa_documentos_casa_idx on public.casa_documentos (casa_id);

create table if not exists public.alugueis_pagamentos (
  casa_id text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (casa_id, id)
);

create index if not exists alugueis_pagamentos_casa_idx on public.alugueis_pagamentos (casa_id);

-- Triggers updated_at
create or replace trigger trg_users_touch_updated_at
before insert or update on public.users
for each row execute function public.touch_updated_at();

create or replace trigger trg_casas_touch_updated_at
before insert or update on public.casas
for each row execute function public.touch_updated_at();

create or replace trigger trg_chamados_touch_updated_at
before insert or update on public.chamados
for each row execute function public.touch_updated_at();

create or replace trigger trg_avisos_touch_updated_at
before insert or update on public.avisos
for each row execute function public.touch_updated_at();

create or replace trigger trg_visitantes_touch_updated_at
before insert or update on public.visitantes
for each row execute function public.touch_updated_at();

create or replace trigger trg_acessos_touch_updated_at
before insert or update on public.acessos
for each row execute function public.touch_updated_at();

create or replace trigger trg_configuracoes_touch_updated_at
before insert or update on public.configuracoes
for each row execute function public.touch_updated_at();

create or replace trigger trg_contatos_emergencia_touch_updated_at
before insert or update on public.contatos_emergencia
for each row execute function public.touch_updated_at();

create or replace trigger trg_chat_mensagens_touch_updated_at
before insert or update on public.chat_mensagens
for each row execute function public.touch_updated_at();

create or replace trigger trg_chat_threads_touch_updated_at
before insert or update on public.chat_threads
for each row execute function public.touch_updated_at();

create or replace trigger trg_casa_documentos_touch_updated_at
before insert or update on public.casa_documentos
for each row execute function public.touch_updated_at();

create or replace trigger trg_alugueis_pagamentos_touch_updated_at
before insert or update on public.alugueis_pagamentos
for each row execute function public.touch_updated_at();

-- RLS
alter table public.users enable row level security;
alter table public.casas enable row level security;
alter table public.chamados enable row level security;
alter table public.avisos enable row level security;
alter table public.visitantes enable row level security;
alter table public.acessos enable row level security;
alter table public.configuracoes enable row level security;
alter table public.contatos_emergencia enable row level security;
alter table public.chat_mensagens enable row level security;
alter table public.chat_threads enable row level security;
alter table public.casa_documentos enable row level security;
alter table public.alugueis_pagamentos enable row level security;

-- Policies (dev-friendly, igual ao modelo atual do app)
drop policy if exists users_select_authenticated on public.users;
drop policy if exists users_insert_authenticated on public.users;
drop policy if exists users_update_authenticated on public.users;
drop policy if exists users_delete_authenticated on public.users;
drop policy if exists users_insert_anon_signup on public.users;

create policy users_select_authenticated on public.users for select to authenticated using (true);
create policy users_insert_authenticated on public.users for insert to authenticated with check (true);
create policy users_update_authenticated on public.users for update to authenticated using (true) with check (true);
create policy users_delete_authenticated on public.users for delete to authenticated using (true);

-- Permite criar perfil inicial durante sign-up sem sessão.
create policy users_insert_anon_signup
on public.users
for insert
to anon
with check (
  id ~ '^[0-9a-f-]{36}$'
  and coalesce(data->>'email', '') <> ''
);

drop policy if exists casas_all_authenticated on public.casas;
create policy casas_all_authenticated on public.casas for all to authenticated using (true) with check (true);

drop policy if exists chamados_all_authenticated on public.chamados;
create policy chamados_all_authenticated on public.chamados for all to authenticated using (true) with check (true);

drop policy if exists avisos_all_authenticated on public.avisos;
create policy avisos_all_authenticated on public.avisos for all to authenticated using (true) with check (true);

drop policy if exists visitantes_all_authenticated on public.visitantes;
create policy visitantes_all_authenticated on public.visitantes for all to authenticated using (true) with check (true);

drop policy if exists acessos_all_authenticated on public.acessos;
create policy acessos_all_authenticated on public.acessos for all to authenticated using (true) with check (true);

drop policy if exists configuracoes_all_authenticated on public.configuracoes;
create policy configuracoes_all_authenticated on public.configuracoes for all to authenticated using (true) with check (true);

drop policy if exists contatos_emergencia_all_authenticated on public.contatos_emergencia;
create policy contatos_emergencia_all_authenticated on public.contatos_emergencia for all to authenticated using (true) with check (true);

drop policy if exists chat_mensagens_all_authenticated on public.chat_mensagens;
create policy chat_mensagens_all_authenticated on public.chat_mensagens for all to authenticated using (true) with check (true);

drop policy if exists chat_threads_all_authenticated on public.chat_threads;
create policy chat_threads_all_authenticated on public.chat_threads for all to authenticated using (true) with check (true);

drop policy if exists casa_documentos_all_authenticated on public.casa_documentos;
create policy casa_documentos_all_authenticated on public.casa_documentos for all to authenticated using (true) with check (true);

drop policy if exists alugueis_pagamentos_all_authenticated on public.alugueis_pagamentos;
create policy alugueis_pagamentos_all_authenticated on public.alugueis_pagamentos for all to authenticated using (true) with check (true);
