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
const PRECO = 29.90; // ajustar depois de confirmar o valor final com a Sara
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
    try {
      const body = JSON.parse(event.body || '{}');
      payerEmail = body.email;
    } catch (_) {
      // sem e-mail informado, segue sem preencher — o Mercado Pago pede na tela
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
        payer: payerEmail ? { email: payerEmail } : undefined,
        back_urls: {
          success: `${SITE_URL}/sucesso.html`,
          failure: `${SITE_URL}/`,
          pending: `${SITE_URL}/pendente.html`,
        },
        auto_return: 'approved',
        notification_url: `${SITE_URL}/.netlify/functions/mp-webhook`,
        metadata: { produto: 'plano-ias-sara' },
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
