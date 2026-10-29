-- =============================================================
-- Nexo — foto de perfil e recado (rode no SQL Editor DEPOIS do schema.sql)
-- =============================================================

-- ---------- Recado do perfil ("Disponível", "No trabalho"...) ----------

alter table public.profiles
  add column if not exists about text check (char_length(about) <= 140);

grant update (name, avatar_url, about) on public.profiles to authenticated;

-- ---------- Fotos de perfil (Storage) ----------
-- Pasta pública "avatars"; cada usuário só mexe na própria subpasta (avatars/<id do usuário>/...).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatar: ver a própria pasta" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar: enviar na própria pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar: trocar na própria pasta" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar: apagar da própria pasta" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
