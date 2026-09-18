// netlify/functions/mp-webhook.js
//
// Recebe a notificação do Mercado Pago quando o status de um pagamento muda,
// confirma o status direto na API (nunca confia só no aviso), e se aprovado,
// envia o e-book por e-mail automaticamente pro comprador via Resend.
//
// Variáveis de ambiente necessárias (configurar no painel do Netlify):
//   MP_ACCESS_TOKEN    — mesmo token usado no create-preference.js
//   RESEND_API_KEY     — chave da conta Resend
//   RESEND_FROM_EMAIL  — remetente autorizado (ex: onboarding@resend.dev por enquanto)

const { MercadoPagoConfig, Payment } = require('mercadopago');
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

const PDF_PATH = path.join(__dirname, 'assets', 'Plano_de_Estudo_de_IAs_Sara.pdf');
const REMETENTE = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

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

    // O Mercado Pago manda vários tipos de notificação; só nos interessa "payment"
    const paymentId = body.data?.id;
    if (!paymentId) {
      return { statusCode: 200, body: 'ignored (no payment id)' };
    }

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const paymentClient = new Payment(client);
    const paymentInfo = await paymentClient.get({ id: paymentId });

    if (paymentInfo.status !== 'approved') {
      // Ainda não aprovado (pode ser Pix pendente, cartão em análise, etc.)
      return { statusCode: 200, body: `status: ${paymentInfo.status}` };
    }

    const buyerEmail = paymentInfo.payer?.email;
    if (!buyerEmail) {
      console.error('Pagamento aprovado sem e-mail do comprador:', paymentId);
      return { statusCode: 200, body: 'approved but no email' };
    }

    const pdfBuffer = fs.readFileSync(PDF_PATH);
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: `Sara Reinhardt <${REMETENTE}>`,
      to: buyerEmail,
      subject: 'Seu Plano de Estudo de IAs chegou! 🎉',
      html: `
        <p>Oi! Seu pagamento foi confirmado — muito obrigada pela confiança.</p>
        <p>Segue em anexo o seu <strong>Plano de Estudo de IAs para Professores e Pesquisadores</strong>.</p>
        <p>Qualquer dúvida, me chama no WhatsApp: 
           <a href="https://wa.me/5547999193829">clique aqui</a>.</p>
        <p>Um abraço,<br>Sara Reinhardt</p>
      `,
      attachments: [
        {
          filename: 'Plano_de_Estudo_de_IAs_Sara.pdf',
          content: pdfBuffer.toString('base64'),
        },
      ],
    });

    console.log(`E-book enviado com sucesso para ${buyerEmail} (pagamento ${paymentId})`);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Erro no webhook:', err);
    return { statusCode: 500, body: 'error' };
  }
};
