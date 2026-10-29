-- =============================================================
-- Nexo — fotos e arquivos, telefone, perfil do contato e apagar conversa
-- Rode depois dos arquivos anteriores (schema.sql, push.sql, perfil.sql),
-- no SQL Editor do Supabase.
-- =============================================================


-- =============================================================
-- 1. Apagar conversa (só para quem apagou)
--
-- Arrastar a conversa para a esquerda a apaga para quem arrastou.
-- A outra pessoa continua vendo tudo. Se chegar mensagem nova, a conversa
-- volta só com o que é novo. Nada é apagado do banco.
-- =============================================================

alter table public.conversation_members
  add column if not exists hidden_at timestamptz;

-- Quando o usuário logado apagou esta conversa (null = nunca apagou).
create or replace function public.my_hidden_at(p_conv uuid)
returns timestamptz language sql security definer stable set search_path = '' as $$
  select hidden_at from public.conversation_members
  where conversation_id = p_conv and user_id = auth.uid();
$$;

-- Apaga (p_hide = true) ou desfaz (false) para quem chamou. Apagar também marca como lida.
create or replace function public.hide_conversation(p_conv uuid, p_hide boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_members
     set hidden_at = case when p_hide then now() end
   where conversation_id = p_conv and user_id = auth.uid();

  if p_hide and found then
    update public.messages
       set read_at = now()
     where conversation_id = p_conv and sender_id <> auth.uid() and read_at is null;
  end if;
end $$;
revoke execute on function public.hide_conversation(uuid, boolean) from anon, public;
grant execute on function public.hide_conversation(uuid, boolean) to authenticated;

-- Cada pessoa só lê as mensagens que chegaram depois de ela apagar.
drop policy if exists "ler mensagens das suas conversas" on public.messages;
create policy "ler mensagens das suas conversas" on public.messages
  for select using (
    public.is_member(conversation_id)
    and created_at > coalesce(public.my_hidden_at(conversation_id), '-infinity')
  );


-- =============================================================
-- 2. Fotos e arquivos nas mensagens
-- =============================================================

alter table public.messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size integer;

-- Mensagem pode ser só o anexo (sem texto).
alter table public.messages alter column body drop not null;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  char_length(coalesce(body, '')) <= 4000
  and (char_length(coalesce(body, '')) >= 1 or attachment_path is not null)
);

-- O anexo precisa estar na pasta da própria conversa.
drop policy if exists "enviar mensagens nas suas conversas" on public.messages;
create policy "enviar mensagens nas suas conversas" on public.messages
  for insert with check (
    public.is_member(conversation_id)
    and sender_id = auth.uid()
    and (attachment_path is null or attachment_path like conversation_id::text || '/%')
  );

-- Pasta privada "attachments": attachments/<id da conversa>/<arquivo>.
-- Só quem participa da conversa envia e abre os arquivos dela.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 20971520)
on conflict (id) do nothing;

create or replace function public.can_use_folder(p_folder text)
returns boolean language sql security definer stable set search_path = '' as $$
  select case
    when p_folder ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.is_member(p_folder::uuid)
    else false
  end;
$$;

drop policy if exists "anexos: ver da conversa" on storage.objects;
create policy "anexos: ver da conversa" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.can_use_folder((storage.foldername(name))[1]));

drop policy if exists "anexos: enviar na conversa" on storage.objects;
create policy "anexos: enviar na conversa" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_use_folder((storage.foldername(name))[1]));

drop policy if exists "anexos: apagar os próprios" on storage.objects;
create policy "anexos: apagar os próprios" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and owner_id = auth.uid()::text);


-- =============================================================
-- 3. Telefone (tabela separada: só o dono lê e altera direto)
-- =============================================================

create table if not exists public.user_phones (
  user_id    uuid primary key references public.profiles on delete cascade,
  phone      text not null unique,          -- formato internacional: +5511912345678
  visible    boolean not null default true, -- deixa contatos verem, ligarem e encontrarem pelo número
  updated_at timestamptz not null default now()
);
alter table public.user_phones enable row level security;
revoke all on public.user_phones from anon;

drop policy if exists "telefone do próprio usuário" on public.user_phones;
create policy "telefone do próprio usuário" on public.user_phones
  for select to authenticated using (user_id = auth.uid());

-- "(11) 91234-5678" -> "+5511912345678". Números com 10 ou 11 dígitos são do Brasil.
create or replace function public.normalize_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d = '' then null
    when length(d) in (10, 11) then '+55' || d
    else '+' || d
  end
  from (select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^0+', '') as d) x;
$$;

-- Salva (ou apaga, com p_phone vazio) o telefone do usuário logado.
create or replace function public.set_my_phone(p_phone text, p_visible boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_phone(p_phone);
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;

  if v_phone is null then
    delete from public.user_phones where user_id = auth.uid();
    return null;
  end if;

  if length(v_phone) not between 11 and 16 then
    raise exception 'Telefone inválido';
  end if;

  if exists (select 1 from public.user_phones where phone = v_phone and user_id <> auth.uid()) then
    raise exception 'Esse telefone já está em outra conta';
  end if;

  insert into public.user_phones (user_id, phone, visible, updated_at)
  values (auth.uid(), v_phone, p_visible, now())
  on conflict (user_id) do update
    set phone = excluded.phone, visible = excluded.visible, updated_at = now();
  return v_phone;
end $$;
revoke execute on function public.set_my_phone(text, boolean) from anon, public;
grant execute on function public.set_my_phone(text, boolean) to authenticated;

-- Procura alguém pelo e-mail ou pelo telefone (para começar uma conversa).
create or replace function public.find_user(p_query text)
returns table (id uuid, name text, avatar_url text)
language sql security definer stable set search_path = '' as $$
  select p.id, p.name, p.avatar_url
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and (
      (position('@' in p_query) > 0 and p.email = lower(trim(p_query)))
      or (position('@' in p_query) = 0 and exists (
        select 1 from public.user_phones u
        where u.user_id = p.id and u.visible and u.phone = public.normalize_phone(p_query)
      ))
    );
$$;
revoke execute on function public.find_user(text) from anon, public;
grant execute on function public.find_user(text) to authenticated;


-- =============================================================
-- 4. Perfil do contato (foto, recado e telefone, se ele deixou visível)
-- =============================================================

create or replace function public.contact_card(p_user uuid)
returns table (id uuid, name text, avatar_url text, about text, email text, phone text)
language sql security definer stable set search_path = '' as $$
  select p.id, p.name, p.avatar_url, p.about, p.email,
         (select u.phone from public.user_phones u where u.user_id = p.id and u.visible)
  from public.profiles p
  where p.id = p_user and public.shares_conversation(p_user);
$$;
revoke execute on function public.contact_card(uuid) from anon, public;
grant execute on function public.contact_card(uuid) to authenticated;


-- =============================================================
-- 5. Lista de conversas (refeita: esconde as apagadas e mostra anexos)
--
-- p_conv: devolve essa conversa mesmo se estiver apagada
-- (ex.: quando a pessoa começa de novo uma conversa que tinha apagado).
-- =============================================================

drop function if exists public.my_conversations();

create or replace function public.my_conversations(p_conv uuid default null)
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
language sql security definer stable set search_path = '' as $$
  select
    c.id,
    p.id,
    p.name,
    p.avatar_url,
    case
      when lm.id is null then null
      when lm.body is not null then lm.body
      when lm.attachment_type like 'image/%' then '📷 Foto'
      else '📎 ' || coalesce(lm.attachment_name, 'Arquivo')
    end,
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
    select m.id, m.body, m.attachment_type, m.attachment_name, m.created_at, m.sender_id, m.read_at
    from public.messages m
    where m.conversation_id = c.id
      and m.created_at > coalesce(me.hidden_at, '-infinity')
    order by m.created_at desc
    limit 1
  ) lm on true
  where me.user_id = auth.uid()
    and (c.id = p_conv or me.hidden_at is null or lm.id is not null)
  order by 6 desc;
$$;


-- =============================================================
-- 6. Entrar com Google: o perfil já nasce com o nome e a foto da conta Google
-- (para quem entra por e-mail, continua usando o começo do e-mail como nome)
-- =============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    lower(new.email),
    left(coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      split_part(new.email, '@', 1)
    ), 60),
    nullif(new.raw_user_meta_data->>'avatar_url', '')
  );
  return new;
end $$;
