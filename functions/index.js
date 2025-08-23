// Firebase Cloud Functions
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();

// ===================================================================================
// MUDANÇA IMPORTANTE: Migração do functions.config() para variáveis de ambiente.
// O Access Token agora é lido de forma segura do ambiente da função (process.env).
// Para deploy, o Firebase CLI usará o arquivo .env.<project_id>.
// ===================================================================================
const accessToken = process.env.MERCADOPAGO_TOKEN;

exports.createPaymentPreference = functions
  .region("southamerica-east1")
  .runWith({ node: "18" })
  .https.onCall(async (data, context) => {
    // Verificação inicial se o Access Token foi carregado no ambiente da nuvem
    if (!accessToken) {
      console.error("ERRO CRÍTICO: MERCADOPAGO_TOKEN não foi encontrado nas variáveis de ambiente da função. Verifique se o deploy incluiu o arquivo .env.<project_id>.");
      throw new functions.https.HttpsError(
        "internal",
        "A configuração de pagamento do servidor está incompleta."
      );
    }

    // Verificando se os dados essenciais foram recebidos do site
    if (!data.price || !data.title) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A função precisa receber 'price' e 'title' do site."
      );
    }

    const kitPrice = data.price;
    const kitTitle = data.title;
    const payerName = data.payerName;

    const item = {
      title: kitTitle,
      description: "Kit Lenda para o evento Rugby Legends",
      quantity: 1,
      currency_id: "BRL",
      unit_price: kitPrice,
    };

    const payer = {
      name: payerName,
      email: "pagamento@rugbylegends.com", // E-mail genérico
    };

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
    };

    try {
      const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.json();
        // Log mais detalhado do erro vindo do Mercado Pago
        console.error("Erro retornado pela API do Mercado Pago:", JSON.stringify(errorBody, null, 2));
        throw new functions.https.HttpsError(
          "internal",
          `Falha ao criar preferência de pagamento: ${errorBody.message || 'Verifique os logs da função.'}`
        );
      }

      const preference = await response.json();
      return { preferenceId: preference.id };

    } catch (error) {
      // Log detalhado de erros de rede ou outros problemas
      console.error("Erro catastrófico ao tentar se comunicar com a API do Mercado Pago:", error);
      if (error instanceof functions.https.HttpsError) {
        throw error; // Re-lança o erro que já formatamos acima
      }
      throw new functions.https.HttpsError(
        "unknown",
        "Ocorreu um erro inesperado no servidor. Verifique os logs da função para mais detalhes."
      );
    }
  });
