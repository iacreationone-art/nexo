// Edge Function "send-push": chamada pelo banco a cada mensagem nova.
// Envia notificação push para os aparelhos dos outros participantes da conversa.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.117.0'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.headers.get('x-push-secret') !== Deno.env.get('PUSH_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  const { message_id } = await req.json()

  // Os dados vêm sempre do banco, nunca da requisição.
  const { data: msg } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body')
    .eq('id', message_id)
    .single()
  if (!msg) return new Response('message not found', { status: 404 })

  const [{ data: sender }, { data: members }] = await Promise.all([
    supabase.from('profiles').select('name').eq('id', msg.sender_id).single(),
    supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', msg.conversation_id)
      .neq('user_id', msg.sender_id),
  ])

  const recipients = (members || []).map((m) => m.user_id)
  if (!recipients.length) return new Response('no recipients')

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', recipients)

  const payload = JSON.stringify({
    title: sender?.name || 'Nova mensagem',
    body: msg.body.length > 200 ? msg.body.slice(0, 200) + '…' : msg.body,
    conversation_id: msg.conversation_id,
  })

  const results = await Promise.allSettled(
    (subs || []).map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 86400, urgency: 'high' },
      ),
    ),
  )

  // Aparelhos que desinstalaram ou bloquearam: remove a inscrição.
  const gone = results
    .map((r, i) => (r.status === 'rejected' && [404, 410].includes(r.reason?.statusCode) ? subs![i].endpoint : null))
    .filter(Boolean)
  if (gone.length) await supabase.from('push_subscriptions').delete().in('endpoint', gone)

  const failed = results.filter((r) => r.status === 'rejected').length
  return new Response(JSON.stringify({ sent: results.length - failed, failed, removed: gone.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
