function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = {
  askLocation: (details) => pick([
    `😊 Anoté: *"${details}"*\n\nAhora compartime tu *ubicación* 📍 para asignarte un repartidor.\nEn WhatsApp: tocá el clip 📎 > Ubicación > Enviar ubicación actual`,
    `✅ *"${details}"* anotado!\n\nPasame tu *ubicación* 📍 así te asigno un repartidor.\nClip 📎 > Ubicación > Enviar ubicación actual`,
    `Perfecto, anoté *"${details}"* 👍\n\nAhora necesito tu *ubicación* 📍\nClip 📎 > Ubicación > Enviar ubicación actual`,
  ]),

  orderConfirmed: (orderId, details, link) => pick([
    `✅ *Pedido #${orderId} confirmado!* 🎉\n\n📋 *Detalle:* ${details}\n📍 *Ubicación:* ${link}\n\nEn breve te asignamos un repartidor. Te aviso cuando haya novedades.\n\n💡 *Tip:* Podés escribir *"agregar [algo]"* para añadir más cosas al pedido.`,
    `🎉 *Pedido #${orderId} listo!*\n\n📋 ${details}\n📍 ${link}\n\nYa te estamos buscando repartidor. Te mantengo al tanto 😊\n\n💡 Escribí *"agregar [algo]"* si querés sumar algo más.`,
    `✅ *#${orderId} confirmado!*\n\n📋 *Detalle:* ${details}\n📍 *Ubicación:* ${link}\n\nEn un rato te asignamos repartidor. Cualquier cosa te aviso!\n\n💡 Podés agregar más con *"agregar [algo]"*`,
  ]),

  // ── ASIGNACIÓN ─────────────────────────────
  orderAssigned: (orderId, workerName, contactLine) => pick([
    `🛵 *Pedido #${orderId} asignado!*\nTu repartidor *${workerName}* está yendo a buscarte.\n${contactLine}\n\nTe avisamos cuando llegue. Gracias por tu paciencia 😊`,
    `✅ *#${orderId} tiene repartidor!*\n*${workerName}* va camino a tu pedido.\n${contactLine}\n\nTe aviso cuando esté cerca. Gracias por esperar! 🙏`,
    `🛵 *#${orderId} asignado a ${workerName}!*\n${contactLine}\n\nYa salió a buscar tu pedido. Te mantenemos informado 😊`,
  ]),

  // ── CANCELACIÓN ────────────────────────────
  noActiveOrders: () => pick([
    `No tenés pedidos activos para cancelar. 😊\nEscribí *"pedir"* si querés hacer uno nuevo.`,
    `No encontré pedidos activos 😊\nHacé uno nuevo escribiendo *"pedir"*`,
    `No hay pedidos para cancelar. Escribí *"pedir"* para hacer uno nuevo!`,
  ]),

  askCancelOrder: (orders) =>
    `Tenés estos pedidos activos:\n${orders
      .map(
        (o) =>
          `#${o.id} - ${o.details.substring(0, 40)}${o.details.length > 40 ? '...' : ''} (${o.status})`
      )
      .join('\n')}

Decime el *número* del que querés cancelar.`,

  orderCancelled: (orderId) => pick([
    `❌ *Pedido #${orderId} cancelado.*\n\nSi querés hacer otro pedido, escribí *"pedir"*. 😊`,
    `❌ *#${orderId} cancelado!*\n\nCuando quieras podés hacer otro pedido con *"pedir"* 😊`,
    `Listo, *pedido #${orderId} cancelado* ✅\n\nEscribí *"pedir"* para hacer uno nuevo cuando quieras.`,
  ]),

  // ── GRUPO DE WORKERS ───────────────────────
  newOrderGroup: (orderId, details, link, phone, contactLink) => pick([
    `🆕 *NUEVO PEDIDO #${orderId}*\n\n📋 *Detalle:* ${details}\n📍 *Ubicación:* ${link}\n📱 *Cliente:* ${phone}\n${contactLink}\n\nEscribí "lo tomo" para asignarte este pedido.`,
    `🔔 *Pedido #${orderId} disponible!*\n\n📋 ${details}\n📍 ${link}\n📱 ${phone}\n${contactLink}\n\nDecí "lo tomo" para tomarlo.`,
    `📦 *#${orderId} nuevo!*\n\n📋 *Detalle:* ${details}\n📍 *Mapa:* ${link}\n📱 *Cliente:* ${phone}\n${contactLink}\n\nEscribí "lo tomo" o el número para tomarlo.`,
  ]),

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
  ratingReceived: (orderId, rating) => pick([
    `⭐ *Calificación #${orderId}:* ${'⭐'.repeat(Math.min(rating, 5))} (${rating}/10)\n\nGracias por tu opinión 😊`,
    `✅ *#${orderId} calificado con ${rating}/10*\n\nGracias por tomarte el tiempo! 🙏`,
    `⭐ *${rating}/10 para el pedido #${orderId}*\n\nGracias por la calificación! 😊`,
  ]),

  askVoiceOrder: () =>
    `🎤 Para hacer tu pedido en audio, graba un mensaje y envíalo aquí. El bot lo transcribirá automáticamente y te preguntará por tu ubicación para continuar.`,
};
