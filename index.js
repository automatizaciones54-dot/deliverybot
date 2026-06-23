const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./database');
const tmpl = require('./messages');
const ai = require('./ai');
const web = require('./server');

let sock = null;
let botNumber = null;

// ── AYUDANTES ─────────────────────────────────
function jidToPhone(jid) {
  if (!jid) return '';
  return jid.replace(/@.*$/, '').replace(/\D/g, '');
}

function phoneToJid(phone) {
  if (!phone) return '';
  if (phone.includes('@')) {
    if (phone.endsWith('@c.us')) return phone.replace('@c.us', '@s.whatsapp.net');
    if (phone.endsWith('@g.us') || phone.endsWith('@s.whatsapp.net') || phone.endsWith('@broadcast')) return phone;
    return phone;
  }
  return phone + '@s.whatsapp.net';
}

function isGroupJid(jid) {
  return jid && jid.endsWith('@g.us');
}

function getMsgText(msg) {
  if (!msg.message) return '';
  const m = msg.message;
  return m.conversation || m.extendedTextMessage?.text || '';
}

function getMsgTimestamp(msg) {
  // messageTimestamp can be a number or Long type
  const ts = msg.messageTimestamp;
  if (!ts) return 0;
  return typeof ts === 'object' ? ts.toNumber() : Number(ts);
}

function isGroupConfigured() {
  return config.GRUPO_WORKERS_ID &&
    config.GRUPO_WORKERS_ID !== 'REEMPLAZA_CON_ID_DEL_GRUPO@g.us' &&
    config.GRUPO_WORKERS_ID.includes('@');
}

function isAiConfigured() {
  return (config.AI_PROVIDER === 'gemini' && config.GEMINI_API_KEY) ||
         (config.AI_PROVIDER === 'openai' && config.OPENAI_API_KEY);
}

// ── ESTADOS DE CONVERSACIÓN ───────────────────
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

setInterval(() => {
  const now = Date.now();
  for (const [phone, state] of userStates) {
    if (now - state.ts > 30 * 60 * 1000) userStates.delete(phone);
  }
}, 60 * 1000);

// ── ANTI-BAN ──────────────────────────────────
function randomDelay(min, max) {
  return new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
}

// ── ENVÍO DE MENSAJES ─────────────────────────
async function safeSend(phone, text) {
  if (!sock) return;
  const jid = phoneToJid(phone);
  if (!jid) return;
  try {
    await sock.sendMessage(jid, { text });
  } catch (e) {
    console.error('Error enviando a', phone, e.message?.substring(0, 80));
  }
}

async function replyWithTyping(jid, msg, text) {
  if (!sock) return;
  try {
    await sock.sendPresenceUpdate('composing', jid);
    await randomDelay(500, 1000);
    await sock.readMessages([msg.key]);
    await sock.sendMessage(jid, { text }, { quoted: msg, ephemeralExpiration: undefined });
  } catch {
    try {
      await sock.sendMessage(jid, { text }, { quoted: msg });
    } catch {}
  }
}

async function sendWithTyping(phone, text) {
  if (!sock) return;
  const jid = phoneToJid(phone);
  if (!jid) return;
  try {
    await sock.sendPresenceUpdate('composing', jid);
    await randomDelay(500, 1000);
    await sock.sendMessage(jid, { text });
  } catch {
    try {
      await sock.sendMessage(jid, { text });
    } catch {}
  }
}

// ── TIMEOUT PARA PEDIDOS ──────────────────────
setInterval(() => {
  const pending = db.getPendingOrders();
  const now = Date.now();
  const totalWorkers = db.getWorkerCount();
  const availableWorkers = db.getAvailableWorkerCount();

  for (const order of pending) {
    const createdAt = new Date(order.createdAt).getTime();
    const elapsed = (now - createdAt) / 1000 / 60;

    if (totalWorkers === 0 && !order.notifiedTimeout) {
      safeSend(order.phone, `⚠️ *Pedido #${order.id}* creado.\nActualmente no hay repartidores registrados en el sistema. Contactate con la administración para coordinar la entrega.\nSi querés cancelar, escribí "cancelar".`);
      db.markOrderNotified(order.id);
      continue;
    }

    if (availableWorkers === 0 && elapsed > 5 && !order.notifiedTimeout && totalWorkers > 0) {
      safeSend(order.phone, `⏳ *Pedido #${order.id}* — todos los repartidores están ocupados.\nEn cuanto alguien se libere te asignamos uno. Gracias por la paciencia.`);
      db.markOrderNotified(order.id);
      continue;
    }

    if (elapsed > 15 && !order.notifiedTimeout && totalWorkers > 0) {
      safeSend(order.phone, `⏳ *Pedido #${order.id}* aún no tiene repartidor.\nLos repartidores están disponibles pero nadie tomó tu pedido todavía. Si querés cancelar, escribí "cancelar".`);
      db.markOrderNotified(order.id);
      continue;
    }

    if (elapsed > 30) {
      const result = db.cancelOrder(order.id, order.phone);
      if (result) {
        safeSend(order.phone, `❌ *Pedido #${order.id} cancelado automáticamente*\nNo se pudo asignar un repartidor. Disculpá las molestias.\nPodés hacer un nuevo pedido cuando quieras.`);
        if (isGroupConfigured()) {
          safeSend(config.GRUPO_WORKERS_ID, `❌ *Pedido #${order.id} cancelado automáticamente* por falta de repartidores.`);
        }
        web.notifyClients();
      }
    }
  }
}, 60 * 1000);

// ── TIMEOUT "EN CAMINO" ───────────────────────
setInterval(() => {
  const enCamino = db.getEnCaminoOrders();
  const now = Date.now();
  for (const order of enCamino) {
    const createdAt = new Date(order.createdAt).getTime();
    const elapsed = (now - createdAt) / 1000 / 60;
    if (elapsed > 60 && !order.notifiedTimeout) {
      if (isGroupConfigured()) {
        safeSend(config.GRUPO_WORKERS_ID, `⚠️ *Pedido #${order.id}* — ${order.workerName || 'El repartidor'} lleva más de 1 hora "en camino". ¿Cómo va eso?`);
      }
      safeSend(order.phone, `⏳ *Pedido #${order.id}* — ¿cómo va todo? Si tenés algún problema avisanos.`);
      db.markOrderNotified(order.id);
    }
  }
}, 60 * 1000);

// ── AYUDANTES DE WHATSAPP ─────────────────────
function mapsLink(lat, lng) {
  return `https://maps.google.com/maps?q=${lat},${lng}`;
}

async function getDisplayPhone(phone) {
  const raw = jidToPhone(phone);
  if (!raw.startsWith('22') && raw.length >= 10) return raw;
  return raw || phone.replace(/@.*$/, '').replace(/\D/g, '');
}

async function getWorkerDisplayName(phone) {
  const worker = db.getWorker(phone);
  if (worker && worker.name) return worker.name;
  return jidToPhone(phone);
}

async function getGroupName(groupJid) {
  if (!sock || !groupJid || !isGroupJid(groupJid)) return null;
  try {
    const meta = await sock.groupMetadata(groupJid);
    return meta.subject || null;
  } catch {
    return null;
  }
}

// ── MANEJAR CLIENTE ───────────────────────────
async function handleClientMessage(msg) {
  const jid = msg.key.remoteJid;
  const body = getMsgText(msg).trim();
  if (!body) return;
  if (body.length > 100 && /^[A-Za-z0-9+/=]+$/.test(body)) return;

  const phone = jidToPhone(jid);
  const lower = body.toLowerCase();
  const state = userStates.get(phone) || null;

  // ── CANCELAR ──
  if (/cancelar|cancelo|ya no|me arrepenti|anular|déjalo|no lo quiero/i.test(lower)) {
    return handleCancelRequest(jid, msg, phone);
  }

  // ── MODIFICAR ──
  const mod = body.match(/^modificar\s+#?(\d+)\s+(.+)/i);
  if (mod) {
    const o = db.getOrder(parseInt(mod[1]));
    if (o && o.phone === phone && o.status === 'pendiente' && db.updateOrderDetails(o.id, phone, mod[2])) {
      await replyWithTyping(jid, msg, `📝 *Pedido #${o.id} actualizado*\n${mod[2]}`);
      if (isGroupConfigured()) safeSend(config.GRUPO_WORKERS_ID, `📝 Pedido #${o.id}: ${mod[2]}`);
      web.notifyClients();
    } else {
      await replyWithTyping(jid, msg, '❌ No se pudo modificar. Solo pedidos pendientes.');
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
        await replyWithTyping(jid, msg, `✅ Agregado: "${item}" al pedido #${order.id}`);
      } else if (order.status === 'asignado' || order.status === 'en_camino') {
        await replyWithTyping(jid, msg, `✅ Avisamos al repartidor que agregue "${item}"`);
        if (order.workerPhone) safeSend(order.workerPhone, `📝 Cliente agregó al #${order.id}: "${item}"`);
      } else {
        await replyWithTyping(jid, msg, '❌ Pedido ya entregado o cancelado.');
      }
      if (isGroupConfigured()) safeSend(config.GRUPO_WORKERS_ID, `📝 Pedido #${order.id}: +${item}`);
      web.notifyClients();
    } else {
      await replyWithTyping(jid, msg, '❌ No encontré ese pedido.');
    }
    return;
  }

  // ── ESTADO ──
  if (/^(estado|status)$/i.test(lower)) {
    const orders = db.getClientOrders(phone);
    return replyWithTyping(jid, msg, orders.length ? '📋 Tus pedidos:\n' + orders.map(o => `#${o.id} - ${o.status}${o.workerName ? ' ('+o.workerName+')' : ''}`).join('\n') : 'No tenés pedidos.');
  }

  if (state) {
    if (!state.history) state.history = [];
    state.history.push({ role: 'user', text: body, ts: Date.now() });
    if (state.history.length > 10) state.history = state.history.slice(-10);
  }

  // ── PEDIR / HOLA ──
  if (!state || !state.step) {
    if (/pedir|pedido|hola|buenas|menu|ayuda|empezar|quiero|quisiera|necesito|comprar/i.test(lower)) {
      const want = body.match(/^(?:quiero|quisiera|necesito|queria|me trae|me puede|me compra)\s+(.+)/i);
      if (want && want[1].length >= 3) {
        userStates.set(phone, { step: 'awaiting_location', data: { details: want[1] }, ts: Date.now() });
        return replyWithTyping(jid, msg, tmpl.askLocation(want[1]));
      }

      userStates.set(phone, { step: 'awaiting_order', data: {}, ts: Date.now() });

      if (isAiConfigured() && /hola|buenas|ayuda|empezar/i.test(lower)) {
        const history = (userStates.get(phone)?.history || []).slice(-4);
        const aiResp = await ai.generateResponse(body, { step: 'awaiting_order', history }).catch(() => null);
        if (aiResp) return replyWithTyping(jid, msg, aiResp);
      }
      return replyWithTyping(jid, msg, `👋 ¡Hola! ¿Qué se te antoja hoy? Decime y coordinamos 😊`);
    }
  }

  // ── CANCELAR (ID) ──
  if (state && state.step === 'awaiting_cancel_id') {
    const num = parseInt(lower);
    if (isNaN(num)) return replyWithTyping(jid, msg, 'Decime el número del pedido (ej: 1).');
    const res = db.cancelOrder(num, phone);
    if (!res) return replyWithTyping(jid, msg, 'No se pudo cancelar. ¿Existe ese pedido?');
    await replyWithTyping(jid, msg, tmpl.orderCancelled(num));
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
    if (lower.length < 3) return replyWithTyping(jid, msg, 'Escribí qué querés pedir (min 3 caracteres).');
    userStates.set(phone, { step: 'awaiting_location', data: { details: body }, ts: Date.now() });
    return replyWithTyping(jid, msg, tmpl.askLocation(body));
  }

  // ── ESPERANDO UBICACIÓN ──
  if (state && state.step === 'awaiting_location') {
    return replyWithTyping(jid, msg, '📍 Compartime tu ubicación. Clip 📎 > Ubicación > Enviar ubicación actual');
  }

  // ── DEFAULT ──
  if (state) userStates.delete(phone);

  if (isAiConfigured()) {
    const active = db.getActiveClientOrders(phone);
    const history = (state?.history || []).slice(-4);
    const aiResp = await ai.generateResponse(body, { hasActiveOrders: active.length > 0, history }).catch(() => null);
    if (aiResp) return replyWithTyping(jid, msg, aiResp);
  }
  return replyWithTyping(jid, msg, `😊 No entendí. Escribí *"pedir"*, *"cancelar"* o *"estado"*.`);
}

// ── MANEJAR UBICACIÓN ────────────────────────
async function handleLocation(jid, msg, phone, loc) {
  const state = getState(phone);
  if (!state || state.step !== 'awaiting_location' || !state.data.details) {
    return replyWithTyping(jid, msg, 'No estaba esperando una ubicación. Escribí *"pedir"* para empezar.');
  }

  const link = mapsLink(loc.latitude, loc.longitude);

  const orderId = db.createOrder({
    phone,
    details: state.data.details,
    link,
    lat: loc.latitude,
    lng: loc.longitude,
  });

  clearState(phone);
  await replyWithTyping(jid, msg, tmpl.orderConfirmed(orderId, state.data.details, link));

  const displayPhone = await getDisplayPhone(jid);
  db.updateOrderDisplayPhone(orderId, displayPhone);

  if (isGroupConfigured()) {
    await sendWithTyping(config.GRUPO_WORKERS_ID, tmpl.newOrderGroup(orderId, state.data.details, link, displayPhone));
  }

  web.notifyClients();
}

// ── CANCELAR PEDIDO ──────────────────────────
async function handleCancelRequest(jid, msg, phone) {
  const active = db.getActiveClientOrders(phone);
  if (active.length === 0) {
    return replyWithTyping(jid, msg, tmpl.noActiveOrders());
  }

  if (active.length === 1) {
    const order = active[0];
    const result = db.cancelOrder(order.id, phone);
    if (!result) return replyWithTyping(jid, msg, 'No se pudo cancelar el pedido.');
    await replyWithTyping(jid, msg, tmpl.orderCancelled(order.id));

    if (isGroupConfigured()) {
      await sendWithTyping(config.GRUPO_WORKERS_ID, tmpl.orderCancelledGroup(order.id, order.workerName || null));

      if (order.workerPhone) {
        try {
          await safeSend(order.workerPhone, `❌ *Pedido #${order.id} cancelado por el cliente*\nYa no tenés que ir. Quedás libre para otro pedido.`);
        } catch (e) {
          console.error('Error notificando al worker:', e.message?.substring(0, 80));
        }
      }
    }
    web.notifyClients();
    return;
  }

  setState(phone, 'awaiting_cancel_id');
  return replyWithTyping(jid, msg, tmpl.askCancelOrder(active));
}

// ── GRUPO DE WORKERS ─────────────────────────
async function handleGroupMessage(msg) {
  const text = getMsgText(msg).trim();
  if (!text) return;
  const lower = text.toLowerCase();
  const senderPhone = jidToPhone(msg.key.participant);
  if (!senderPhone) return;

  db.markWorkerAvailable(senderPhone);

  const jid = msg.key.remoteJid;

  const liberarMatch = lower.match(/^liberar\s+(\d+)/);
  if (liberarMatch) {
    const orderId = parseInt(liberarMatch[1]);
    const ok = db.releaseOrder(orderId, senderPhone);
    if (ok) {
      const order = db.getOrder(orderId);
      const orderPhone = order ? order.phone : null;
      await replyWithTyping(jid, msg, `🔄 *Pedido #${orderId} liberado*\nQueda disponible para otro worker.`);
      if (isGroupConfigured()) {
        await sendWithTyping(config.GRUPO_WORKERS_ID, `🔄 *Pedido #${orderId} liberado*\nEstá disponible de nuevo para tomar.`);
      }
      if (orderPhone) {
        try {
          await sendWithTyping(orderPhone, `🔄 *Pedido #${orderId}*\nEl repartidor lo liberó. En breve te asignamos otro.`);
        } catch (e) { console.error('Error:', e.message?.substring(0, 80)); }
      }
      web.notifyClients();
    } else {
      await replyWithTyping(jid, msg, `❌ No se pudo liberar el pedido #${orderId}. ¿No te pertenece o ya está entregado?`);
    }
    return;
  }

  if (lower === 'disponible' || lower === 'libre') {
    db.markWorkerAvailable(senderPhone);
    await replyWithTyping(jid, msg, '✅ Estás marcado como *disponible* para tomar pedidos.');
    return;
  }

  if (lower === '!id') {
    await replyWithTyping(jid, msg, `🆔 ID de este grupo:\n\`${jid}\`\n\nCopialo como:\n\`GRUPO_WORKERS_ID: '${jid}',\``);
    return;
  }

  if (lower === '!test') {
    await replyWithTyping(jid, msg, `✅ Bot funcionando\n📱 Número: ${botNumber || 'desconocido'}\n👥 Este grupo: ${jid}\n🤖 AI: ${isAiConfigured() ? 'Sí' : 'No'}`);
    return;
  }

  const nameMatch = lower.match(/^me\s*llamo\s+(.+)/);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    db.registerWorker(senderPhone, name);
    await replyWithTyping(jid, msg, tmpl.registered(name));
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
      return replyWithTyping(jid, msg, tmpl.noPendingOrders());
    }
    if (pending.length === 1) {
      orderId = pending[0].id;
    } else {
      return replyWithTyping(jid, msg, tmpl.multiplePending(pending.map((o) => o.id)));
    }
  }

  if (!orderId) return;

  const existingWorker = db.getWorker(senderPhone);
  if (!existingWorker) {
    return replyWithTyping(jid, msg, tmpl.needRegistration());
  }

  const workerName = existingWorker.name;

  const ok = db.assignOrder(orderId, senderPhone, workerName);
  if (!ok) {
    return replyWithTyping(jid, msg, `❌ No se pudo asignar el pedido #${orderId}. ¿Ya está asignado o cancelado?`);
  }

  await replyWithTyping(jid, msg, tmpl.orderAssignedGroup(orderId, workerName));

  const orderForGroup = db.getOrder(orderId);
  if (orderForGroup && isGroupConfigured()) {
    await sendWithTyping(config.GRUPO_WORKERS_ID, tmpl.orderAssignedGroupWithPhone(orderId, workerName, orderForGroup.phoneDisplay || await getDisplayPhone(orderForGroup.phone)));
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

// ── PROCESAR MENSAJE RECIBIDO ─────────────────
async function processMessage(msg) {
  try {
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const ts = getMsgTimestamp(msg);

    if (ts && Date.now() / 1000 - ts > 30) {
      console.log(`⏭️ Msg ignorado (timestamp viejo): ${ts} de ${jid}`);
      return;
    }

    const textPreview = getMsgText(msg).substring(0, 50);
    console.log(`📩 Msg de ${jid}: texto="${textPreview}"`);

    if (isGroupJid(jid)) {
      // Solo procesar el grupo configurado
      if (jid !== config.GRUPO_WORKERS_ID) return;
      return handleGroupMessage(msg);
    }

    if (msg.message.locationMessage) {
      const loc = msg.message.locationMessage;
      const phone = jidToPhone(jid);
      return handleLocation(jid, msg, phone, { latitude: loc.degreesLatitude, longitude: loc.degreesLongitude });
    }

    const body = getMsgText(msg);
    if (!body) return;

    await handleClientMessage(msg);
  } catch (err) {
    console.error('❌ Error procesando mensaje:', err.message?.substring(0, 200));
    console.error(err.stack?.substring(0, 300));
  }
}

// ── INICIALIZACIÓN ────────────────────────────
async function start() {
  console.log('🚀 Iniciando bot de delivery...\n');

  web.start(config.WEB_PANEL_PORT);

  const authPath = config.AUTH_PATH;
  fs.mkdirSync(authPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  sock = makeWASocket({
    auth: state,
    browser: Browsers.windows('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: false,
  });

  // ── GUARDAR CREDENCIALES ──
  sock.ev.on('creds.update', saveCreds);

  // ── CONEXIÓN ──
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      try {
        const qrPath = path.join(__dirname, 'qr.png');
        QRCode.toFile(qrPath, qr, { width: 400, margin: 2 }, (err) => {
          if (err) {
            console.error('Error generando QR:', err.message);
            return;
          }
          console.log(`🖼️  QR guardado como imagen: ${qrPath}`);
        });
        console.log('📱 Escanea el QR en https://deliverybot-curious-meadowlark-9263.fly.dev/qr.png');
      } catch (e) {
        console.error('Error en QR handler:', e.message);
      }
    }

    if (connection === 'open') {
      console.log('✅ Conectado a WhatsApp!');
      botNumber = jidToPhone(sock.user?.id || '');

      console.log(`📱 Número: ${botNumber}`);
      console.log(`👥 Grupo workers configurado: ${isGroupConfigured() ? 'Sí' : 'NO - configurá GRUPO_WORKERS_ID'}`);
      if (config.AI_PROVIDER === 'openai' && config.OPENAI_API_KEY) {
        console.log(`🤖 OpenAI: ✅ ACTIVADO (gpt-4o-mini)`);
      } else if (config.AI_PROVIDER === 'gemini' && config.GEMINI_API_KEY) {
        console.log(`🤖 Gemini AI: ✅ ACTIVADO (gemini-2.0-flash - 20/día free)`);
      } else {
        console.log(`🤖 AI: ❌ Desactivado`);
      }

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
          .catch(err => console.error('❌ Error al enviar mensaje de prueba al grupo:', err.message?.substring(0, 100)));
      }
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Desconectado, reconectando:', shouldReconnect);
      if (shouldReconnect) {
        start();
      }
    }
  });

  // ── MENSAJES ──
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type === 'notify' || type === 'append') {
      for (const msg of messages) {
        processMessage(msg);
      }
    }
  });

  // ── MENSAJES ACTUALIZADOS (estados, etc) ──
  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (update.status) {
        // status changes - could log if needed
      }
    }
  });
}

// ── MANEJAR ERRORES ───────────────────────────
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message?.substring(0, 200));
  console.error(err.stack?.substring(0, 300));
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason?.message || reason);
});

start();
