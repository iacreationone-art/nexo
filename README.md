# Nexo

Mensagens em tempo real que funcionam como site — sem App Store nem Google Play.
Abra no navegador do celular e use **Adicionar à tela inicial**: o Nexo vira um ícone e abre em tela cheia, como um app.

- **Front-end:** HTML/CSS/JS puro, hospedado no GitHub Pages (sem build)
- **Back-end:** Supabase (login, banco Postgres, tempo real)

## Recursos

- Login por código enviado ao e-mail
- Conversas 1 a 1 começadas pelo e-mail ou telefone do contato
- Fotos e arquivos (até 20 MB) em pasta privada da conversa
- Perfil com foto, recado e telefone; dados do contato com Ligar e WhatsApp
- Arrastar a conversa para a esquerda apaga só para você, com "Desfazer"
- Mensagens chegando na hora, "online", "digitando…", ✓ enviada / ✓✓ lida
- Contador de não lidas
- Instalável (PWA), tema claro/escuro automático
- Notificações push, mesmo com o app fechado

## Configuração

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Abra **SQL Editor**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Em **Authentication → Emails → Templates → Magic Link**, troque o texto para incluir o código:
   ```html
   <h2>Seu código do Nexo</h2>
   <p>Digite este código no app: <strong>{{ .Token }}</strong></p>
   ```
   (No iPhone, o app instalado não recebe o clique no link do e-mail; por isso usamos o código.)
4. Em **Authentication → URL Configuration**, coloque em *Site URL* e *Redirect URLs* o endereço do site
   (ex.: `https://iacreationone-art.github.io/nexo/`).
5. Em **Project Settings → API**, copie a *Project URL* e a chave *anon public* para [`js/config.js`](js/config.js).

> O envio de e-mail embutido do Supabase tem limite baixo de mensagens por hora. Para uso real, configure um SMTP próprio
> (Resend, Brevo etc.) em **Authentication → Emails → SMTP Settings**.

### 2. GitHub Pages

1. Envie os arquivos para o repositório.
2. Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. Em alguns minutos o site fica em `https://iacreationone-art.github.io/nexo/`.

### Testar no computador

Qualquer servidor estático serve, por exemplo a extensão *Live Server* do VS Code.
Adicione `http://localhost:5500` (ou a porta usada) às *Redirect URLs* do Supabase.

### 3. Perfil, fotos, telefone e apagar conversa

No SQL Editor, rode (nesta ordem, depois do `schema.sql`):

1. [`supabase/perfil.sql`](supabase/perfil.sql) — foto de perfil e recado
2. [`supabase/prioridade1.sql`](supabase/prioridade1.sql) — fotos e arquivos nas conversas, telefone,
   dados do contato e apagar conversa (só para quem apagou)

### 4. Notificações push (opcional)

Avisam de mensagens novas mesmo com o app fechado. As chaves secretas ficam fora do repositório
(arquivo `nexo-segredos.txt`) — nunca as coloque no GitHub.

1. **SQL Editor:** rode `select vault.create_secret('SEU_PUSH_SECRET', 'push_secret');` e depois todo o
   [`supabase/push.sql`](supabase/push.sql).
2. **Edge Functions → Secrets:** adicione `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` e `PUSH_SECRET`.
3. **Edge Functions → Deploy a new function → Via Editor:** nome `send-push`, cole
   [`supabase/functions/send-push/index.ts`](supabase/functions/send-push/index.ts) e clique em *Deploy*.
4. Nos detalhes da função, desligue **Verify JWT** (a função se protege com o `PUSH_SECRET`).
5. No app: foto de perfil → **Ativar notificações**. No iPhone, só funciona com o app instalado na tela inicial (iOS 16.4+).

## Como instalar no celular

- **Android (Chrome):** aparece o botão **Instalar** no topo da lista, ou menu ⋮ → *Instalar app*.
- **iPhone (Safari):** botão Compartilhar → *Adicionar à Tela de Início*.

## Atualizações

Ao publicar mudanças, aumente a versão em `sw.js` (`const CACHE = 'nexo-v2'`) para os aparelhos baixarem os arquivos novos.

## Próximos passos possíveis

- Mensagens de áudio
- Grupos
- Foto de perfil
- Canais privados do Realtime para "online" e "digitando…"
