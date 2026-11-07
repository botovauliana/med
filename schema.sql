-- =====================================================================
--  Инфекционные болезни — схема базы для Supabase
--  Выполнить один раз целиком в SQL Editor проекта Supabase.
--  Модель: один общий кабинет. Конспекты общие для приглашённых коллег,
--  личные выделения и заметки у каждого свои.
-- =====================================================================

-- ---------- 1. УЧАСТНИКИ ----------
create table if not exists public.members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'editor' check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now()
);

-- приглашения: владелец вписывает почту коллеги заранее
create table if not exists public.invites (
  email      text primary key,
  role       text not null default 'editor' check (role in ('owner','editor','viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- 2. КОНСПЕКТЫ (общие) ----------
create table if not exists public.topics (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  title        text not null,
  section      text not null default 'Без раздела',
  lesson       text,
  color        text not null default '#2fb3ad',
  agent        text default '',
  lead         text default '',
  facts        jsonb not null default '[]'::jsonb,
  cheat        jsonb not null default '[]'::jsonb,
  content_html text not null default '',
  test         jsonb not null default '[]'::jsonb,
  cards        jsonb not null default '[]'::jsonb,
  position     int  not null default 0,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  client_id    text
);

-- ---------- 3. ЛИЧНЫЕ ДАННЫЕ (у каждого свои) ----------
-- выделения, комментарии, заметки, прогресс тестов и карточек
create table if not exists public.user_state (
  owner      uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  client_id  text,
  primary key (owner, key)
);

-- ---------- 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ----------
-- security definer, чтобы политики не зацикливались на самой таблице members
create or replace function public.is_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid());
$$;

create or replace function public.can_edit() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m
                 where m.user_id = auth.uid() and m.role in ('owner','editor'));
$$;

create or replace function public.is_owner() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m
                 where m.user_id = auth.uid() and m.role = 'owner');
$$;

-- первый зарегистрировавшийся становится владельцем.
-- остальные получают доступ, только если их почта заранее добавлена в invites.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare inv public.invites%rowtype; cnt int;
begin
  select count(*) into cnt from public.members;
  if cnt = 0 then
    insert into public.members(user_id, email, role) values (new.id, lower(new.email), 'owner');
  else
    select * into inv from public.invites where email = lower(new.email);
    if found then
      insert into public.members(user_id, email, role) values (new.id, lower(new.email), coalesce(inv.role,'editor'));
      delete from public.invites where email = lower(new.email);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 5. ROW LEVEL SECURITY ----------
alter table public.members    enable row level security;
alter table public.invites    enable row level security;
alter table public.topics     enable row level security;
alter table public.user_state enable row level security;

-- участники: видят друг друга; менять состав может только владелец
drop policy if exists members_select on public.members;
create policy members_select on public.members for select using (public.is_member());
drop policy if exists members_update on public.members;
create policy members_update on public.members for update using (public.is_owner()) with check (public.is_owner());
drop policy if exists members_delete on public.members;
create policy members_delete on public.members for delete using (public.is_owner());
-- INSERT политики нет: записи создаёт только триггер регистрации

-- приглашения: только владелец
drop policy if exists invites_all on public.invites;
create policy invites_all on public.invites for all using (public.is_owner()) with check (public.is_owner());

-- конспекты: читают все участники, правят владелец и редакторы
drop policy if exists topics_select on public.topics;
create policy topics_select on public.topics for select using (public.is_member());
drop policy if exists topics_insert on public.topics;
create policy topics_insert on public.topics for insert with check (public.can_edit());
drop policy if exists topics_update on public.topics;
create policy topics_update on public.topics for update using (public.can_edit()) with check (public.can_edit());
drop policy if exists topics_delete on public.topics;
create policy topics_delete on public.topics for delete using (public.can_edit());

-- личные данные: строго свои, чужие не видны никому, включая владельца
drop policy if exists state_select on public.user_state;
create policy state_select on public.user_state for select using (owner = auth.uid());
drop policy if exists state_insert on public.user_state;
create policy state_insert on public.user_state for insert with check (owner = auth.uid());
drop policy if exists state_update on public.user_state;
create policy state_update on public.user_state for update using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists state_delete on public.user_state;
create policy state_delete on public.user_state for delete using (owner = auth.uid());

-- ---------- 6. КАРТИНКИ ----------
insert into storage.buckets (id, name, public)
  values ('images','images', true)
  on conflict (id) do nothing;

drop policy if exists images_read on storage.objects;
create policy images_read on storage.objects for select
  using (bucket_id = 'images');

drop policy if exists images_write on storage.objects;
create policy images_write on storage.objects for insert
  with check (bucket_id = 'images' and public.can_edit());

drop policy if exists images_update on storage.objects;
create policy images_update on storage.objects for update
  using (bucket_id = 'images' and public.can_edit());

drop policy if exists images_delete on storage.objects;
create policy images_delete on storage.objects for delete
  using (bucket_id = 'images' and public.can_edit());

-- ---------- 7. СИНХРОНИЗАЦИЯ МЕЖДУ УСТРОЙСТВАМИ ----------
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.topics'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.user_state'; exception when others then null; end;
end $$;

-- ---------- 8. ИНДЕКСЫ ----------
create index if not exists topics_position_idx on public.topics(position);
create index if not exists state_owner_idx on public.user_state(owner);
