-- =============================================================
-- Nexo — apagar mensagem ("para mim" e "para todos")
-- Rode depois dos arquivos anteriores (por último, cripto.sql), no SQL Editor do Supabase.
-- Pode ser rodado de novo sem problema.
-- =============================================================


-- =============================================================
-- 1. Apagar para mim
--
-- A mensagem some só para quem apagou; a outra pessoa continua vendo.
-- Nada sai do banco, então o "Desfazer" só tira a marca.
-- =============================================================

create table if not exists public.message_hidden (
  user_id    uuid not null default auth.uid() references public.profiles on delete cascade,
  message_id bigint not null references public.messages on delete cascade,
  hidden_at  timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists message_hidden_message_idx on public.message_hidden (message_id);

-- Sem regras de acesso: o app só mexe aqui pelas funções abaixo.
alter table public.message_hidden enable row level security;
revoke all on public.message_hidden from anon, authenticated;

-- O usuário logado apagou esta mensagem para ele?
create or replace function public.i_hid_message(p_id bigint)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.message_hidden
    where message_id = p_id and user_id = auth.uid()
  );
$$;

-- Apaga (p_hide = true) ou desfaz (false) para quem chamou. Apagar também marca como lida.
create or replace function public.hide_message(p_id bigint, p_hide boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_conv uuid;
begin
  select conversation_id into v_conv from public.messages where id = p_id;
  if v_conv is null or not public.is_member(v_conv) then
    raise exception 'mensagem não encontrada';
  end if;

  if p_hide then
    insert into public.message_hidden (user_id, message_id)
    values (auth.uid(), p_id)
    on conflict do nothing;

    update public.messages
       set read_at = now()
     where id = p_id and sender_id <> auth.uid() and read_at is null;
  else
    delete from public.message_hidden
     where user_id = auth.uid() and message_id = p_id;
  end if;
end $$;
revoke execute on function public.hide_message(bigint, boolean) from anon, public;
grant execute on function public.hide_message(bigint, boolean) to authenticated;

-- Cada pessoa só lê as mensagens que chegaram depois de ela apagar a conversa
-- e que ela não apagou uma a uma.
drop policy if exists "ler mensagens das suas conversas" on public.messages;
create policy "ler mensagens das suas conversas" on public.messages
  for select using (
    public.is_member(conversation_id)
    and created_at > coalesce(public.my_hidden_at(conversation_id), '-infinity')
    and not public.i_hid_message(id)
  );


-- =============================================================
-- 2. Apagar para todos
--
-- Só quem enviou, sem prazo. O conteúdo (texto cifrado e anexo) sai do banco
-- e fica só a marca "deleted_at": os dois veem "Mensagem apagada".
-- O arquivo do anexo o app apaga do Storage (a regra "anexos: apagar os próprios"
-- já deixa quem enviou apagar).
-- =============================================================

alter table public.messages
  add column if not exists deleted_at timestamptz;

-- Mensagem apagada para todos pode ficar sem texto e sem anexo.
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  char_length(coalesce(body, '')) <= 4000
  and (
    char_length(coalesce(body, '')) >= 1
    or ciphertext is not null
    or attachment_path is not null
    or deleted_at is not null
  )
);

-- Devolve o caminho do anexo (se tinha) para o app apagar o arquivo.
create or replace function public.delete_message_for_all(p_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_path text;
begin
  select attachment_path into v_path
    from public.messages
   where id = p_id and sender_id = auth.uid() and deleted_at is null
   for update;
  if not found then
    raise exception 'só dá para apagar para todos as mensagens que você enviou';
  end if;

  update public.messages
     set deleted_at = now(),
         body = null,
         ciphertext = null,
         key_id = null,
         attachment_path = null,
         attachment_name = null,
         attachment_type = null,
         attachment_size = null
   where id = p_id;

  return v_path;
end $$;
revoke execute on function public.delete_message_for_all(bigint) from anon, public;
grant execute on function public.delete_message_for_all(bigint) to authenticated;


-- =============================================================
-- 3. Lista de conversas
--
-- A última mensagem ignora as que a pessoa apagou para ela; se foi apagada
-- para todos, aparece "🚫 Mensagem apagada". Apagadas não contam como não lidas.
-- =============================================================

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
      when lm.deleted_at is not null then '🚫 Mensagem apagada'
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
        and m.deleted_at is null
        and m.created_at > coalesce(me.hidden_at, '-infinity')
        and not exists (select 1 from public.message_hidden h
                        where h.message_id = m.id and h.user_id = auth.uid()))
  from public.conversation_members me
  join public.conversations c        on c.id = me.conversation_id
  join public.conversation_members o on o.conversation_id = c.id and o.user_id <> me.user_id
  join public.profiles p             on p.id = o.user_id
  left join lateral (
    select m.id, m.body, m.ciphertext, m.key_id, m.attachment_type, m.attachment_name,
           m.created_at, m.sender_id, m.read_at, m.deleted_at
    from public.messages m
    where m.conversation_id = c.id
      and m.created_at > coalesce(me.hidden_at, '-infinity')
      and not exists (select 1 from public.message_hidden h
                      where h.message_id = m.id and h.user_id = auth.uid())
    order by m.created_at desc
    limit 1
  ) lm on true
  where me.user_id = auth.uid()
    and (c.id = p_conv or me.hidden_at is null or lm.id is not null)
  order by 7 desc;
$$;
revoke execute on function public.my_conversations(uuid) from anon, public;
grant execute on function public.my_conversations(uuid) to authenticated;
