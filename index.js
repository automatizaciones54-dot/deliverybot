const { makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./database');
const tmpl = require('./messages');
const ai = require('./ai');
const web = require('./server');
const { useSingleFileAuthState } = require('./auth');

let openaiInstance = null;
if (config.OPENAI_API_KEY) {
  const OpenAI = require('openai');
  openaiInstance = new OpenAI({ apiKey: config.OPENAI_API_KEY });
}

let sock = null;
let botNumber = null;
const contactStore = new Map();

// ── AYUDANTES ─────────────────────────────────
function jidToPhone(jid) {
  if (!jid) return '';
  return jid.replace(/@.*$/, '').replace(/[:.].*$/, '').replace(/\D/g, '');
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

function humanDelay() {
  const base = Math.random() * 3000 + 1000;
  const jitter = Math.random() * 1000;
  return new Promise(r => setTimeout(r, base + jitter));
}

function typingDelay() {
  const base = Math.random() * 2000 + 500;
  const jitter = Math.random() * 800;
  return new Promise(r => setTimeout(r, base + jitter));
}

// ── HELPERS DE AUDIO ───────────────────────────
async function downloadAudio(url) {
  try {
    const fetch = require('node-fetch');
    const response = await fetch(url);
    if (!response.ok) return '';
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error('Error descargando audio:', err.message);
    return '';
  }
}

async function processAudioTranscription(jid, audioMsg, phone, text, state) {
  const lower = text.toLowerCase().trim();
  
  if (state && state.step === 'awaiting_order') {
    state.data = state.data || {};
    state.data.details = text;
    state.step = 'awaiting_location';
    userStates.set(phone, state);
    await replyWithTyping(jid, audioMsg, tmpl.askLocation(text));
    return;
  }
  
  if (state && state.step === 'awaiting_location') {
    userStates.delete(phone);
    await replyWithTyping(jid, audioMsg, '📍 Compartime tu ubicación. Clip 📎 > Ubicación > Enviar ubicación actual');
    return;
  }
  
  if (ai.generateResponse && !state) {
    const history = [];
    const aiResp = await ai.generateResponse(text, { history }).catch(() => null);
    if (aiResp) return await replyWithTyping(jid, audioMsg, aiResp);
  }
  
  await replyWithTyping(jid, audioMsg, `😊 No entendí tu mensaje de voz. Decime qué quieres pedir o compártenos ubicación.`);
}

// ── MANEJO DE MENSAJES DE VOZ ───────────────────
async function handleVoiceMessage(jid, phone, audioMsg, state) {
  try {
    const isAiConfigured = config.AI_PROVIDER === 'gemini' && config.GEMINI_API_KEY ||
                           config.AI_PROVIDER === 'openai' && config.OPENAI_API_KEY;
    
    if (!isAiConfigured) {
      return await replyWithTyping(jid, audioMsg, 'Lo siento, el servicio de voz no está disponible en este momento.');
    }
    
    if (config.AI_PROVIDER === 'openai' && openaiInstance) {
      try {
        const audioBuffer = await downloadAudio(audioMsg.message?.audioMessage?.url);
        if (!audioBuffer || audioBuffer.length === 0) {
          throw new Error('No se pudo descargar el audio');
        }
        const transcription = await openaiInstance.audio.transcriptions.create({
          file: audioBuffer,
          model: 'whisper-1'
        });
        const text = transcription.text;
        console.log(`🎤 Transcripción de audio (Whisper): ${text}`);
        await processAudioTranscription(jid, audioMsg, phone, text, state);
        return;
      } catch (err) {
        console.error('Error con OpenAI Whisper:', err.message);
      }
    }
    
    if (config.AI_PROVIDER === 'gemini' && config.GEMINI_API_KEY) {
      try {
        const audioBase64 = await downloadAudio(audioMsg.message?.audioMessage?.url);
        if (!audioBase64 || audioBase64.length === 0) {
          throw new Error('No se pudo descargar el audio');
        }
        const geminiResp = await ai.generateResponse(`Transcribo un audio de voz del cliente:`, {
          audioBase64,
          phone,
          step: 'voice_transcription'
        });
        console.log(`🎤 Respuesta de IA para transcripción: ${geminiResp}`);
        await processAudioTranscription(jid, audioMsg, phone, geminiResp, state);
        return;
      } catch (err) {
        console.error('Error con Gemini AI:', err.message);
      }
    }
    
    return await replyWithTyping(jid, audioMsg, 'Lo siento, no pude procesar tu mensaje de voz. ¿Puedes escribir tu pedido?');
  } catch (e) {
    console.error('❌ Error procesando mensaje de voz:', e.message);
  }
}

// ── ENVÍO DE MENSAJES ─────────────────────────
function getClientJid(order) {
  return order.jid || phoneToJid(order.phone);
}
function getWorkerJid(order) {
  return order.workerJid || phoneToJid(order.workerPhone);
}

async function safeSend(phone, text) {
  if (!sock) return;
  const jid = phoneToJid(phone);
  if (!jid) return;
  
  const allowed = await checkRateLimit(phone);
  if (!allowed) return;
  
  try {
    await sock.sendMessage(jid, { text });
  } catch (e) {
    console.error('Error enviando a', phone, e.message?.substring(0, 80));
  }
}

function saveBotReply(phone, text) {
  const st = userStates.get(phone);
  if (!st) return;
  if (!st.history) st.history = [];
  st.history.push({ role: 'assistant', text, ts: Date.now() });
  if (st.history.length > 10) st.history = st.history.slice(-10);
}

async // Rate limit control per phone number
const sentMessages = new Map();

async function checkRateLimit(phone) {
  const key = phone;
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  
  if (!sentMessages.has(key)) {
    sentMessages.set(key, []);
  }
  
  const messages = sentMessages.get(key);
  const validMessages = messages.filter(time => now - time < windowMs);
  
  if (validMessages.length >= 20) {
    console.log(`⏱️ Rate limit hit for ${phone}: ${validMessages.length}/20 per minute`);
    return false;
  }
  
  validMessages.push(now);
  sentMessages.set(key, validMessages);
  
  return true;
}

async function replyWithTyping(jid, msg, text, phoneForHistory) {
  if (!sock) { console.error('replyWithTyping: sock null'); return; }
  const phone = phoneForHistory || jidToPhone(jid);
  if (phone && !(await checkRateLimit(phone))) return;
  try {
    await sock.sendPresenceUpdate('composing', jid);
    await typingDelay();
    await sock.sendPresenceUpdate('paused', jid);
    await humanDelay();
    await sock.readMessages([msg.key]);
    await sock.sendMessage(jid, { text }, { quoted: msg, ephemeralExpiration: undefined });
  } catch (e) {
    try {
      await sock.sendMessage(jid, { text }, { quoted: msg });
    } catch (e2) {
      console.error('replyWithTyping error:', e2.message?.substring(0, 100), 'jid:', jid);
    }
  }
  if (phoneForHistory) saveBotReply(phoneForHistory, text);
}

async function sendWithTyping(phone, text) {
  if (!sock) { console.error('sendWithTyping: sock null'); return; }
  const jid = phoneToJid(phone);
  if (!jid) { console.error('sendWithTyping: jid vacio para phone:', phone); return; }
  
  // Rate limit check before sending
  const allowed = await checkRateLimit(phone);
  if (!allowed) {
    console.log(`⏱️ Rate limit para ${phone}, mensaje omitido: ${text.substring(0, 50)}...`);
    return;
  }
  
  try {
    await sock.sendPresenceUpdate('composing', jid);
    await typingDelay();
    await sock.sendPresenceUpdate('paused', jid);
    await humanDelay();
    await sock.sendMessage(jid, { text });
  } catch (e) {
    try {
      await sock.sendMessage(jid, { text });
    } catch (e2) {
      console.error('sendWithTyping error:', e2.message?.substring(0, 100), 'phone:', phone, 'jid:', jid);
    }
  }
}

// ── TIMEOUT PARA PEDIDOS ──────────────────────
let lastTimeoutIds = new Set();

setInterval(() => {
  const pending = db.getPendingOrders();
  const now = Date.now();
  const totalWorkers = db.getWorkerCount();
  const availableWorkers = db.getAvailableWorkerCount();

  for (const order of pending) {
    const createdAt = new Date(order.createdAt).getTime();
    const elapsed = (now - createdAt) / 1000 / 60;

    if (totalWorkers === 0 && !order.notifiedTimeout) {
      const msg = `⚠️ *Pedido #${order.id}* creado.\nActualmente no hay repartidores registrados en el sistema. Contactate con la administración para coordinar la entrega.\nSi querés cancelar, escribí "cancelar".`;
      if (!lastTimeoutIds.has(order.id)) {
        safeSend(getClientJid(order), msg);
        lastTimeoutIds.add(order.id);
        if (order.id) setTimeout(() => lastTimeoutIds.delete(order.id), 60000);
      }
      db.markOrderNotified(order.id);
      continue;
    }

    if (availableWorkers === 0 && elapsed > 5 && !order.notifiedTimeout && totalWorkers > 0) {
      const msg = `⏳ *Pedido #${order.id}* — todos los repartidores están ocupados.\nEn cuanto alguien se libere te asignamos uno. Gracias por la paciencia.`;
      if (!lastTimeoutIds.has(order.id)) {
        safeSend(getClientJid(order), msg);
        lastTimeoutIds.add(order.id);
        if (order.id) setTimeout(() => lastTimeoutIds.delete(order.id), 60000);
      }
      db.markOrderNotified(order.id);
      continue;
    }

    if (elapsed > 15 && !order.notifiedTimeout && totalWorkers > 0) {
      const msg = `⏳ *Pedido #${order.id}* aún no tiene repartidor.\nLos repartidores están disponibles pero nadie tomó tu pedido todavía. Si querés cancelar, escribí "cancelar".`;
      if (!lastTimeoutIds.has(order.id)) {
        safeSend(getClientJid(order), msg);
        lastTimeoutIds.add(order.id);
        if (order.id) setTimeout(() => lastTimeoutIds.delete(order.id), 60000);
      }
      db.markOrderNotified(order.id);
      continue;
    }

    if (elapsed > 30) {
      const result = db.cancelOrder(order.id, order.phone);
      if (result) {
        const msg = `❌ *Pedido #${order.id} cancelado automáticamente*\nNo se pudo asignar un repartidor. Disculpá las molestias.\nPodés hacer un nuevo pedido cuando quieras.`;
        safeSend(getClientJid(order), msg);
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
      safeSend(getClientJid(order), `⏳ *Pedido #${order.id}* — ¿cómo va todo? Si tenés algún problema avisanos.`);
      db.markOrderNotified(order.id);
    }
  }
}, 60 * 1000);

// ── AYUDANTES DE WHATSAPP ─────────────────────
function mapsLink(lat, lng) {
  return `https://maps.google.com/maps?q=${lat},${lng}`;
}

async function getDisplayPhone(jid, pushName) {
  const raw = jidToPhone(jid);
  const isRealPhone = raw && raw.length >= 7 && raw.length <= 15;
  if (isRealPhone && jid.endsWith('@s.whatsapp.net')) return raw;
  const contact = contactStore.get(jid);
  if (contact?.name) return contact.name;
  if (contact?.notify) return contact.notify;
  if (contact?.verifiedName) return contact.verifiedName;
  const pn = await resolveLidToPhone(jid).catch(() => null);
  if (pn) {
    const digits = jidToPhone(pn);
    if (digits) return digits;
  }
  if (pushName) return pushName;
  if (raw && raw.length <= 15) return raw;
  if (contact?.username) return contact.username;
  return 'Cliente';
}

async function resolveLidToPhone(jid) {
  if (!jid || !jid.endsWith('@lid')) return null;
  const cached = contactStore.get(jid);
  if (cached?.phoneNumber) return cached.phoneNumber;
  if (cached?.pn) return cached.pn;
  try {
    const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(jid);
    if (pn) return pn;
  } catch {}
  for (const [jid2, c] of contactStore) {
    if (c.lid === jid || c.id === jid) {
      if (c.phoneNumber) return c.phoneNumber;
      if (jid2.endsWith('@s.whatsapp.net')) return jid2;
    }
    if (c.phoneNumber === jid || c.pn === jid) {
      if (jid2.endsWith('@s.whatsapp.net')) return jid2;
    }
  }
  return null;
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
       await replyWithTyping(jid, msg, `📝 *Pedido #${o.id} actualizado*\n${mod[2]}`, phone);
       if (isGroupConfigured()) safeSend(config.GRUPO_WORKERS_ID, `📝 Pedido #${o.id}: ${mod[2]}`);
       web.notifyClients();
     } else {
       await replyWithTyping(jid, msg, '❌ No se pudo modificar. Solo pedidos pendientes.', phone);
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
         await replyWithTyping(jid, msg, `✅ Agregado: "${item}" al pedido #${order.id}`, phone);
       } else if (order.status === 'asignado' || order.status === 'en_camino') {
         db.updateOrderDetails(order.id, phone, order.details + ' + ' + item);
         await replyWithTyping(jid, msg, `✅ Avisamos al repartidor que agregue "${item}"`, phone);
         if (order.workerPhone) safeSend(getWorkerJid(order), `📝 Cliente agregó al #${order.id}: "${item}"`);
       } else {
         await replyWithTyping(jid, msg, '❌ Pedido ya entregado o cancelado.', phone);
         return;
       }
       if (isGroupConfigured()) safeSend(config.GRUPO_WORKERS_ID, `📝 Pedido #${order.id}: +${item}`);
       web.notifyClients();
     } else {
       await replyWithTyping(jid, msg, '❌ No encontré ese pedido.', phone);
     }
     return;
   }

   // ── ESTADO ──
   if (/^(estado|status)$/i.test(lower)) {
     const orders = db.getClientOrders(phone);
     return replyWithTyping(jid, msg, orders.length ? '📋 Tus pedidos:\n' + orders.map(o => `#${o.id} - ${o.status}${o.workerName ? ' ('+o.workerName+')' : ''}`).join('\n') : 'No tenés pedidos.', phone);
   }

   // ── CALIFICAR ──
   const ratingNum = parseInt(body);
   if (/^\d+$/.test(body) && !isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 10) {
     const unratedOrders = db.getClientOrders(phone).filter(o => o.status === 'entregado' && !o.rating);
     if (unratedOrders.length > 0) {
       const order = unratedOrders[unratedOrders.length - 1];
       db.saveRating(order.id, ratingNum);
       await replyWithTyping(jid, msg, tmpl.ratingReceived(order.id, ratingNum), phone);
       web.notifyClients();
       return;
     }
     return replyWithTyping(jid, msg, 'No encontré pedidos entregados sin calificar. Gracias igual 😊', phone);
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
         return replyWithTyping(jid, msg, tmpl.askLocation(want[1]), phone);
       }

       userStates.set(phone, { step: 'awaiting_order', data: {}, ts: Date.now() });

       if (isAiConfigured() && /hola|buenas|ayuda|empezar/i.test(lower)) {
         const history = (userStates.get(phone)?.history || []).slice(-4);
         const aiResp = await ai.generateResponse(body, { step: 'awaiting_order', history }).catch(() => null);
         if (aiResp) return replyWithTyping(jid, msg, aiResp, phone);
       }
       return replyWithTyping(jid, msg, `👋 ¡Hola! ¿Qué se te antoja hoy? Decime y coordinamos 😊`, phone);
     }
   }

   // ── CANCELAR (ID) ──
   if (state && state.step === 'awaiting_cancel_id') {
     const num = parseInt(lower);
     if (isNaN(num)) return replyWithTyping(jid, msg, 'Decime el número del pedido (ej: 1).', phone);
     const res = db.cancelOrder(num, phone);
     if (!res) return replyWithTyping(jid, msg, 'No se pudo cancelar. ¿Existe ese pedido?', phone);
     await replyWithTyping(jid, msg, tmpl.orderCancelled(num), phone);
     if (isGroupConfigured()) {
       const o = db.getOrder(num);
       safeSend(config.GRUPO_WORKERS_ID, tmpl.orderCancelledGroup(num, o?.workerName || null));
       if (o?.workerPhone) safeSend(getWorkerJid(o), `❌ Pedido #${num} cancelado por el cliente.`);
     }
     web.notifyClients();
     userStates.delete(phone);
     return;
   }

   // ── ESPERANDO PEDIDO ──
   if (state && state.step === 'awaiting_order') {
     if (lower.length < 3) return replyWithTyping(jid, msg, 'Escribí qué querés pedir (min 3 caracteres).', phone);
     if (/^(hola|buenas|como.*tal|gracias|ok|dale|si|no|nada)$/i.test(lower)) {
       return replyWithTyping(jid, msg, 'Decime qué querés pedir 😊', phone);
     }
     userStates.set(phone, { step: 'awaiting_location', data: { details: body }, ts: Date.now() });
     return replyWithTyping(jid, msg, tmpl.askLocation(body), phone);
   }

   // ── ESPERANDO UBICACIÓN ──
   if (state && state.step === 'awaiting_location') {
     return replyWithTyping(jid, msg, '📍 Compartime tu ubicación. Clip 📎 > Ubicación > Enviar ubicación actual', phone);
   }

   // ── DEFAULT ──
   if (isAiConfigured()) {
     const active = db.getActiveClientOrders(phone);
     const history = (state?.history || []).slice(-4);
     const aiResp = await ai.generateResponse(body, { hasActiveOrders: active.length > 0, history }).catch(() => null);
     if (aiResp) return replyWithTyping(jid, msg, aiResp, phone);
   }
   if (state) userStates.delete(phone);
   return replyWithTyping(jid, msg, `😊 No entendí. Escribí *"pedir"*, *"cancelar"* o *"estado"*.`, phone);
}

// ── MANEJAR UBICACIÓN ────────────────────────
async function handleLocation(jid, msg, phone, loc) {
  const state = getState(phone);
  if (!state || state.step !== 'awaiting_location' || !state.data.details) {
    return replyWithTyping(jid, msg, 'No estaba esperando una ubicación. Escribí *"pedir"* para empezar.');
  }

  const link = mapsLink(loc.latitude, loc.longitude);

  const pushName = msg.pushName || '';

  const orderId = db.createOrder({
    phone,
    jid,
    pushName,
    details: state.data.details,
    link,
    lat: loc.latitude,
    lng: loc.longitude,
  });

  clearState(phone);
  await replyWithTyping(jid, msg, tmpl.orderConfirmed(orderId, state.data.details, link));

  const displayPhone = await getDisplayPhone(jid, pushName);
  db.updateOrderDisplayPhone(orderId, displayPhone);

  if (isGroupConfigured()) {
    let contactLink;
    if (jid && !jid.endsWith('@s.whatsapp.net')) {
      const realPhone = await resolveLidToPhone(jid);
      if (realPhone) {
        const digits = jidToPhone(realPhone);
        contactLink = `💬 *Contactar:* https://wa.me/${digits}`;
      } else {
        contactLink = `💬 *Contactar:* respondé en el grupo y el bot reenvía`;
      }
    } else {
      contactLink = `💬 *Contactar:* https://wa.me/${phone}`;
    }
    await sendWithTyping(config.GRUPO_WORKERS_ID, tmpl.newOrderGroup(orderId, state.data.details, link, displayPhone, contactLink));
  }

  web.notifyClients();
}

// ── CANCELAR PEDIDO ──────────────────────────
async function handleCancelRequest(jid, msg, phone) {
  const active = db.getActiveClientOrders(phone);
  if (active.length === 0) {
    return replyWithTyping(jid, msg, tmpl.noActiveOrders(), phone);
  }

  if (active.length === 1) {
    const order = active[0];
    const result = db.cancelOrder(order.id, phone);
    if (!result) return replyWithTyping(jid, msg, 'No se pudo cancelar el pedido.', phone);
    await replyWithTyping(jid, msg, tmpl.orderCancelled(order.id), phone);

    if (isGroupConfigured()) {
      await sendWithTyping(config.GRUPO_WORKERS_ID, tmpl.orderCancelledGroup(order.id, order.workerName || null));

      if (order.workerPhone) {
        try {
          await safeSend(getWorkerJid(order), `❌ *Pedido #${order.id} cancelado por el cliente*\nYa no tenés que ir. Quedás libre para otro pedido.`);
        } catch (e) {
          console.error('Error notificando al worker:', e.message?.substring(0, 80));
        }
      }
    }
    web.notifyClients();
    return;
  }

  setState(phone, 'awaiting_cancel_id');
  return replyWithTyping(jid, msg, tmpl.askCancelOrder(active), phone);
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
      await replyWithTyping(jid, msg, `🔄 *Pedido #${orderId} liberado*\nQueda disponible para otro worker.`);
      if (isGroupConfigured()) {
        await sendWithTyping(config.GRUPO_WORKERS_ID, `🔄 *Pedido #${orderId} liberado*\nEstá disponible de nuevo para tomar.`);
      }
      if (order) {
        try {
          await sendWithTyping(getClientJid(order), `🔄 *Pedido #${orderId}*\nEl repartidor lo liberó. En breve te asignamos otro.`);
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

  const caminoMatch = lower.match(/^camino\s+#?(\d+)/);
  if (caminoMatch) {
    const orderId = parseInt(caminoMatch[1]);
    const chkOrder = db.getOrder(orderId);
    if (!chkOrder) return replyWithTyping(jid, msg, `❌ Pedido #${orderId} no existe.`);
    if (chkOrder.workerPhone !== senderPhone) return replyWithTyping(jid, msg, `❌ No podés marcar en camino un pedido que no te pertenece.`);
    const ok = db.markAsEnCamino(orderId);
    if (!ok) return replyWithTyping(jid, msg, `❌ No se pudo marcar #${orderId}. Solo pedidos asignados.`);
    if (chkOrder) {
      web.notifyClients();
      await replyWithTyping(jid, msg, `🚚 *Pedido #${orderId} en camino*`);
      let workerContact = '';
      if (chkOrder.workerJid && !chkOrder.workerJid.endsWith('@s.whatsapp.net')) {
        const rp = await resolveLidToPhone(chkOrder.workerJid).catch(() => null);
        if (rp) workerContact = `\n📱 *Contacto repartidor:* https://wa.me/${jidToPhone(rp)}`;
      } else if (chkOrder.workerPhone) {
        workerContact = `\n📱 *Contacto repartidor:* https://wa.me/${chkOrder.workerPhone}`;
      }
      const wn = chkOrder.workerName || 'El repartidor';
      safeSend(getClientJid(chkOrder), `🛵 *Tu pedido #${orderId} está en camino!*\n${wn} ya salió con tu pedido. 🎉${workerContact}`);
      if (isGroupConfigured()) safeSend(config.GRUPO_WORKERS_ID, `🚚 *Pedido #${orderId} en camino* con ${wn}`);
    }
    return;
  }

  const entregadoMatch = lower.match(/^entregado\s+#?(\d+)/);
  if (entregadoMatch) {
    const orderId = parseInt(entregadoMatch[1]);
    const chkOrder2 = db.getOrder(orderId);
    if (!chkOrder2) return replyWithTyping(jid, msg, `❌ Pedido #${orderId} no existe.`);
    if (chkOrder2.workerPhone !== senderPhone) return replyWithTyping(jid, msg, `❌ No podés marcar entregado un pedido que no te pertenece.`);
    const ok = db.markAsEntregado(orderId);
    if (!ok) return replyWithTyping(jid, msg, `❌ No se pudo marcar #${orderId}. Pedido no asignado o ya entregado.`);
    if (chkOrder2) {
      web.notifyClients();
      await replyWithTyping(jid, msg, `✅ *Pedido #${orderId} entregado*`);
      const wn2 = chkOrder2.workerName || 'el repartidor';
      safeSend(getClientJid(chkOrder2), `✅ *Pedido #${orderId} entregado!*\nGracias por elegirnos 😊\n\nSi querés calificar a ${wn2}, respondé con una nota del 1 al 10.`);
      if (isGroupConfigured()) safeSend(config.GRUPO_WORKERS_ID, `✅ *Pedido #${orderId} entregado por ${chkOrder2.workerName || 'desconocido'}*`);
    }
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

  const workerJid = msg.key.participant;
  const ok = db.assignOrder(orderId, senderPhone, workerName, workerJid);
  if (!ok) {
    return replyWithTyping(jid, msg, `❌ No se pudo asignar el pedido #${orderId}. ¿Ya está asignado o cancelado?`);
  }

  await replyWithTyping(jid, msg, tmpl.orderAssignedGroup(orderId, workerName));

  const orderForGroup = db.getOrder(orderId);
  if (orderForGroup && isGroupConfigured()) {
    const dp = orderForGroup.phoneDisplay || await getDisplayPhone(orderForGroup.jid || orderForGroup.phone, orderForGroup.pushName);
    let contactLink;
    if (orderForGroup.jid && !orderForGroup.jid.endsWith('@s.whatsapp.net')) {
      const realPhone = await resolveLidToPhone(orderForGroup.jid);
      if (realPhone) {
        contactLink = `https://wa.me/${jidToPhone(realPhone)}`;
      } else {
        contactLink = 'respondé en el grupo y el bot reenvía';
      }
    } else {
      contactLink = `https://wa.me/${orderForGroup.phone}`;
    }
    await sendWithTyping(config.GRUPO_WORKERS_ID, tmpl.orderAssignedGroupWithPhone(orderId, workerName, dp, contactLink));
  }

  web.notifyClients();

  const order = db.getOrder(orderId);
  if (order) {
    try {
      let workerContact = '';
      if (workerJid && !workerJid.endsWith('@s.whatsapp.net')) {
        const realPhone = await resolveLidToPhone(workerJid);
        if (realPhone) {
          workerContact = `📱 *Contacto repartidor:* https://wa.me/${jidToPhone(realPhone)}`;
        } else {
          workerContact = '';
        }
      } else {
        workerContact = `📱 *Contacto repartidor:* https://wa.me/${senderPhone}`;
      }
      await sendWithTyping(getClientJid(order), tmpl.orderAssigned(orderId, workerName, workerContact));
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
      // Responder !id desde cualquier grupo
      if (getMsgText(msg).trim().toLowerCase() === '!id') {
        if (sock) return replyWithTyping(jid, msg, `🆔 ID de este grupo:\n\`${jid}\`\n\nCopialo como:\n\`GRUPO_WORKERS_ID: '${jid}',\``);
        return;
      }
      // Solo procesar el grupo configurado
      if (jid !== config.GRUPO_WORKERS_ID) return;
      return await handleGroupMessage(msg).catch(e => console.error('❌ handleGroupMessage:', e.message?.substring(0, 200)));
    }

    if (msg.message.locationMessage) {
      const loc = msg.message.locationMessage;
      const phone = jidToPhone(jid);
      return await handleLocation(jid, msg, phone, { latitude: loc.degreesLatitude, longitude: loc.degreesLongitude });
    }

    const body = getMsgText(msg);
    if (!body) return;

    await handleClientMessage(msg);

    if (msg.message?.audioMessage && !body) {
      const phone = jidToPhone(jid);
      return await handleVoiceMessage(jid, phone, msg, userStates.get(phone));
    }
  } catch (err) {
    console.error('❌ Error procesando mensaje:', err.message?.substring(0, 200));
    console.error(err.stack?.substring(0, 300));
  }
}

// ── INICIO DEL WEB SERVER (una sola vez) ──────
console.log('🚀 Iniciando bot de delivery...\n');

startWeb();

// ── INICIALIZACIÓN DE WHATSAPP ────────────────
const webEventCallback = async (type, orderId) => {
  const order = db.getOrder(orderId);
  if (!order) return;

  if (type === 'camino') {
    let workerContact = '';
    if (order.workerJid && !order.workerJid.endsWith('@s.whatsapp.net')) {
      const realPhone = await resolveLidToPhone(order.workerJid).catch(() => null);
      if (realPhone) workerContact = `\n📱 *Contacto repartidor:* https://wa.me/${jidToPhone(realPhone)}`;
    } else if (order.workerPhone) {
      workerContact = `\n📱 *Contacto repartidor:* https://wa.me/${order.workerPhone}`;
    }
    const wn = order.workerName || 'El repartidor';
    safeSend(getClientJid(order), `🛵 *Tu pedido #${orderId} está en camino!*\n${wn} ya salió con tu pedido. 🎉${workerContact}`);
    if (isGroupConfigured()) {
      safeSend(config.GRUPO_WORKERS_ID, `🚚 *Pedido #${orderId} en camino* con ${wn}`);
    }
  } else if (type === 'entregado') {
    const wn2 = order.workerName || 'el repartidor';
    safeSend(getClientJid(order), `✅ *Pedido #${orderId} entregado!*\nGracias por elegirnos 😊\n\nSi querés calificar a ${wn2}, respondé con una nota del 1 al 10.`);
    if (isGroupConfigured()) {
      safeSend(config.GRUPO_WORKERS_ID, `✅ *Pedido #${orderId} entregado por ${order.workerName || 'desconocido'}*`);
    }
  }
};

function startWeb() {
  web.start(config.WEB_PANEL_PORT);
}

async function initWhatsApp() {
  const authPath = config.AUTH_PATH;

  // Clean up old multi-file auth for fresh start
  try {
    if (fs.existsSync(authPath)) {
      const entries = fs.readdirSync(authPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name !== 'creds.json') {
          fs.rmSync(path.join(authPath, entry.name));
        }
      }
    }
  } catch { }
  // Reset all data if FRESH_START is set (for new client setup)
  if (process.env.FRESH_START === 'true') {
    console.log('🧹 FRESH_START detectado, limpiando todos los datos...');
    try { fs.rmSync(authPath, { recursive: true, force: true }); } catch {}
    db.reset();
    console.log('✅ Datos limpiados para nuevo cliente');
  }

  const { state, saveCreds } = useSingleFileAuthState(authPath);

  sock = makeWASocket({
    auth: state,
    browser: Browsers.windows('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('contacts.upsert', contacts => {
    for (const c of contacts) {
      contactStore.set(c.id, c);
      if (c.lid) contactStore.set(c.lid, { ...contactStore.get(c.lid), ...c });
    }
  });
  sock.ev.on('contacts.update', updates => {
    for (const c of updates) {
      const existing = contactStore.get(c.id) || {};
      contactStore.set(c.id, { ...existing, ...c });
    }
  });
  sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
    contactStore.set(lid, { ...contactStore.get(lid) || {}, id: lid, phoneNumber: pn, pn });
  });

  let reconnectAttempts = 0;

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      try {
        const qrPath = path.join(__dirname, 'qr.png');
        QRCode.toFile(qrPath, qr, { width: 400, margin: 2 }, (err) => {
          if (err) {
            console.error('Error generando QR:', err.message);
            return;
          }
          console.log(`🖼️  QR guardado: ${qrPath}`);
          const qrBase64 = require('fs').readFileSync(qrPath, 'base64');
          web.emit('qr', qrBase64);
          console.log('📱 Nuevo QR disponible para escanear desde el panel web');
        });
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

      web.onEvent(webEventCallback);

      if (isGroupConfigured()) {
        safeSend(config.GRUPO_WORKERS_ID, '🤖 *Bot de delivery conectado y operativo!*\nYa puedo recibir pedidos.')
          .then(() => console.log('✅ Mensaje de prueba enviado al grupo'))
          .catch(err => console.error('❌ Error al enviar mensaje de prueba al grupo:', err.message?.substring(0, 100)));
      }
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 300000);
        reconnectAttempts++;
        console.log(`❌ Desconectado, reconectando en ${Math.round(delay/1000)}s (intento ${reconnectAttempts})...`);
        setTimeout(() => { reconnectAttempts = 0; initWhatsApp(); }, delay);
      } else {
        reconnectAttempts = 0;
        console.log('❌ Sesión cerrada. Borrando sesión y generando nuevo QR...');
        const authPath = config.AUTH_PATH;
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
          console.log('🗑️  Auth borrado');
        } catch { }
        setTimeout(initWhatsApp, 2000);
      }
    }
  });

  let msgQueue = Promise.resolve();

  // Limpieza de rate limit cache cada 5 min
  setInterval(() => {
    const now = Date.now();
    for (const [key, times] of sentMessages.entries()) {
      const valid = times.filter(t => now - t < 3600000);
      if (valid.length) sentMessages.set(key, valid);
      else sentMessages.delete(key);
    }
  }, 300000);

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type === 'notify' || type === 'append') {
      for (const msg of messages) {
        msgQueue = msgQueue.then(() => processMessage(msg).catch(e => console.error('❌ processMessage:', e?.message)));
      }
    }
  });
}

initWhatsApp();

// ── MANEJAR ERRORES ───────────────────────────
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message?.substring(0, 200));
  console.error(err.stack?.substring(0, 300));
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason?.message || reason);
});
