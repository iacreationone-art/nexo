-- =============================================================
-- Nexo — criptografia de ponta a ponta (rode no SQL Editor DEPOIS de seguranca.sql)
-- Pode ser rodado de novo sem problema.
--
-- Como funciona:
-- - Cada pessoa tem um par de chaves. A pública fica aqui (contatos podem ler);
--   a privada fica no aparelho e, para trocar de aparelho, uma cópia trancada
--   com a senha de recuperação (o banco não consegue abrir).
-- - Cada conversa tem chaves próprias (versões), guardadas aqui embrulhadas
--   separadamente para cada participante.
-- - As mensagens ficam em "ciphertext" (texto embaralhado). O banco nunca vê o conteúdo.
-- - Quem usa "Esqueci a senha" ganha chaves novas e NÃO recebe as chaves antigas das
--   conversas: só lê dali em diante. Assim, quem roubar a conta não lê o histórico.
-- =============================================================


-- ---------- Chaves públicas ----------

create table if not exists public.user_keys (
  user_id    uuid primary key references public.profiles on delete cascade,
  public_key jsonb not null,   -- chave pública (JWK, ECDH P-256)
  reset_at   timestamptz,      -- última vez que usou "Esqueci a senha"
  updated_at timestamptz not null default now()
);
alter table public.user_keys enable row level security;
revoke all on public.user_keys from anon;

drop policy if exists "chave pública: minha e dos contatos" on public.user_keys;
create policy "chave pública: minha e dos contatos" on public.user_keys
  for select to authenticated
  using (user_id = auth.uid() or public.shares_conversation(user_id));


-- ---------- Cópia da chave privada, trancada com a senha de recuperação ----------
-- Só o próprio dono lê (para abrir num aparelho novo).

create table if not exists public.user_key_backups (
  user_id        uuid primary key references public.profiles on delete cascade,
  private_backup text not null,  -- chave privada cifrada com a senha (base64)
  salt           text not null,
  iterations     int  not null,
  updated_at     timestamptz not null default now()
);
alter table public.user_key_backups enable row level security;
revoke all on public.user_key_backups from anon;

drop policy if exists "cópia da chave: só o dono" on public.user_key_backups;
create policy "cópia da chave: só o dono" on public.user_key_backups
  for select to authenticated using (user_id = auth.uid());


-- ---------- Chaves das conversas ----------

-- Cada versão de chave de uma conversa (uma nova é criada quando alguém troca de senha).
create table if not exists public.conversation_key_versions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations on delete cascade,
  created_by      uuid not null references public.profiles on delete cascade,
  created_at      timestamptz not null default now()
);
create index if not exists conversation_key_versions_conv_idx
  on public.conversation_key_versions (conversation_id, created_at desc);
alter table public.conversation_key_versions enable row level security;
revoke all on public.conversation_key_versions from anon;

-- A mesma chave, embrulhada para cada participante.
create table if not exists public.conversation_keys (
  key_id          uuid not null references public.conversation_key_versions on delete cascade,
  user_id         uuid not null references public.profiles on delete cascade,
  conversation_id uuid not null references public.conversations on delete cascade,
  wrapped_key     text not null check (char_length(wrapped_key) <= 200),
  wrapper_id      uuid not null references public.profiles on delete cascade,
  wrapper_public  jsonb not null, -- chave pública de quem embrulhou (no momento do embrulho)
  created_at      timestamptz not null default now(),
  primary key (key_id, user_id)
);
create index if not exists conversation_keys_user_idx on public.conversation_keys (user_id, conversation_id);
alter table public.conversation_keys enable row level security;
revoke all on public.conversation_keys from anon;

drop policy if exists "chave da conversa: só a minha" on public.conversation_keys;
create policy "chave da conversa: só a minha" on public.conversation_keys
  for select to authenticated using (user_id = auth.uid());

-- Pode receber a versão v? Sim, se nunca trocou de senha ou se a versão é posterior à troca.
create or replace function public.can_receive_key(p_user uuid, p_key uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
    from public.user_keys u, public.conversation_key_versions v
    where u.user_id = p_user and v.id = p_key
      and (u.reset_at is null or v.created_at > u.reset_at)
  );
$$;
revoke execute on function public.can_receive_key(uuid, uuid) from anon, public;


-- ---------- Funções chamadas pelo app ----------

-- Salva minhas chaves. p_replace = true só no "Esqueci a senha" (começa do zero).
create or replace function public.set_my_keys(
  p_public jsonb, p_backup text, p_salt text, p_iterations int, p_replace boolean default false
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  if p_public ? 'd' or coalesce(p_public->>'kty', '') <> 'EC' or coalesce(p_public->>'crv', '') <> 'P-256'
     or p_public->>'x' is null or p_public->>'y' is null then
    raise exception 'chave pública inválida';
  end if;
  if p_iterations < 100000 or char_length(p_backup) > 1000 or char_length(p_salt) > 100 then
    raise exception 'cópia da chave inválida';
  end if;

  v_exists := exists (select 1 from public.user_keys where user_id = auth.uid());
  if v_exists and not p_replace then
    raise exception 'As chaves já existem';
  end if;

  if v_exists then
    -- As chaves antigas das conversas não abrem mais com a chave nova.
    delete from public.conversation_keys where user_id = auth.uid();
  end if;

  insert into public.user_keys (user_id, public_key, reset_at, updated_at)
  values (auth.uid(), p_public, case when v_exists then now() end, now())
  on conflict (user_id) do update
    set public_key = excluded.public_key, reset_at = excluded.reset_at, updated_at = now();

  insert into public.user_key_backups (user_id, private_backup, salt, iterations, updated_at)
  values (auth.uid(), p_backup, p_salt, p_iterations, now())
  on conflict (user_id) do update
    set private_backup = excluded.private_backup, salt = excluded.salt,
        iterations = excluded.iterations, updated_at = now();
end $$;
revoke execute on function public.set_my_keys(jsonb, text, text, int, boolean) from anon, public;
grant execute on function public.set_my_keys(jsonb, text, text, int, boolean) to authenticated;

-- Qual chave usar para enviar nesta conversa.
-- needs_new = true: o app deve criar uma versão nova (não há chave, eu não tenho a última,
-- ou alguém trocou de senha depois dela e não pode recebê-la).
create or replace function public.conversation_key_state(p_conv uuid)
returns table (key_id uuid, needs_new boolean)
language sql security definer stable set search_path = '' as $$
  with latest as (
    select v.id from public.conversation_key_versions v
    where v.conversation_id = p_conv
    order by v.created_at desc, v.id
    limit 1
  )
  select
    l.id,
    l.id is null
    or not exists (select 1 from public.conversation_keys k where k.key_id = l.id and k.user_id = auth.uid())
    or exists (
      select 1 from public.conversation_members m
      join public.user_keys u on u.user_id = m.user_id
      where m.conversation_id = p_conv
        and not exists (select 1 from public.conversation_keys k where k.key_id = l.id and k.user_id = m.user_id)
        and not public.can_receive_key(m.user_id, l.id)
    )
  from (select 1) one
  left join latest l on true
  where public.is_member(p_conv);
$$;
revoke execute on function public.conversation_key_state(uuid) from anon, public;
grant execute on function public.conversation_key_state(uuid) to authenticated;

-- Cria uma versão nova da chave da conversa, já com a minha cópia embrulhada.
create or replace function public.create_conversation_key(p_conv uuid, p_wrapped text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pub jsonb;
  v_key uuid;
begin
  if not public.is_member(p_conv) then
    raise exception 'sem acesso a esta conversa';
  end if;
  select public_key into v_pub from public.user_keys where user_id = auth.uid();
  if v_pub is null then
    raise exception 'crie suas chaves primeiro';
  end if;

  insert into public.conversation_key_versions (conversation_id, created_by)
  values (p_conv, auth.uid())
  returning id into v_key;

  insert into public.conversation_keys (key_id, user_id, conversation_id, wrapped_key, wrapper_id, wrapper_public)
  values (v_key, auth.uid(), p_conv, p_wrapped, auth.uid(), v_pub);
  return v_key;
end $$;
revoke execute on function public.create_conversation_key(uuid, text) from anon, public;
grant execute on function public.create_conversation_key(uuid, text) to authenticated;

-- Entrega a p_user uma chave que eu tenho. Devolve false se não entregou.
create or replace function public.share_conversation_key(p_key uuid, p_user uuid, p_wrapped text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_conv uuid;
  v_pub  jsonb;
begin
  select conversation_id into v_conv from public.conversation_keys
  where key_id = p_key and user_id = auth.uid();
  if v_conv is null then
    raise exception 'você não tem essa chave';
  end if;
  if not exists (select 1 from public.conversation_members where conversation_id = v_conv and user_id = p_user)
     or not public.can_receive_key(p_user, p_key) then
    return false;
  end if;
  select public_key into v_pub from public.user_keys where user_id = auth.uid();

  insert into public.conversation_keys (key_id, user_id, conversation_id, wrapped_key, wrapper_id, wrapper_public)
  values (p_key, p_user, v_conv, p_wrapped, auth.uid(), v_pub)
  on conflict do nothing;
  return found;
end $$;
revoke execute on function public.share_conversation_key(uuid, uuid, text) from anon, public;
grant execute on function public.share_conversation_key(uuid, uuid, text) to authenticated;

-- Chaves que eu tenho e que algum participante ainda não recebeu (e pode receber).
create or replace function public.missing_conversation_keys()
returns table (key_id uuid, conversation_id uuid, user_id uuid, public_key jsonb)
language sql security definer stable set search_path = '' as $$
  select ck.key_id, ck.conversation_id, m.user_id, uk.public_key
  from public.conversation_keys ck
  join public.conversation_members m
    on m.conversation_id = ck.conversation_id and m.user_id <> auth.uid()
  join public.user_keys uk on uk.user_id = m.user_id
  where ck.user_id = auth.uid()
    and public.can_receive_key(m.user_id, ck.key_id)
    and not exists (
      select 1 from public.conversation_keys x
      where x.key_id = ck.key_id and x.user_id = m.user_id
    );
$$;
revoke execute on function public.missing_conversation_keys() from anon, public;
grant execute on function public.missing_conversation_keys() to authenticated;


-- ---------- Mensagens cifradas ----------

alter table public.messages
  add column if not exists ciphertext text,
  add column if not exists key_id uuid;

alter table public.messages drop constraint if exists messages_ciphertext_check;
alter table public.messages add constraint messages_ciphertext_check check (
  (ciphertext is null and key_id is null)
  or (ciphertext like 'e1:%' and char_length(ciphertext) <= 24000 and key_id is not null)
);

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  char_length(coalesce(body, '')) <= 4000
  and (char_length(coalesce(body, '')) >= 1 or ciphertext is not null or attachment_path is not null)
);

revoke insert on public.messages from anon, authenticated;
grant insert (conversation_id, body, ciphertext, key_id, attachment_path, attachment_name, attachment_type, attachment_size)
  on public.messages to authenticated;


-- ---------- Lista de conversas: a última mensagem cifrada vai como está (o app abre) ----------

drop function if exists public.my_conversations(uuid);

create or replace function public.my_conversations(p_conv uuid default null)
returns table (
  conversation_id uuid,
  other_id        uuid,
  other_name      text,
  other_avatar    text,
  last_body       text,
  last_key        uuid,
  last_at         timestamptz,
  last_sender     uuid,
  last_read_at    timestamptz,
  unread          int
)
language sql security definer stable set search_path = '' as $$
  select
    c.id,
    p.id,
    p.name,
    p.avatar_url,
    case
      when lm.id is null then null
      when lm.ciphertext is not null then lm.ciphertext
      when lm.body is not null then lm.body
      when lm.attachment_type like 'image/%' then '📷 Foto'
      else '📎 ' || coalesce(lm.attachment_name, 'Arquivo')
    end,
    lm.key_id,
    coalesce(lm.created_at, greatest(c.created_at, me.hidden_at)),
    lm.sender_id,
    lm.read_at,
    (select count(*)::int from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.read_at is null
        and m.created_at > coalesce(me.hidden_at, '-infinity'))
  from public.conversation_members me
  join public.conversations c        on c.id = me.conversation_id
  join public.conversation_members o on o.conversation_id = c.id and o.user_id <> me.user_id
  join public.profiles p             on p.id = o.user_id
  left join lateral (
    select m.id, m.body, m.ciphertext, m.key_id, m.attachment_type, m.attachment_name,
           m.created_at, m.sender_id, m.read_at
    from public.messages m
    where m.conversation_id = c.id
      and m.created_at > coalesce(me.hidden_at, '-infinity')
    order by m.created_at desc
    limit 1
  ) lm on true
  where me.user_id = auth.uid()
    and (c.id = p_conv or me.hidden_at is null or lm.id is not null)
  order by 7 desc;
$$;
revoke execute on function public.my_conversations(uuid) from anon, public;
grant execute on function public.my_conversations(uuid) to authenticated;


-- ---------- Tempo real: avisa o app quando chega uma chave nova ----------

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_keys') then
    alter publication supabase_realtime add table public.conversation_keys;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_keys') then
    alter publication supabase_realtime add table public.user_keys;
  end if;
end $$;
