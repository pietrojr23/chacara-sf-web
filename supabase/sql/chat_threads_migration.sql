-- Cria a tabela de chats por assunto e migra os dados legados de configuracoes/chatThreads.
create table if not exists public.chat_threads (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists chat_threads_updated_at_idx on public.chat_threads ((data->>'updatedAt'));
create index if not exists chat_threads_base_chat_id_idx on public.chat_threads ((data->>'baseChatId'));

create or replace trigger trg_chat_threads_touch_updated_at
before insert or update on public.chat_threads
for each row execute function public.touch_updated_at();

alter table public.chat_threads enable row level security;

drop policy if exists chat_threads_all_authenticated on public.chat_threads;
create policy chat_threads_all_authenticated
on public.chat_threads
for all
to authenticated
using (true)
with check (true);

insert into public.chat_threads (id, data)
select
  thread.key as id,
  case
    when jsonb_typeof(thread.value) = 'object' then thread.value
    else '{}'::jsonb
  end as data
from public.configuracoes cfg
cross join lateral jsonb_each(coalesce(cfg.data->'threadsById', '{}'::jsonb)) as thread(key, value)
where cfg.id = 'chatThreads'
on conflict (id) do update
set
  data = excluded.data,
  updated_at = timezone('utc', now());
