const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const { exec } = require('child_process');
const config = require('./config');
const db = require('./database');
const tmpl = require('./messages');
const ai = require('./ai');
const web = require('./server');

function isGroupConfigured() {
  return config.GRUPO_WORKERS_ID &&
    config.GRUPO_WORKERS_ID !== 'REEMPLAZA_CON_ID_DEL_GRUPO@g.us' &&
    config.GRUPO_WORKERS_ID.includes('@');
}

function isAiConfigured() {
  return (config.AI_PROVIDER === 'gemini' && config.GEMINI_API_KEY) ||
         (config.AI_PROVIDER === 'openai' && config.OPENAI_API_KEY);
}

// ── ESTADOS DE CONVERSACIÓN (en memoria) ─────
// phone -> { step: string, data: object }
const userStates = new Map();

function getState(phone) {
  return userStates.get(phone) || null;
}
function setState(phone, step, data = {}) {
  userStates.set(phone, { step, data, ts: Date.now() });
}
function clearState(phone) {
  userStates.delete(phone);
}

function addToHistory(phone, role, text) {
  const state = userStates.get(phone);
  if (!state) return;
  if (!state.history) state.history = [];
  state.history.push({ role, text, ts: Date.now() });
  if (state.history.length > 10) state.history = state.history.slice(-10);
}

function getHistory(phone) {
  const state = userStates.get(phone);
  return state?.history?.slice(-5) || [];
}

// Limpiar estados viejos cada 30 min
setInterval(() => {
  const now = Date.now();
  for (const [phone, state] of userStates) {
    if (now - state.ts > 30 * 60 * 1000) userStates.delete(phone);
  }
}, 60 * 1000);

// ── ANTI-BAN: delays realistas ───────────────
function randomDelay(min, max) {
  return new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
}

async function replyWithTyping(msg, text) {
  try {
    const chat = await msg.getChat();
    await chat.sendStateTyping();
    const typingTime = Math.min(text.length * 5 + 200, 800);
    await randomDelay(typingTime, typingTime + 300);
    await chat.clearState();
    return msg.reply(text);
  } catch {
    return msg.reply(text);
  }
}

async function sendWithTyping(phone, text) {
  try {
    const chat = await client.getChatById(ensurePhoneFormat(phone));
    await chat.sendStateTyping();
    const typingTime = Math.min(text.length * 5 + 200, 800);
    await randomDelay(typingTime, typingTime + 300);
    await chat.clearState();
    return client.sendMessage(ensurePhoneFormat(phone), text);
  } catch {
    return client.sendMessage(ensurePhoneFormat(phone), text);
  }
}

// ── TIMEOUT PARA PEDIDOS SIN WORKER ─────────
setInterval(() => {
  const pending = db.getPendingOrders();
  const now = Date.now();
  const totalWorkers = db.getWorkerCount();
  const availableWorkers = db.getAvailableWorkerCount();

  for (const order of pending) {
    const createdAt = new Date(order.createdAt).getTime();
    const elapsed = (now - createdAt) / 1000 / 60;

    // Si no hay workers REGISTRADOS, avisar altiro
    if (totalWorkers === 0 && !order.notifiedTimeout) {
      safeSend(order.phone, `⚠️ *Pedido #${order.id}* creado.\nActualmente no hay repartidores registrados en el sistema. Contactate con la administración para coordinar la entrega.\nSi querés cancelar, escribí "cancelar".`)
        .catch(() => {});
      db.markOrderNotified(order.id);
      continue;
    }

    // Hay workers pero todos ocupados
    if (availableWorkers === 0 && elapsed > 5 && !order.notifiedTimeout && totalWorkers > 0) {
      safeSend(order.phone, `⏳ *Pedido #${order.id}* — todos los repartidores están ocupados.\nEn cuanto alguien se libere te asignamos uno. Gracias por la paciencia.`)
        .catch(() => {});
      db.markOrderNotified(order.id);
      continue;
    }

    // Hay workers disponibles pero nadie tomó el pedido → 15 min
    if (elapsed > 15 && !order.notifiedTimeout && totalWorkers > 0) {
      safeSend(order.phone, `⏳ *Pedido #${order.id}* aún no tiene repartidor.\nLos repartidores están disponibles pero nadie tomó tu pedido todavía. Si querés cancelar, escribí "cancelar".`)
        .catch(() => {});
      db.markOrderNotified(order.id);
      continue;
    }

    // Auto-cancelar a los 30 min
    if (elapsed > 30) {
      const result = db.cancelOrder(order.id, order.phone);
      if (result) {
        safeSend(order.phone, `❌ *Pedido #${order.id} cancelado automáticamente*\nNo se pudo asignar un repartidor. Disculpá las molestias.\nPodés hacer un nuevo pedido cuando quieras.`)
          .catch(() => {});
        if (isGroupConfigured()) {
          safeSend(config.GRUPO_WORKERS_ID, `❌ *Pedido #${order.id} cancelado automáticamente* por falta de repartidores.`)
            .catch(() => {});
        }
        web.notifyClients();
      }
    }
  }
}, 60 * 1000);

// ── TIMEOUT PARA "EN CAMINO" ─────────────────
setInterval(() => {
  const enCamino = db.getEnCaminoOrders();
  const now = Date.now();
  for (const order of enCamino) {
    const createdAt = new Date(order.createdAt).getTime();
    const elapsed = (now - createdAt) / 1000 / 60;
    if (elapsed > 60 && !order.notifiedTimeout) {
      if (isGroupConfigured()) {
        safeSend(config.GRUPO_WORKERS_ID, `⚠️ *Pedido #${order.id}* — ${order.workerName || 'El repartidor'} lleva más de 1 hora "en camino". ¿Cómo va eso?`)
          .catch(() => {});
      }
      safeSend(order.phone, `⏳ *Pedido #${order.id}* — ¿cómo va todo? Si tenés algún problema avisanos.`)
        .catch(() => {});
      db.markOrderNotified(order.id);
    }
  }
}, 60 * 1000);

// ── WHATSAPP CLIENT ──────────────────────────
const puppeteerOpts = {
  headless: config.PUPPETEER_HEADLESS,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-first-run',
    '--disable-infobars',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--disable-features=Translate',
    '--mute-audio',
    '--window-size=1280,720',
  ],
};
if (config.NAVEGADOR_PATH) {
  puppeteerOpts.executablePath = config.NAVEGADOR_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: puppeteerOpts,
});

client.on('qr', (qr) => {
  try {
    try { console.clear(); } catch {}
    qrcode.generate(qr, { small: true });
    console.log('\n📱 Escanea el QR con WhatsApp > Vincular dispositivo');

    const qrPath = path.join(__dirname, 'qr.png');
    QRCode.toFile(qrPath, qr, { width: 400, margin: 2 }, (err) => {
      if (err) {
        console.error('Error generando QR:', err.message);
        return;
      }
      console.log(`\n🖼️  QR guardado como imagen: ${qrPath}`);
      if (process.platform === 'win32') {
        exec(`start "" "${qrPath}"`);
      }
    });
  } catch (e) {
    console.error('Error en QR handler:', e.message);
  }
});

client.on('authenticated', () => console.log('✅ Autenticado'));
client.on('auth_failure', (err) => console.error('❌ Error de autenticación:', err));

client.on('ready', () => {
  console.log(`\n✅ Bot de delivery conectado como: ${client.info.pushname}`);
  console.log(`📱 Número: ${client.info.wid.user}`);
  console.log(`👥 Grupo workers configurado: ${config.GRUPO_WORKERS_ID !== 'REEMPLAZA_CON_ID_DEL_GRUPO@g.us' ? 'Sí' : 'NO - configurá config.js'}`);
  if (config.AI_PROVIDER === 'openai' && config.OPENAI_API_KEY) {
    console.log(`🤖 OpenAI: ✅ ACTIVADO (gpt-4o-mini - $0.15/1M tokens)`);
  } else if (config.AI_PROVIDER === 'gemini' && config.GEMINI_API_KEY) {
    console.log(`🤖 Gemini AI: ✅ ACTIVADO (gemini-2.0-flash - 20/día free, 2000/día con facturación)`);
  } else {
    console.log(`🤖 AI: ❌ Desactivado - configurá GEMINI_API_KEY u OPENAI_API_KEY en config.js`);
  }
  console.log(``);

  // Escuchar eventos del panel web
  web.onEvent((type, orderId) => {
    const order = db.getOrder(orderId);
    if (!order) return;

    if (type === 'camino') {
      safeSend(order.phone, `🛵 *Tu pedido #${orderId} está en camino!*\n${order.workerName} ya salió con tu pedido. 🎉`);
      if (isGroupConfigured()) {
        safeSend(config.GRUPO_WORKERS_ID, `🚚 *Pedido #${orderId} en camino* con ${order.workerName}`);
      }
    } else if (type === 'entregado') {
      safeSend(order.phone, `✅ *Pedido #${orderId} entregado!*\nGracias por elegirnos 😊\n\nSi querés calificar a ${order.workerName}, respondé con una nota del 1 al 10.`);
      if (isGroupConfigured()) {
        safeSend(config.GRUPO_WORKERS_ID, `✅ *Pedido #${orderId} entregado por ${order.workerName}*`);
      }
    }
  });

  // Mensaje de prueba al grupo
  if (isGroupConfigured()) {
    safeSend(config.GRUPO_WORKERS_ID, '🤖 *Bot de delivery conectado y operativo!*\nYa puedo recibir pedidos.')
      .then(() => console.log('✅ Mensaje de prueba enviado al grupo'))
      .catch(err => console.error('❌ Error al enviar mensaje de prueba al grupo:', err.message.substring(0, 100)));
  }
});

client.on('disconnected', (reason) => {
  console.log('❌ Desconectado:', reason);
});

// ── RUTEADOR PRINCIPAL ───────────────────────
client.on('message', async (message) => {
  try {
    const from = message.from;
    const body = (message.body || '').trim().substring(0, 50);
    const msgType = message.type;
    console.log(`📩 Msg de ${from}: tipo=${msgType} texto="${body}"`);

    if (message.timestamp && (Date.now() / 1000) - message.timestamp > 30) {
      console.log(`⏭️ Msg ignorado (timestamp viejo): ${message.timestamp}`);
      return;
    }

    const chat = await message.getChat();
    if (chat.isGroup) return handleGroupMessage(message);
    await handleClientMessage(message);
  } catch (err) {
    console.error('❌ Error procesando mensaje:', err.message.substring(0, 200));
    console.error(err.stack?.substring(0, 300));
  }
});

// ── AYUDANTES ─────────────────────────────────
function mapsLink(lat, lng) {
  return `https://maps.google.com/maps?q=${lat},${lng}`;
}

async function formatPhone(phone) {
  return await getDisplayPhone(phone);
}

async function getRealPhone(message) {
  return message.from;
}

// Obtener número visible para wa.me
async function getDisplayPhone(phone) {
  try {
    const raw = phone.replace(/@.*$/, '').replace(/\D/g, '');
    if (!raw.startsWith('22') && raw.length >= 10) return raw;
    try {
      const contact = await client.getContactById(phone);
      const n = contact.number || '';
      if (n && n.length >= 10 && !n.startsWith('22')) return n;
    } catch {}
    return raw;
  } catch {
    return phone.replace(/@.*$/, '').replace(/\D/g, '');
  }
}

function ensurePhoneFormat(phone) {
  if (!phone) return phone;
  if (phone.includes('@')) return phone;
  return phone + '@c.us';
}

function phoneForLink(phone) {
  if (!phone) return '';
  return phone.replace(/@.*$/, '').replace(/\D/g, '');
}

function safeSend(phone, text) {
  return client.sendMessage(ensurePhoneFormat(phone), text).catch(e => {
    console.error('Error enviando a', phone, e.message.substring(0, 80));
  });
}

async function getWorkerDisplayName(phone) {
  const worker = db.getWorker(phone);
  if (worker && worker.name) return worker.name;
  try {
    const contact = await client.getContactById(phone);
    return contact.pushname || contact.name || contact.shortName || formatPhone(phone);
  } catch {
    return formatPhone(phone);
  }
}

async function getGroupName() {
  try {
    if (!config.GRUPO_WORKERS_ID || config.GRUPO_WORKERS_ID === 'REEMPLAZA_CON_ID_DEL_GRUPO@g.us') return null;
    const chat = await client.getChatById(config.GRUPO_WORKERS_ID);
    return chat.name;
  } catch {
    return null;
  }
}

// ── CLIENTE (MENSAJES DIRECTOS) ─────────────
async function handleClientMessage(msg) {
  if (msg.type !== 'chat' && msg.type !== 'location') return;
  if (msg.type === 'location') return handleLocation(msg, msg.from);

  const body = (msg.body || '').trim();
  if (!body) return;
  if (body.length > 100 && /^[A-Za-z0-9+/=]+$/.test(body)) return;

  const phone = msg.from;
  const lower = body.toLowerCase();
  const state = userStates.get(phone) || null;

  // ── CANCELAR ──
  if (/cancelar|cancelo|ya no|me arrepenti|anular|déjalo|no lo quiero/i.test(lower)) {
    return handleCancelRequest(msg, phone);
  }

  // ── MODIFICAR ──
  const mod = body.match(/^modificar\s+#?(\d+)\s+(.+)/i);
  if (mod) {
    const o = db.getOrder(parseInt(mod[1]));
    if (o && o.phone === phone && o.status === 'pendiente' && db.updateOrderDetails(o.id, phone, mod[2])) {
      await msg.reply(`📝 *Pedido #${o.id} actualizado*\n${mod[2]}`);
      if (isGroupConfigured()) safeSend(config.GRUPO_WORKERS_ID, `📝 Pedido #${o.id}: ${mod[2]}`);
      web.notifyClients();
    } else {
      await msg.reply('❌ No se pudo modificar. Solo pedidos pendientes.');
    }
    return;
  }

  // ── AGREGAR ──
  const add = body.match(/^(?:agreg[ai]r|pon[ei]le|sum[ai]r|m[áa]s)\s+(?:#?(\d+)\s+)?(.+)/i);
  if (add) {
    const id = add[1] ? parseInt(add[1]) : null;
    const item = add[2];
    const orders = id ? [db.getOrder(id)].filter(Boolean) : db.getActiveClientOrders(phone);
    const order = orders.find(o => o && o.phone === phone);
    if (order) {
      if (order.status === 'pendiente') {
        db.updateOrderDetails(order.id, phone, order.details + ' + ' + item);
        await msg.reply(`✅ Agregado: "${item}" al pedido #${order.id}`);
      } else if (order.status === 'asignado' || order.status === 'en_camino') {
        await msg.reply(`✅ Avisamos al repartidor que agregue "${item}"`);
        if (order.workerPhone) safeSend(order.workerPhone, `📝 Cliente agregó al #${order.id}: "${item}"`);
      } else {
        await msg.reply('❌ Pedido ya entregado o cancelado.');
      }
      if (isGroupConfigured()) safeSend(config.GRUPO_WORKERS_ID, `📝 Pedido #${order.id}: +${item}`);
      web.notifyClients();
    } else {
      await msg.reply('❌ No encontré ese pedido.');
    }
    return;
  }

  // ── ESTADO ──
  if (/^(estado|status)$/i.test(lower)) {
    const orders = db.getClientOrders(phone);
    return msg.reply(orders.length ? '📋 Tus pedidos:\n' + orders.map(o => `#${o.id} - ${o.status}${o.workerName ? ' ('+o.workerName+')' : ''}`).join('\n') : 'No tenés pedidos.');
  }

  if (state) {
    if (!state.history) state.history = [];
    state.history.push({ role: 'user', text: body, ts: Date.now() });
    if (state.history.length > 10) state.history = state.history.slice(-10);
  }

  // ── PEDIR / HOLA (solo sin estado activo) ──
  if (!state || !state.step) {
    if (/pedir|pedido|hola|buenas|menu|ayuda|empezar|quiero|quisiera|necesito|comprar/i.test(lower)) {
      const want = body.match(/^(?:quiero|quisiera|necesito|queria|me trae|me puede|me compra)\s+(.+)/i);
      if (want && want[1].length >= 3) {
        userStates.set(phone, { step: 'awaiting_location', data: { details: want[1] }, ts: Date.now() });
        return msg.reply(tmpl.askLocation(want[1]));
      }

      userStates.set(phone, { step: 'awaiting_order', data: {}, ts: Date.now() });

      if (isAiConfigured() && /hola|buenas|ayuda|empezar/i.test(lower)) {
        const history = (userStates.get(phone)?.history || []).slice(-4);
        const aiResp = await ai.generateResponse(body, { step: 'awaiting_order', history }).catch(() => null);
        if (aiResp) return msg.reply(aiResp);
      }
      return msg.reply(`👋 ¡Hola! ¿Qué se te antoja hoy? Decime y coordinamos 😊`);
    }
  }

  // ── CANCELAR (seleccionar número) ──
  if (state && state.step === 'awaiting_cancel_id') {
    const num = parseInt(lower);
    if (isNaN(num)) return msg.reply('Decime el número del pedido (ej: 1).');
    const res = db.cancelOrder(num, phone);
    if (!res) return msg.reply('No se pudo cancelar. ¿Existe ese pedido?');
    await msg.reply(tmpl.orderCancelled(num));
    if (isGroupConfigured()) {
      const o = db.getOrder(num);
      safeSend(config.GRUPO_WORKERS_ID, tmpl.orderCancelledGroup(num, o?.workerName || null));
      if (o?.workerPhone) safeSend(o.workerPhone, `❌ Pedido #${num} cancelado por el cliente.`);
    }
    web.notifyClients();
    userStates.delete(phone);
    return;
  }

  // ── ESPERANDO PEDIDO ──
  if (state && state.step === 'awaiting_order') {
    if (lower.length < 3) return msg.reply('Escribí qué querés pedir (min 3 caracteres).');
    userStates.set(phone, { step: 'awaiting_location', data: { details: body }, ts: Date.now() });
    return msg.reply(tmpl.askLocation(body));
  }

  // ── ESPERANDO UBICACIÓN ──
  if (state && state.step === 'awaiting_location') {
    return msg.reply('📍 Compartime tu ubicación. Clip 📎 > Ubicación > Enviar ubicación actual');
  }

  // ── DEFAULT ──
  if (state) userStates.delete(phone);

  if (isAiConfigured()) {
    const active = db.getActiveClientOrders(phone);
    const history = (state?.history || []).slice(-4);
    const aiResp = await ai.generateResponse(body, { hasActiveOrders: active.length > 0, history }).catch(() => null);
    if (aiResp) return msg.reply(aiResp);
  }
  return msg.reply(`😊 No entendí. Escribí *"pedir"*, *"cancelar"* o *"estado"*.`);
}

// ── MANEJAR UBICACIÓN ────────────────────────
async function handleLocation(msg, phone) {
  const state = getState(phone);
  if (!state || state.step !== 'awaiting_location' || !state.data.details) {
    return replyWithTyping(msg, 'No estaba esperando una ubicación. Escribí *"pedir"* para empezar.');
  }

  const loc = msg.location;
  const link = mapsLink(loc.latitude, loc.longitude);

  const orderId = db.createOrder({
    phone,
    details: state.data.details,
    link,
    lat: loc.latitude,
    lng: loc.longitude,
  });

  clearState(phone);
  await replyWithTyping(msg, tmpl.orderConfirmed(orderId, state.data.details, link));

  const displayPhone = await getDisplayPhone(phone);
  db.updateOrderDisplayPhone(orderId, displayPhone);

  if (isGroupConfigured()) {
    await sendWithTyping(
      config.GRUPO_WORKERS_ID,
      tmpl.newOrderGroup(orderId, state.data.details, link, displayPhone)
    );
  }

  web.notifyClients();
}

// ── CANCELAR PEDIDO ──────────────────────────
async function handleCancelRequest(msg, phone) {
  const active = db.getActiveClientOrders(phone);
  if (active.length === 0) {
    return replyWithTyping(msg, tmpl.noActiveOrders());
  }

  if (active.length === 1) {
    const order = active[0];
    const result = db.cancelOrder(order.id, phone);
    if (!result) return replyWithTyping(msg, 'No se pudo cancelar el pedido.');
    await replyWithTyping(msg, tmpl.orderCancelled(order.id));

    if (isGroupConfigured()) {
      await sendWithTyping(
        config.GRUPO_WORKERS_ID,
        tmpl.orderCancelledGroup(order.id, order.workerName || null)
      );

      if (order.workerPhone) {
        try {
          await safeSend(order.workerPhone, `❌ *Pedido #${order.id} cancelado por el cliente*\nYa no tenés que ir. Quedás libre para otro pedido.`);
        } catch (e) {
          console.error('Error notificando al worker:', e.message.substring(0, 80));
        }
      }
    }
    web.notifyClients();
    return;
  }

  setState(phone, 'awaiting_cancel_id');
  return replyWithTyping(msg, tmpl.askCancelOrder(active));
}

// ── GRUPO DE WORKERS ─────────────────────────
async function handleGroupMessage(msg) {
  const text = msg.body.trim();
  const lower = text.toLowerCase();
  const senderPhone = msg.author;

  if (!senderPhone) return;

  db.markWorkerAvailable(senderPhone);

  const liberarMatch = lower.match(/^liberar\s+(\d+)/);
  if (liberarMatch) {
    const orderId = parseInt(liberarMatch[1]);
    const ok = db.releaseOrder(orderId, senderPhone);
    if (ok) {
      const order = db.getOrder(orderId);
      const orderPhone = order ? order.phone : null;
      await replyWithTyping(msg, `🔄 *Pedido #${orderId} liberado*\nQueda disponible para otro worker.`);
      if (isGroupConfigured()) {
        await sendWithTyping(config.GRUPO_WORKERS_ID, `🔄 *Pedido #${orderId} liberado*\nEstá disponible de nuevo para tomar.`);
      }
      if (orderPhone) {
        try {
          await sendWithTyping(orderPhone, `🔄 *Pedido #${orderId}*\nEl repartidor lo liberó. En breve te asignamos otro.`);
        } catch (e) { console.error('Error:', e.message.substring(0, 80)); }
      }
      web.notifyClients();
    } else {
      await replyWithTyping(msg, `❌ No se pudo liberar el pedido #${orderId}. ¿No te pertenece o ya está entregado?`);
    }
    return;
  }

  if (lower === 'disponible' || lower === 'libre') {
    db.markWorkerAvailable(senderPhone);
    await replyWithTyping(msg, '✅ Estás marcado como *disponible* para tomar pedidos.');
    return;
  }

  if (lower === '!id') {
    const chat = await msg.getChat();
    await replyWithTyping(msg, `🆔 ID de este grupo:\n\`${chat.id._serialized}\`\n\nCopialo en config.js como:\n\`GRUPO_WORKERS_ID: '${chat.id._serialized}',\``);
    return;
  }

  if (lower === '!test') {
    await replyWithTyping(msg, `✅ Bot funcionando\n📱 Conectado como: ${client.info.pushname}\n👥 Este grupo: ${(await msg.getChat()).id._serialized}\n🤖 AI: ${isAiConfigured() ? 'Sí' : 'No'}`);
    return;
  }

  const nameMatch = lower.match(/^me\s*llamo\s+(.+)/);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    db.registerWorker(senderPhone, name);
    await replyWithTyping(msg, tmpl.registered(name));
    return;
  }

  let orderId = null;

  const tomoWithId = lower.match(/^(?:yo\s+)?(?:tomo|agarro)\s+(?:el\s+)?#?(\d+)/);
  const justNumber = lower.match(/^#?(\d+)$/);
  const tomoSimple = lower.match(/^(lo\s+tomo|yo\s+(lo\s+)?tomo|yo\s+agarro|lo\s+agarro|tomado)$/);

  if (tomoWithId) {
    orderId = parseInt(tomoWithId[1]);
  } else if (justNumber) {
    orderId = parseInt(justNumber[1]);
  } else if (tomoSimple) {
    const pending = db.getPendingOrders();
    if (pending.length === 0) {
      return replyWithTyping(msg, tmpl.noPendingOrders());
    }
    if (pending.length === 1) {
      orderId = pending[0].id;
    } else {
      return replyWithTyping(msg, tmpl.multiplePending(pending.map((o) => o.id)));
    }
  }

  if (!orderId) return;

  const existingWorker = db.getWorker(senderPhone);
  if (!existingWorker) {
    return replyWithTyping(msg, tmpl.needRegistration());
  }

  const workerName = existingWorker.name;

  const ok = db.assignOrder(orderId, senderPhone, workerName);
  if (!ok) {
    return replyWithTyping(msg, `❌ No se pudo asignar el pedido #${orderId}. ¿Ya está asignado o cancelado?`);
  }

  await replyWithTyping(msg, tmpl.orderAssignedGroup(orderId, workerName));

  const orderForGroup = db.getOrder(orderId);
  if (orderForGroup && isGroupConfigured()) {
    await sendWithTyping(config.GRUPO_WORKERS_ID, tmpl.orderAssignedGroupWithPhone(orderId, workerName, orderForGroup.phoneDisplay || await formatPhone(orderForGroup.phone)));
  }

  web.notifyClients();

  const order = db.getOrder(orderId);
  if (order) {
    try {
      await sendWithTyping(order.phone, tmpl.orderAssigned(orderId, workerName));
    } catch (err) {
      console.error(`Error notificando al cliente ${order.phone}:`, err);
    }
  }
}

// ── MANEJAR ERRORES NO CAPTURADOS ────────────
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message?.substring(0, 200));
  console.error(err.stack?.substring(0, 300));
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason?.message || reason);
});

// ── INICIO ───────────────────────────────────
console.log('🚀 Iniciando bot de delivery...\n');

web.start(config.WEB_PANEL_PORT);

client.initialize();
