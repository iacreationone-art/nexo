-- =============================================================
-- Nexo — notificações push (rode no SQL Editor DEPOIS do schema.sql)
-- Pode ser rodado de novo sem problema: pula o que já existe.
--
-- Antes de rodar, guarde o segredo do push no Vault (uma vez só),
-- trocando o texto pelo seu PUSH_SECRET:
--   select vault.create_secret('SEU_PUSH_SECRET', 'push_secret');
-- =============================================================

create extension if not exists pg_net with schema extensions;

-- ---------- Aparelhos inscritos para receber push ----------

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- Sem regras de acesso: o app só mexe nesta tabela pelas funções abaixo,
-- e a Edge Function lê com a chave de serviço.
alter table public.push_subscriptions enable row level security;

-- Salva a inscrição deste aparelho para o usuário logado.
-- Se o aparelho era de outra conta (mesmo navegador), passa a ser deste usuário.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- Remove a inscrição deste aparelho (ao sair da conta).
create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- ---------- A cada mensagem nova, chama a Edge Function send-push ----------

create or replace function public.notify_new_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_secret';
  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url     := 'https://ngfyqbcqkecudbkdvqph.supabase.co/functions/v1/send-push',
    body    := jsonb_build_object('message_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret)
  );
  return new;
end $$;

drop trigger if exists messages_push on public.messages;
create trigger messages_push
  after insert on public.messages
  for each row execute function public.notify_new_message();
