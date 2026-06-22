module.exports = {
  // ── MENÚ PRINCIPAL ──────────────────────────
  welcome: () =>
    `👋 *¡Hola!* Bienvenido al bot de delivery.

Escribí *"pedir"* para hacer un pedido nuevo.
Escribí *"cancelar"* para cancelar un pedido.
Escribí *"estado"* para saber cómo va tu pedido.`,

  invalidOption: () =>
    `😅 No entendí. Escribí *"pedir"*, *"cancelar"* o *"estado"*.`,

  // ── FLUJO DE PEDIDO ────────────────────────
  askOrder: () =>
    `😊 ¡Perfecto! Decime *qué querés pedir*.

Por ejemplo: "2 hamburguesas con papas y coca"
Si tenés algún número de referencia del pedido, incluilo también.`,

  askLocation: (details) =>
    `😊 Anoté: *"${details}"*

Ahora compartime tu *ubicación* 📍 para asignarte un repartidor.
En WhatsApp: tocá el clip 📎 > Ubicación > Enviar ubicación actual`,

  orderConfirmed: (orderId, details, link) =>
    `✅ *Pedido #${orderId} confirmado!* 🎉

📋 *Detalle:* ${details}
📍 *Ubicación:* ${link}

En breve te asignamos un repartidor. Te aviso cuando haya novedades.`,

  // ── ASIGNACIÓN ─────────────────────────────
  orderAssigned: (orderId, workerName) =>
    `🛵 *Pedido #${orderId} asignado!*
Tu repartidor *${workerName}* está yendo a buscarte.

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

  cancelError: (status) =>
    `No podés cancelar un pedido en estado "${status}". Contactate con tu repartidor.`,

  // ── ESTADO ─────────────────────────────────
  statusInfo: (orders) => {
    if (orders.length === 0)
      return 'No tenés pedidos. Escribí *"pedir"* para hacer uno nuevo. 😊';
    return (
      '📋 *Tus pedidos:*\n\n' +
      orders
        .map((o) => {
          const icon =
            o.status === 'pendiente'
              ? '⏳'
              : o.status === 'asignado'
                ? '🛵'
                : o.status === 'cancelado'
                  ? '❌'
                  : '✅';
          return `${icon} *Pedido #${o.id}* - ${o.status}\n   ${o.details.substring(0, 50)}${o.details.length > 50 ? '...' : ''}${o.workerName ? `\n   Repartidor: ${o.workerName}` : ''}`;
        })
        .join('\n\n')
    );
  },

  // ── GRUPO DE WORKERS ───────────────────────
  newOrderGroup: (orderId, details, link, phone) =>
    `🆕 *NUEVO PEDIDO #${orderId}*

📋 *Detalle:* ${details}
📍 *Ubicación:* ${link}
📱 *Cliente:* ${phone}
💬 *Contactar:* https://wa.me/${phone}

Escribí "lo tomo" para asignarte este pedido.`,

  orderAssignedGroup: (orderId, workerName) =>
    `✅ *Pedido #${orderId} asignado a ${workerName}*`,

  orderAssignedGroupWithPhone: (orderId, workerName, phone) =>
    `✅ *Pedido #${orderId} asignado a ${workerName}*

💬 *Contactar cliente:* https://wa.me/${phone}`,

  orderCancelledGroup: (orderId, workerName) =>
    `❌ *PEDIDO #${orderId} CANCELADO por el cliente*${workerName ? `\n${workerName} quedó libre ✅` : ''}`,

  // ── WORKERS ────────────────────────────────
  noPendingOrders: () => `No hay pedidos pendientes.`,

  multiplePending: (ids) =>
    `Hay varios pedidos pendientes. Decí cuál querés: ${ids.map((id) => `#${id}`).join(', ')}`,

  needRegistration: () =>
    `No estás registrado como worker. Escribí *"me llamo [tu nombre]"* para registrarte.`,

  registered: (name) => `✅ Registrado como *${name}*! Ya podés tomar pedidos.`,
};
