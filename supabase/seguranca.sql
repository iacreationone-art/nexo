-- =============================================================
-- Nexo — ajustes de segurança (rode no SQL Editor DEPOIS de prioridade1.sql)
-- Pode ser rodado de novo sem problema.
-- =============================================================


-- =============================================================
-- 1. Telefone e e-mail só aparecem para quem já conversou de verdade
--
-- Antes: bastava alguém abrir uma conversa com você (sem você responder)
-- para ver seu telefone e seu e-mail. Agora eles só aparecem depois que
-- você mandou pelo menos uma mensagem para essa pessoa.
-- =============================================================

-- p_user já mandou alguma mensagem numa conversa com o usuário logado?
create or replace function public.has_replied_to_me(p_user uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
    from public.conversation_members me
    join public.messages m on m.conversation_id = me.conversation_id
    where me.user_id = auth.uid()
      and m.sender_id = p_user
      and p_user <> auth.uid()
  );
$$;
revoke execute on function public.has_replied_to_me(uuid) from anon, public;
grant execute on function public.has_replied_to_me(uuid) to authenticated;

create or replace function public.contact_card(p_user uuid)
returns table (id uuid, name text, avatar_url text, about text, email text, phone text)
language sql security definer stable set search_path = '' as $$
  select p.id, p.name, p.avatar_url, p.about,
         case when public.has_replied_to_me(p.id) then p.email end,
         case when public.has_replied_to_me(p.id) then
           (select u.phone from public.user_phones u where u.user_id = p.id and u.visible)
         end
  from public.profiles p
  where p.id = p_user and public.shares_conversation(p_user);
$$;
revoke execute on function public.contact_card(uuid) from anon, public;
grant execute on function public.contact_card(uuid) to authenticated;


-- =============================================================
-- 2. Quem envia não escolhe a data nem o "lida"
--
-- O app só pode mandar a conversa, o texto e o anexo.
-- Data (created_at), remetente (sender_id) e "lida" (read_at) são do banco.
-- =============================================================

revoke insert on public.messages from anon, authenticated;
grant insert (conversation_id, body, attachment_path, attachment_name, attachment_type, attachment_size)
  on public.messages to authenticated;
