// netlify/functions/create-preference.js
//
// Cria uma "preferência de pagamento" no Mercado Pago (Checkout Pro).
// O front-end chama essa função quando a pessoa clica em "Comprar agora",
// e recebe de volta um link (init_point) para redirecionar o comprador.
//
// Variável de ambiente necessária (configurar no painel do Netlify, NUNCA no código):
//   MP_ACCESS_TOKEN — o Access Token de produção da conta Mercado Pago da Sara

const { MercadoPagoConfig, Preference } = require('mercadopago');

const SITE_URL = process.env.SITE_URL || 'https://e-book-sara.netlify.app';
const PRECO = 49.90; // ajustar depois de confirmar o valor final com a Sara
const NOME_PRODUTO = 'Plano de Estudo de IAs para Professores e Pesquisadores';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'MP_ACCESS_TOKEN não configurado no ambiente' }),
    };
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    let payerEmail;
    let payerNome;
    try {
      const body = JSON.parse(event.body || '{}');
      payerEmail = String(body.email || '').trim().toLowerCase();
      payerNome = String(body.nome || '').trim();
    } catch (_) {
      // corpo inválido — tratado logo abaixo
    }

    // O e-mail é obrigatório: é para ele que o material será enviado
    if (!payerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payerEmail)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'E-mail inválido ou não informado' }),
      };
    }

    const result = await preference.create({
      body: {
        items: [
          {
            title: NOME_PRODUTO,
            quantity: 1,
            unit_price: PRECO,
            currency_id: 'BRL',
          },
        ],
        payer: { email: payerEmail, name: payerNome || undefined },
        back_urls: {
          success: `${SITE_URL}/sucesso.html`,
          failure: `${SITE_URL}/`,
          pending: `${SITE_URL}/pendente.html`,
        },
        auto_return: 'approved',
        notification_url: `${SITE_URL}/.netlify/functions/mp-webhook`,
        // O e-mail digitado no site fica gravado no pagamento e é usado pelo webhook
        metadata: { produto: 'plano-ias-sara', email: payerEmail, nome: payerNome },
      },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ init_point: result.init_point }),
    };
  } catch (err) {
    console.error('Erro ao criar preferência:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro ao criar pagamento' }),
    };
  }
};
