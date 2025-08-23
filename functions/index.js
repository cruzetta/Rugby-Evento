// Firebase Cloud Functions
const functions = require("firebase-functions");
const admin = require("firebase-admin");
// Importa o SDK oficial do Mercado Pago
const mercadopago = require("mercadopago");

admin.initializeApp();

// ===================================================================================
// Usando o método de configuração antigo (functions.config) igual ao seu projeto "platamais"
// que já funciona, para manter a consistência.
// ===================================================================================
const accessToken = functions.config().mercadopago.token;

// Configura o SDK do Mercado Pago com o seu Access Token
if (accessToken) {
  mercadopago.configure({
    access_token: accessToken,
  });
}

exports.createPaymentPreference = functions
  .region("southamerica-east1") // <-- MANTÉM A CORREÇÃO MAIS IMPORTANTE (rodar no Brasil)
  .runWith({ node: "18" })
  .https.onCall(async (data, context) => {
    
    // Verificação se o Access Token foi configurado via comando
    if (!accessToken) {
      console.error("ERRO CRÍTICO: Access Token do Mercado Pago não configurado. Execute o comando: firebase functions:config:set mercadopago.token='SEU_TOKEN'");
      throw new functions.https.HttpsError(
        "internal",
        "A configuração de pagamento do servidor está incompleta."
      );
    }

    // Verificando se os dados essenciais vieram do site
    if (!data.price || !data.title || !data.payerName) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A função precisa receber 'price', 'title', e 'payerName' do site."
      );
    }

    // Objeto de preferência, estruturado para o SDK do Mercado Pago
    const preference = {
      items: [
        {
          title: data.title,
          description: "Kit Lenda para o evento Rugby Legends",
          quantity: 1,
          currency_id: "BRL",
          unit_price: Number(data.price),
        },
      ],
      payer: {
        name: data.payerName,
        email: "pagamento@rugbylegends.com", // E-mail genérico
      },
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
      // Usa o SDK para criar a preferência de pagamento
      const response = await mercadopago.preferences.create(preference);
      
      // Retorna o ID da preferência para o frontend renderizar o QR Code
      return { preferenceId: response.body.id };

    } catch (error) {
      console.error("Erro ao criar preferência no Mercado Pago:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Não foi possível criar a preferência de pagamento. Verifique os logs."
      );
    }
  });
