// netlify/functions/mp-webhook.js
//
// Recebe a notificação do Mercado Pago quando o status de um pagamento muda,
// confirma o status direto na API (nunca confia só no aviso) e, se aprovado:
//   1. cria um link de acesso único (token) no Firestore
//   2. envia um e-mail (Resend) com o botão "Acessar meu guia digital"
//
// Se algo falhar ao criar o acesso, envia o PDF anexado como plano B,
// para o comprador nunca ficar sem receber o material.
//
// Variáveis de ambiente (painel do Netlify, nunca no código):
//   MP_ACCESS_TOKEN           — token do Mercado Pago
//   RESEND_API_KEY            — chave do Resend
//   RESEND_FROM_EMAIL         — remetente autorizado
//   FIREBASE_SERVICE_ACCOUNT  — JSON da conta de serviço do Firebase
//   SITE_URL (opcional)       — endereço do site; se ausente usa a URL do Netlify

const { MercadoPagoConfig, Payment } = require('mercadopago');
const { Resend } = require('resend');
const admin = require('firebase-admin');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PDF_PATH = path.join(__dirname, 'assets', 'Plano_de_Estudo_de_IAs_Sara.pdf');
const REMETENTE = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const WHATSAPP = 'https://wa.me/5547999193829';

function getDb() {
  if (!admin.apps.length) {
    const credencial = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(credencial) });
  }
  return admin.firestore();
}

function baseUrl() {
  return (process.env.SITE_URL || process.env.URL || 'https://plano-estudo-ias-sara.netlify.app')
    .replace(/\/$/, '');
}

function htmlComBotao(link) {
  return `
    <div style="font-family: Arial, sans-serif; color:#0F3D33; max-width:520px; line-height:1.6;">
      <p>Oi! Seu pagamento foi confirmado — muito obrigada pela confiança.</p>
      <p>Seu <strong>Plano de Estudo de IAs para Professores e Pesquisadores</strong> já está liberado:</p>
      <p style="margin:28px 0;">
        <a href="${link}" style="background:#0F3D33; color:#F8F9FA; padding:14px 26px; text-decoration:none; border-radius:4px; font-weight:bold; display:inline-block;">
          Acessar meu guia digital
        </a>
      </p>
      <p style="font-size:13px; color:#555;">Guarde este e-mail: o link é seu e não expira. Se o botão não abrir, copie e cole no navegador:<br>${link}</p>
      <p>Qualquer dúvida, me chama no WhatsApp: <a href="${WHATSAPP}">clique aqui</a>.</p>
      <p>Um abraço,<br>Sara Reinhardt</p>
    </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!process.env.MP_ACCESS_TOKEN || !process.env.RESEND_API_KEY) {
    console.error('Variáveis de ambiente faltando (MP_ACCESS_TOKEN ou RESEND_API_KEY)');
    return { statusCode: 500, body: 'config missing' };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const paymentId = body.data?.id;
    if (!paymentId) {
      return { statusCode: 200, body: 'ignored (no payment id)' };
    }

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const paymentClient = new Payment(client);
    const paymentInfo = await paymentClient.get({ id: paymentId });

    if (paymentInfo.status !== 'approved') {
      return { statusCode: 200, body: `status: ${paymentInfo.status}` };
    }

    const buyerEmail = paymentInfo.metadata?.email || paymentInfo.payer?.email;
    const buyerNome = paymentInfo.metadata?.nome || '';
    if (!buyerEmail) {
      console.error('Pagamento aprovado sem e-mail do comprador:', paymentId);
      return { statusCode: 200, body: 'approved but no email' };
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const assunto = 'Seu Plano de Estudo de IAs chegou! 🎉';

    // ---- Caminho principal: link de acesso (sem anexo) ----
    let db = null;
    let pagamentoRef = null;
    try {
      db = getDb();
      pagamentoRef = db.collection('pagamentos').doc(String(paymentId));

      // Trava contra notificações repetidas do Mercado Pago:
      // create() falha se o documento já existir.
      try {
        await pagamentoRef.create({ status: 'processando', criadoEm: admin.firestore.FieldValue.serverTimestamp() });
      } catch (jaExiste) {
        console.log(`Pagamento ${paymentId} já processado, ignorando notificação repetida`);
        return { statusCode: 200, body: 'duplicate' };
      }

      const token = crypto.randomBytes(24).toString('hex');
      await db.collection('acessos').doc(token).set({
        status: 'pago',
        email: buyerEmail,
        nome: buyerNome,
        paymentId: String(paymentId),
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      });

      const link = `${baseUrl()}/acesso.html?token=${token}`;

      const { error } = await resend.emails.send({
        from: `Sara Reinhardt <${REMETENTE}>`,
        to: buyerEmail,
        subject: assunto,
        html: htmlComBotao(link),
      });
      if (error) throw new Error('Resend: ' + JSON.stringify(error));

      try { await pagamentoRef.update({ status: 'enviado', token, email: buyerEmail }); } catch (e) { console.error('Não consegui marcar como enviado:', e); }
      console.log(`Link de acesso enviado para ${buyerEmail} (pagamento ${paymentId})`);
      return { statusCode: 200, body: 'ok' };
    } catch (errPrincipal) {
      console.error('Falha no envio por link, usando PDF anexado como plano B:', errPrincipal);
    }

    // ---- Plano B: PDF anexado (como era antes) ----
    const pdfBuffer = fs.readFileSync(PDF_PATH);
    await resend.emails.send({
      from: `Sara Reinhardt <${REMETENTE}>`,
      to: buyerEmail,
      subject: assunto,
      html: `
        <p>Oi! Seu pagamento foi confirmado — muito obrigada pela confiança.</p>
        <p>Segue em anexo o seu <strong>Plano de Estudo de IAs para Professores e Pesquisadores</strong>.</p>
        <p>Qualquer dúvida, me chama no WhatsApp: <a href="${WHATSAPP}">clique aqui</a>.</p>
        <p>Um abraço,<br>Sara Reinhardt</p>`,
      attachments: [
        { filename: 'Plano_de_Estudo_de_IAs_Sara.pdf', content: pdfBuffer.toString('base64') },
      ],
    });
    try { if (pagamentoRef) await pagamentoRef.set({ status: 'enviado-pdf' }, { merge: true }); } catch (_) {}
    console.log(`PDF (plano B) enviado para ${buyerEmail} (pagamento ${paymentId})`);
    return { statusCode: 200, body: 'ok (pdf)' };
  } catch (err) {
    console.error('Erro no webhook:', err);
    return { statusCode: 500, body: 'error' };
  }
};
