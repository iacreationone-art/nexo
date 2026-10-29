-- =============================================================
-- Nexo — esquema do banco (rode inteiro no SQL Editor do Supabase)
-- =============================================================

-- ---------- Tabelas ----------

create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text unique not null,
  name        text not null check (char_length(name) between 1 and 60),
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  is_group    boolean not null default false,
  title       text,
  created_at  timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations on delete cascade,
  user_id         uuid not null references public.profiles on delete cascade,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index on public.conversation_members (user_id);

create table public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations on delete cascade,
  sender_id       uuid not null default auth.uid() references public.profiles on delete cascade,
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);
create index on public.messages (conversation_id, created_at desc);

-- ---------- Perfil criado automaticamente no cadastro ----------

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, lower(new.email), split_part(new.email, '@', 1));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Funções auxiliares (usadas nas regras) ----------

create function public.is_member(p_conv uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from conversation_members
    where conversation_id = p_conv and user_id = auth.uid()
  );
$$;

create function public.shares_conversation(p_user uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from conversation_members a
    join conversation_members b on b.conversation_id = a.conversation_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ---------- Segurança (RLS) ----------
-- A chave anon fica pública no site; são estas regras que protegem os dados.

alter table public.profiles             enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;

create policy "ver o próprio perfil e de contatos" on public.profiles
  for select using (id = auth.uid() or public.shares_conversation(id));

create policy "editar o próprio perfil" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Só nome e foto podem ser alterados pelo usuário (e-mail não).
revoke update on public.profiles from authenticated, anon;
grant update (name, avatar_url) on public.profiles to authenticated;

create policy "ver conversas de que participa" on public.conversations
  for select using (public.is_member(id));

create policy "ver membros das suas conversas" on public.conversation_members
  for select using (public.is_member(conversation_id));

create policy "ler mensagens das suas conversas" on public.messages
  for select using (public.is_member(conversation_id));

create policy "enviar mensagens nas suas conversas" on public.messages
  for insert with check (public.is_member(conversation_id) and sender_id = auth.uid());

-- Criar conversas e marcar como lida só pelas funções abaixo.

-- ---------- Funções chamadas pelo app (RPC) ----------

-- Procura alguém pelo e-mail exato (para iniciar uma conversa).
create function public.find_user_by_email(p_email text)
returns table (id uuid, name text, avatar_url text)
language sql security definer stable set search_path = public as $$
  select p.id, p.name, p.avatar_url
  from profiles p
  where auth.uid() is not null
    and p.email = lower(trim(p_email))
    and p.id <> auth.uid();
$$;

-- Abre (ou cria) a conversa 1 a 1 com outra pessoa.
create function public.start_direct_chat(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_conv uuid;
begin
  if v_me is null then
    raise exception 'não autenticado';
  end if;
  if p_other = v_me or not exists (select 1 from profiles where id = p_other) then
    raise exception 'usuário inválido';
  end if;

  select c.id into v_conv
  from conversations c
  join conversation_members a on a.conversation_id = c.id and a.user_id = v_me
  join conversation_members b on b.conversation_id = c.id and b.user_id = p_other
  where not c.is_group
  limit 1;

  if v_conv is null then
    insert into conversations (is_group) values (false) returning id into v_conv;
    insert into conversation_members (conversation_id, user_id)
    values (v_conv, v_me), (v_conv, p_other);
  end if;

  return v_conv;
end $$;

-- Lista de conversas com a última mensagem e quantas não foram lidas.
create function public.my_conversations()
returns table (
  conversation_id uuid,
  other_id        uuid,
  other_name      text,
  other_avatar    text,
  last_body       text,
  last_at         timestamptz,
  last_sender     uuid,
  last_read_at    timestamptz,
  unread          int
)
language sql security definer stable set search_path = public as $$
  select
    c.id,
    p.id,
    p.name,
    p.avatar_url,
    lm.body,
    coalesce(lm.created_at, c.created_at),
    lm.sender_id,
    lm.read_at,
    (select count(*)::int from messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.read_at is null)
  from conversation_members me
  join conversations c        on c.id = me.conversation_id
  join conversation_members o on o.conversation_id = c.id and o.user_id <> me.user_id
  join profiles p             on p.id = o.user_id
  left join lateral (
    select m.body, m.created_at, m.sender_id, m.read_at
    from messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where me.user_id = auth.uid()
  order by 6 desc;
$$;

-- Marca como lidas as mensagens recebidas numa conversa (gera os ✓✓).
create function public.mark_read(p_conv uuid)
returns void language sql security definer set search_path = public as $$
  update messages
  set read_at = now()
  where conversation_id = p_conv
    and sender_id <> auth.uid()
    and read_at is null
    and public.is_member(p_conv);
$$;

-- ---------- Tempo real ----------

alter publication supabase_realtime add table public.messages;
