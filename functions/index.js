// Firebase Cloud Functions
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();

// ===================================================================================
// IMPORTANTE: Seu Access Token já foi configurado de forma segura com o comando
// firebase functions:config:set e está sendo lido pela linha abaixo.
// ===================================================================================
const accessToken = functions.config().mercadopago.token;

// Nossa função que será chamada pelo site
// A linha abaixo foi MODIFICADA para forçar o uso do Node.js 18
exports.createPaymentPreference = functions.runWith({ node: "18" }).https.onCall(async (data, context) => {
  // Verificando se os dados essenciais foram recebidos
  if (!data.price || !data.title) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "A função precisa receber 'price' e 'title'.",
    );
  }

  const kitPrice = data.price;
  const kitTitle = data.title;
  const payerName = data.payerName;

  // Objeto com os detalhes do produto
  const item = {
    title: kitTitle,
    description: "Kit Lenda para o evento Rugby Legends",
    quantity: 1,
    currency_id: "BRL",
    unit_price: kitPrice,
  };

  // Objeto com os dados do comprador
  const payer = {
    name: payerName,
    email: "pagamento@rugbylegends.com", // E-mail genérico
  };

  // Corpo da requisição para a API do Mercado Pago
  const body = {
    items: [item],
    payer: payer,
    payment_methods: {
      excluded_payment_types: [
        { id: "credit_card" },
        { id: "debit_card" },
        { id: "ticket" },
        { id: "atm" },
      ],
      installments: 1,
    },
    // Você pode adicionar uma URL de notificação aqui se precisar
    // notification_url: 'https://sua-outra-funcao.com/notificacao',
  };

  try {
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`, // Usando o token seguro!
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.json();
      console.error("Erro do Mercado Pago:", errorBody);
      throw new functions.https.HttpsError(
        "internal",
        "Falha ao criar preferência de pagamento.",
      );
    }

    const preference = await response.json();

    // Retornando apenas o ID da preferência para o site (frontend)
    return { preferenceId: preference.id };

  } catch (error) {
    console.error("Erro ao chamar a API do Mercado Pago:", error);
    throw new functions.https.HttpsError(
      "unknown",
      "Ocorreu um erro inesperado.",
    );
  }
});
