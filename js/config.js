// Copie estes dois valores em Supabase → Project Settings → API.
// A chave "anon" é pública por natureza: quem protege os dados são as regras RLS do schema.sql.
export const SUPABASE_URL = 'https://ngfyqbcqkecudbkdvqph.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_7ki8Hx3QO77w0DZ2yYgJ4A_K4Ho4SUi'

// Chave pública VAPID das notificações push (a privada fica só nos Secrets da Edge Function).
export const VAPID_PUBLIC_KEY = 'BMRTvWHMeYetzolNS2V9TPMkYn7jO5pgsXzpy6H5c6TOI9MiHJyLiZLigW0AQy55HRj6O3IhuAfuc2WmPs-2WBY'
