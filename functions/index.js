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
  const {token, installments, payment_method_id, issuer_id, payer, order} =
    request.data;
  const {buyerName, buyerCelular, buyerEmail, kits, totalPrice} = order;

  if (!token || !installments || !payment_method_id || !payer || !order) {
    throw new HttpsError(
        "invalid-argument",
        "Dados do pagamento ou do pedido estão incompletos.",
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
        first_name: payer.name.split(" ")[0],
        last_name: payer.name.split(" ").slice(1).join(" "),
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

    await db.collection("inscriptions").doc(String(paymentId)).set({
      buyerName: buyerName,
      buyerCelular: buyerCelular,
      buyerEmail: buyerEmail,
      kits: kits,
      totalPrice: Number(totalPrice),
      purchaseType: "kit_order",
      paymentId: paymentId,
      paymentStatus: result.status,
      /* eslint-disable camelcase */
      paymentMethod: payment_method_id,
      /* eslint-enable camelcase */
      installments: Number(installments),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

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
 * [CORRIGIDO] Adicionado o campo de CPF do comprador, obrigatório para PIX.
 */
exports.createKitPixPayment = onCall({
  secrets: [mercadoPagoAccessToken],
  region: "us-central1",
}, async (request) => {
  const {order} = request.data;
  // [CORREÇÃO] Recebe o CPF do comprador.
  const {buyerName, buyerCelular, buyerEmail, buyerCPF, kits, totalPrice} =
    order;

  // [CORREÇÃO] Valida se o CPF foi enviado.
  if (!order || !buyerEmail || !buyerCPF) {
    throw new HttpsError("invalid-argument",
        "Dados do pedido, e-mail ou CPF estão incompletos.");
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
        first_name: buyerName.split(" ")[0],
        last_name: buyerName.split(" ").slice(1).join(" "),
        // [CORREÇÃO] Adiciona o objeto de identificação com o CPF.
        identification: {
          type: "CPF",
          // Remove caracteres não numéricos
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

    await db.collection("inscriptions").doc(String(paymentId)).set({
      buyerName: buyerName,
      buyerCelular: buyerCelular,
      buyerEmail: buyerEmail,
      buyerCPF: buyerCPF, // Opcional: Salva o CPF para referência
      kits: kits,
      totalPrice: Number(totalPrice),
      purchaseType: "kit_order",
      paymentId: paymentId,
      paymentStatus: "pending", // PIX começa como pendente
      paymentMethod: "pix",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      id: paymentId,
      status: result.status,
      qr_code: result.point_of_interaction.transaction_data.qr_code,
      qr_code_base64:
        result.point_of_interaction.transaction_data.qr_code_base64,
    };
  } catch (error) {
    console.error("Erro ao criar pagamento PIX:", error.cause || error);
    const err = error.cause && error.cause.error && error.cause.error.message;
    const errorMessage = err || "Não foi possível gerar o PIX.";
    throw new HttpsError("internal", errorMessage);
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

      if (paymentInfo.status === "approved") {
        const orderRef = db.collection("inscriptions").doc(String(paymentId));
        await orderRef.update({
          paymentStatus: "approved",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`Webhook: Pedido ${paymentId} atualizado para 'approved'.`);
      } else if (
        paymentInfo.status === "rejected" || paymentInfo.status === "cancelled"
      ) {
        const orderRef = db.collection("inscriptions").doc(String(paymentId));
        await orderRef.update({
          paymentStatus: paymentInfo.status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const status = paymentInfo.status;
        const logMessage =
          `Webhook: Pedido ${paymentId} atualizado para '${status}'.`;
        console.log(logMessage);
      }
    } catch (error) {
      console.error("Erro no webhook Rugby Legends:", error);
      return res.status(500).send("Erro ao processar notificação.");
    }
  }
  res.status(200).send("Notificação recebida.");
});

