// Edge Function "send-push": chamada pelo banco a cada mensagem nova.
// Envia notificação push para os aparelhos dos outros participantes da conversa.
// Se faltar configuração, responde dizendo o que falta (em vez de só quebrar).

const REQUIRED = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'PUSH_SECRET'] as const

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  const missing = REQUIRED.filter((name) => !Deno.env.get(name))
  if (missing.length) return json({ error: 'Faltam Secrets: ' + missing.join(', ') }, 500)

  if (req.headers.get('x-push-secret') !== Deno.env.get('PUSH_SECRET')) {
    return json({ error: 'forbidden' }, 403)
  }

  let webpush, createClient
  try {
    webpush = (await import('npm:web-push@3.6.7')).default
    ;({ createClient } = await import('npm:@supabase/supabase-js@2.117.0'))
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    )
  } catch (err) {
    return json({ error: 'Falha ao iniciar: ' + (err as Error).message }, 500)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { message_id } = await req.json()

  // Os dados vêm sempre do banco, nunca da requisição.
  const { data: msg } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, attachment_type, attachment_name')
    .eq('id', message_id)
    .single()
  if (!msg) return json({ error: 'message not found' }, 404)

  const [{ data: sender }, { data: members }] = await Promise.all([
    supabase.from('profiles').select('name').eq('id', msg.sender_id).single(),
    supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', msg.conversation_id)
      .neq('user_id', msg.sender_id),
  ])

  const recipients = (members || []).map((m: { user_id: string }) => m.user_id)
  if (!recipients.length) return json({ sent: 0, reason: 'no recipients' })

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', recipients)

  const text = msg.body
    ? msg.body
    : msg.attachment_type?.startsWith('image/')
      ? '📷 Foto'
      : '📎 ' + (msg.attachment_name || 'Arquivo')

  const payload = JSON.stringify({
    title: sender?.name || 'Nova mensagem',
    body: text.length > 200 ? text.slice(0, 200) + '…' : text,
    conversation_id: msg.conversation_id,
  })

  const list = subs || []
  const results = await Promise.allSettled(
    list.map((s: { endpoint: string; p256dh: string; auth: string }) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 86400, urgency: 'high' },
      ),
    ),
  )

  // Aparelhos que desinstalaram ou bloquearam: remove a inscrição.
  const gone = results
    .map((r, i) =>
      r.status === 'rejected' && [404, 410].includes((r.reason as { statusCode?: number })?.statusCode ?? 0)
        ? list[i].endpoint
        : null,
    )
    .filter(Boolean)
  if (gone.length) await supabase.from('push_subscriptions').delete().in('endpoint', gone)

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => String(r.reason?.body || r.reason?.message || r.reason).slice(0, 200))
  return json({ devices: list.length, sent: list.length - errors.length, removed: gone.length, errors })
})
