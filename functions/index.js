// Firebase Cloud Functions
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const mercadopago = require("mercadopago");
// IMPORTANTE: Adiciona o pacote CORS para permitir a conexão do seu site
const cors = require("cors")({ origin: true });

admin.initializeApp();

const accessToken = functions.config().mercadopago.token;

if (accessToken) {
  mercadopago.configure({
    access_token: accessToken,
  });
}

// ===================================================================================
// CORREÇÃO FINAL: A função agora usa .onRequest e o middleware `cors`.
// Isso autoriza o seu site (encontrorugbylegends.web.app) a se comunicar com a função.
// ===================================================================================
exports.createPaymentPreference = functions
  .region("southamerica-east1")
  .runWith({ node: "18" })
  .https.onRequest((req, res) => {
    // O `cors` handler verifica a permissão antes de executar o resto do código.
    cors(req, res, async () => {
      
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      // Verifica se o Access Token está configurado
      if (!accessToken) {
        console.error("ERRO CRÍTICO: Access Token do Mercado Pago não configurado.");
        res.status(500).json({ error: { message: "A configuração de pagamento do servidor está incompleta." } });
        return;
      }

      const data = req.body.data;

      // Verificando se os dados essenciais vieram do site
      if (!data || !data.price || !data.title || !data.payerName) {
        console.error("Dados inválidos recebidos do site:", data);
        res.status(400).json({ error: { message: "Dados incompletos. A função precisa de 'price', 'title', e 'payerName'." } });
        return;
      }

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
          email: "pagamento@rugbylegends.com",
        },
        payment_methods: {
          excluded_payment_types: [{ id: "credit_card" }, { id: "debit_card" }, { id: "ticket" }, { id: "atm" }],
          installments: 1,
        },
      };

      try {
        const response = await mercadopago.preferences.create(preference);
        // Retorna a resposta com sucesso, dentro de um objeto `data`
        res.status(200).json({ data: { preferenceId: response.body.id } });
      } catch (error) {
        console.error("Erro ao criar preferência no Mercado Pago:", error);
        res.status(500).json({ error: { message: "Não foi possível criar a preferência de pagamento." }});
      }
    });
  });
