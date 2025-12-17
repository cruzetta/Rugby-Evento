/**
 * Firebase Cloud Functions para o projeto "Rugby Legends".
 * Lógica de pagamento com Cartão de Crédito e PIX para a compra de Kits.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {MercadoPagoConfig, Payment} = require("mercadopago");

admin.initializeApp();
const db = admin.firestore();

// Define o segredo para o Access Token do Mercado Pago
const mercadoPagoAccessToken = defineSecret("MERCADO_PAGO_ACCESS_TOKEN_RUGBY");

/**
 * Cria um pagamento com Cartão de Crédito para a compra de kits.
 */
exports.createKitCardPayment = onCall({
  secrets: [mercadoPagoAccessToken],
  region: "us-central1",
}, async (request) => {
  /* eslint-disable camelcase */
  // ALTERAÇÃO 1: Adicionado 'orderId' para saber qual documento atualizar.
  const {token, installments, payment_method_id, issuer_id, payer, order, orderId} =
    request.data;
  const {buyerName, totalPrice} = order;

  if (!token || !installments || !payment_method_id || !payer || !order || !orderId) {
    throw new HttpsError(
        "invalid-argument",
        "Dados do pagamento, do pedido ou o ID do pedido estão incompletos.",
    );
  }
  if (!totalPrice || totalPrice <= 0) {
    throw new HttpsError(
        "invalid-argument",
        "O valor total do pedido é inválido.",
    );
  }
  /* eslint-enable camelcase */

  const client = new MercadoPagoConfig({
    accessToken: mercadoPagoAccessToken.value(),
  });
  const payment = new Payment(client);

  const nameParts = buyerName.split(" ");
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ") || firstName;

  const paymentData = {
    body: {
      transaction_amount: Number(totalPrice),
      description: `Kit(s) Rugby Legends - ${buyerName}`,
      token: token,
      installments: Number(installments),
      /* eslint-disable camelcase */
      payment_method_id: payment_method_id,
      issuer_id: String(issuer_id),
      /* eslint-enable camelcase */
      payer: {
        email: payer.email,
        first_name: firstName,
        last_name: lastName,
      },
      notification_url: `https://us-central1-${process.env.GCLOUD_PROJECT}` +
        ".cloudfunctions.net/rugbyMercadoPagoWebhook",
    },
  };

  try {
    const result = await payment.create(paymentData);
    const paymentId = result.id;

    if (!paymentId) {
      throw new Error("ID do pagamento não foi retornado pelo Mercado Pago.");
    }

    // ALTERAÇÃO 2: Em vez de criar um novo doc, atualiza o existente.
    const orderRef = db.collection("inscriptions").doc(orderId);
    await orderRef.update({
      paymentId: paymentId,
      paymentStatus: result.status,
      /* eslint-disable camelcase */
      paymentMethod: payment_method_id,
      /* eslint-enable camelcase */
      installments: Number(installments),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // FIM DA ALTERAÇÃO 2

    return {
      status: result.status,
      /* eslint-disable camelcase */
      status_detail: result.status_detail,
      /* eslint-enable camelcase */
      id: paymentId,
    };
  } catch (error) {
    console.error("Erro ao criar pagamento com cartão:", error.cause || error);
    const err = error.cause && error.cause.error && error.cause.error.message;
    const errorMessage = err || "Não foi possível processar o pagamento.";
    throw new HttpsError("internal", errorMessage);
  }
});

/**
 * Cria um pagamento com PIX para a compra de kits.
 */
exports.createKitPixPayment = onCall({
  secrets: [mercadoPagoAccessToken],
  region: "us-central1",
}, async (request) => {
  // ALTERAÇÃO 3: Adicionado 'orderId' para saber qual documento atualizar.
  const {order, orderId} = request.data;
  const {buyerName, buyerEmail, buyerCPF, totalPrice} = order;

  if (!order || !buyerEmail || !buyerCPF || !orderId) {
    throw new HttpsError("invalid-argument",
        "Dados do pedido, e-mail, CPF ou ID do pedido estão incompletos.");
  }
  if (!totalPrice || totalPrice <= 0) {
    throw new HttpsError(
        "invalid-argument", "O valor total do pedido é inválido.");
  }

  const client = new MercadoPagoConfig({
    accessToken: mercadoPagoAccessToken.value(),
  });
  const payment = new Payment(client);

  const paymentData = {
    body: {
      transaction_amount: Number(totalPrice),
      description: `Kit(s) Rugby Legends - ${buyerName}`,
      payment_method_id: "pix",
      payer: {
        email: buyerEmail,
        identification: {
          type: "CPF",
          number: buyerCPF.replace(/\D/g, ""),
        },
      },
      notification_url: `https://us-central1-${process.env.GCLOUD_PROJECT}` +
        ".cloudfunctions.net/rugbyMercadoPagoWebhook",
    },
  };

  try {
    const result = await payment.create(paymentData);
    const paymentId = result.id;

    if (!paymentId || !result.point_of_interaction) {
      throw new Error("Dados do PIX não retornados pelo Mercado Pago.");
    }

    // ALTERAÇÃO 4: Em vez de criar um novo doc, atualiza o existente.
    const orderRef = db.collection("inscriptions").doc(orderId);
    await orderRef.update({
      paymentId: paymentId,
      paymentStatus: "pending", // PIX começa como pendente
      paymentMethod: "pix",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // FIM DA ALTERAÇÃO 4

    return {
      id: paymentId,
      status: result.status,
      /* eslint-disable camelcase */
      qr_code: result.point_of_interaction.transaction_data.qr_code,
      qr_code_base64:
        result.point_of_interaction.transaction_data.qr_code_base64,
      /* eslint-enable camelcase */
    };
  } catch (error) {
    console.error(
        "DETALHES COMPLETOS DO ERRO MERCADO PAGO:",
        JSON.stringify(error, null, 2),
    );

    const apiError = (error.cause && error.cause.error) || error.cause || {};
    const apiMessage = apiError.message || "Erro desconhecido na API do MP.";
    console.error(`Mensagem da API do Mercado Pago: ${apiMessage}`);

    throw new HttpsError("internal",
        "Não foi possível gerar o PIX. Verifique os logs da função.");
  }
});


/**
 * Webhook para receber notificações do Mercado Pago.
 */
exports.rugbyMercadoPagoWebhook = onRequest({
  secrets: [mercadoPagoAccessToken],
  region: "us-central1",
}, async (req, res) => {
  console.log("Webhook Rugby Legends recebido:", req.body);
  const notification = req.body;
  const paymentId = notification && notification.data ?
    notification.data.id : null;
  const notificationType = notification ? notification.type : null;

  if (notificationType === "payment" && paymentId) {
    try {
      const client = new MercadoPagoConfig(
          {accessToken: mercadoPagoAccessToken.value()},
      );
      const payment = new Payment(client);
      const paymentInfo = await payment.get({id: paymentId});

      // ALTERAÇÃO 5: Busca pelo documento usando o 'paymentId' em vez do ID do doc.
      const inscriptionsRef = db.collection("inscriptions");
      const querySnapshot = await inscriptionsRef.where("paymentId", "==", Number(paymentId)).get();

      if (querySnapshot.empty) {
        console.log(`Webhook: Nenhum pedido encontrado com paymentId: ${paymentId}`);
        return res.status(200).send("Pedido não encontrado.");
      }

      querySnapshot.forEach(async (doc) => {
        const orderRef = doc.ref;
        const newStatus = paymentInfo.status; // approved, rejected, cancelled

        if (newStatus === "approved" || newStatus === "rejected" || newStatus === "cancelled") {
          await orderRef.update({
            paymentStatus: newStatus,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`Webhook: Pedido ${doc.id} (paymentId: ${paymentId}) atualizado para '${newStatus}'.`);
        }
      });
      // FIM DA ALTERAÇÃO 5

    } catch (error) {
      console.error("Erro no webhook Rugby Legends:", error);
      return res.status(500).send("Erro ao processar notificação.");
    }
  }
  res.status(200).send("Notificação recebida.");
});
