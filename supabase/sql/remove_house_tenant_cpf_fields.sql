-- Remove campos legados de inquilino/CPF dos registros de casas.
-- Execute no Supabase SQL Editor.

do $$
begin
  if to_regclass('public.casas') is not null then
    update public.casas
    set data = coalesce(data, '{}'::jsonb)
      - 'inquilinoNome'
      - 'inquilinoCpf'
      - 'inquilino_nome'
      - 'inquilino_cpf'
    where coalesce(data, '{}'::jsonb) ? 'inquilinoNome'
      or coalesce(data, '{}'::jsonb) ? 'inquilinoCpf'
      or coalesce(data, '{}'::jsonb) ? 'inquilino_nome'
      or coalesce(data, '{}'::jsonb) ? 'inquilino_cpf';
  end if;

  if to_regclass('public.documents') is not null then
    update public.documents
    set data = coalesce(data, '{}'::jsonb)
      - 'inquilinoNome'
      - 'inquilinoCpf'
      - 'inquilino_nome'
      - 'inquilino_cpf'
    where split_part(path, '/', 1) = 'casas'
      and split_part(path, '/', 3) = ''
      and (
        coalesce(data, '{}'::jsonb) ? 'inquilinoNome'
        or coalesce(data, '{}'::jsonb) ? 'inquilinoCpf'
        or coalesce(data, '{}'::jsonb) ? 'inquilino_nome'
        or coalesce(data, '{}'::jsonb) ? 'inquilino_cpf'
      );
  end if;
end $$;
