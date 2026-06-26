module.exports = {
  askLocation: (details) =>
    `😊 Anoté: *"${details}"*

Ahora compartime tu *ubicación* 📍 para asignarte un repartidor.
En WhatsApp: tocá el clip 📎 > Ubicación > Enviar ubicación actual`,

  orderConfirmed: (orderId, details, link) =>
    `✅ *Pedido #${orderId} confirmado!* 🎉

📋 *Detalle:* ${details}
📍 *Ubicación:* ${link}

En breve te asignamos un repartidor. Te aviso cuando haya novedades.

💡 *Tip:* Podés escribir *"agregar [algo]"* para añadir más cosas al pedido.`,

  // ── ASIGNACIÓN ─────────────────────────────
  orderAssigned: (orderId, workerName, contactLine) =>
    `🛵 *Pedido #${orderId} asignado!*
Tu repartidor *${workerName}* está yendo a buscarte.
${contactLine}

Te avisamos cuando llegue. Gracias por tu paciencia 😊`,

  // ── CANCELACIÓN ────────────────────────────
  noActiveOrders: () =>
    `No tenés pedidos activos para cancelar. 😊
Escribí *"pedir"* si querés hacer uno nuevo.`,

  askCancelOrder: (orders) =>
    `Tenés estos pedidos activos:\n${orders
      .map(
        (o) =>
          `#${o.id} - ${o.details.substring(0, 40)}${o.details.length > 40 ? '...' : ''} (${o.status})`
      )
      .join('\n')}

Decime el *número* del que querés cancelar.`,

  orderCancelled: (orderId) =>
    `❌ *Pedido #${orderId} cancelado.*

Si querés hacer otro pedido, escribí *"pedir"*. 😊`,

  // ── GRUPO DE WORKERS ───────────────────────
  newOrderGroup: (orderId, details, link, phone, contactLink) =>
    `🆕 *NUEVO PEDIDO #${orderId}*

📋 *Detalle:* ${details}
📍 *Ubicación:* ${link}
📱 *Cliente:* ${phone}
${contactLink}

Escribí "lo tomo" para asignarte este pedido.`,

  orderAssignedGroup: (orderId, workerName) =>
    `✅ *Pedido #${orderId} asignado a ${workerName}*`,

  orderAssignedGroupWithPhone: (orderId, workerName, phone, contactLink) =>
    `✅ *Pedido #${orderId} asignado a ${workerName}*

💬 *Contactar cliente:* ${contactLink}`,

  orderCancelledGroup: (orderId, workerName) =>
    `❌ *PEDIDO #${orderId} CANCELADO por el cliente*${workerName ? `\n${workerName} quedó libre ✅` : ''}`,

  // ── WORKERS ────────────────────────────────
  noPendingOrders: () => `No hay pedidos pendientes.`,

  multiplePending: (ids) =>
    `Hay varios pedidos pendientes. Decí cuál querés: ${ids.map((id) => `#${id}`).join(', ')}`,

  needRegistration: () =>
    `No estás registrado como worker. Escribí *"me llamo [tu nombre]"* para registrarte.`,

  registered: (name) => `✅ Registrado como *${name}*! Ya podés tomar pedidos.`,

  // ── CALIFICACIÓN ────────────────────────────
  ratingReceived: (orderId, rating) => `⭐ *Calificación #${orderId}:* ${'⭐'.repeat(Math.min(rating, 5))} (${rating}/10)

Gracias por tu opinión 😊`,
};

// ── MANDAR AUDIO ─────────────────────────────
  askVoiceOrder: () =>
    `🎤 Para hacer tu pedido en audio, graba un mensaje y envíalo aquí. El bot lo transcribirá automáticamente y te preguntará por tu ubicación para continuar.`;
