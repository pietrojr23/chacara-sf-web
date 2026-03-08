-- Execute this in Supabase SQL Editor before running the app.

create extension if not exists pgcrypto;

create table if not exists public.documents (
  path text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists documents_path_prefix_idx on public.documents (path text_pattern_ops);

create or replace function public.documents_set_updated_at()
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

drop trigger if exists trg_documents_set_updated_at on public.documents;
create trigger trg_documents_set_updated_at
before insert or update on public.documents
for each row execute function public.documents_set_updated_at();

alter table public.documents enable row level security;

drop policy if exists documents_select_authenticated on public.documents;
drop policy if exists documents_insert_authenticated on public.documents;
drop policy if exists documents_insert_anon_user_profiles on public.documents;
drop policy if exists documents_update_authenticated on public.documents;
drop policy if exists documents_delete_authenticated on public.documents;

create policy documents_select_authenticated
on public.documents
for select
to authenticated
using (true);

create policy documents_insert_authenticated
on public.documents
for insert
to authenticated
with check (true);

-- Permite criar perfil inicial em users/{uuid} durante sign-up sem sessão ativa.
create policy documents_insert_anon_user_profiles
on public.documents
for insert
to anon
with check (
  split_part(path, '/', 1) = 'users'
  and split_part(path, '/', 3) = ''
  and split_part(path, '/', 2) ~ '^[0-9a-f-]{36}$'
);

create policy documents_update_authenticated
on public.documents
for update
to authenticated
using (true)
with check (true);

create policy documents_delete_authenticated
on public.documents
for delete
to authenticated
using (true);

insert into storage.buckets (id, name, public)
values ('app-files', 'app-files', true)
on conflict (id) do update set public = true;

drop policy if exists storage_objects_public_read_app_files on storage.objects;
drop policy if exists storage_objects_insert_app_files on storage.objects;
drop policy if exists storage_objects_update_app_files on storage.objects;
drop policy if exists storage_objects_delete_app_files on storage.objects;

create policy storage_objects_public_read_app_files
on storage.objects
for select
to public
using (bucket_id = 'app-files');

create policy storage_objects_insert_app_files
on storage.objects
for insert
to authenticated
with check (bucket_id = 'app-files');

create policy storage_objects_update_app_files
on storage.objects
for update
to authenticated
using (bucket_id = 'app-files')
with check (bucket_id = 'app-files');

create policy storage_objects_delete_app_files
on storage.objects
for delete
to authenticated
using (bucket_id = 'app-files');
