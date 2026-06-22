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
  for (const [phone, state] of userStates.entries()) {
    if (now - state.ts > 30 * 60 * 1000) userStates.delete(phone);
  }
}, 30 * 60 * 1000);

// ── Enviar mensaje con "escribiendo..." ──────
async function sendWithTyping(contact, text) {
  try {
    await contact.sendStateTyping();
    await new Promise(r => setTimeout(r, Math.min(1500, text.length * 10)));
    await contact.sendMessage(text);
  } catch {
    // fallback
    try { await contact.sendMessage(text); } catch {}
  }
}

// ── safeSend: envía a un chat por ID ──────────
async function safeSend(chatId, text) {
  try {
    const chat = await client.getChatById(chatId);
    await sendWithTyping(chat, text);
  } catch (err) {
    console.error(`Error enviando a ${chatId}:`, err.message);
  }
}

// ── TIMEOUT PARA PEDIDOS PENDIENTES ──────────
setInterval(() => {
  const pending = db.getPendingOrders();
  const now = Date.now();
  for (const order of pending) {
    const createdAt = new Date(order.createdAt).getTime();
    const elapsed = (now - createdAt) / 1000 / 60;

    const totalWorkers = db.getWorkerCount();
    const availableWorkers = db.getAvailableWorkerCount();

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
  console.clear();
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
        safeSend(config.GRUPO_WORKERS_ID, `✅ *Pedido #${orderId} entregado* por ${order.workerName}`);
      }
    }
  });
});

// ── MANEJO DE MENSAJES ───────────────────────

client.on('message', async (msg) => {
  // Ignorar mensajes de grupos si no es el grupo configurado
  const chat = await msg.getChat();
  const isGroup = chat.isGroup;
  const chatId = msg.from;

  // Si es un grupo pero NO es el grupo de workers, lo ignoramos
  if (isGroup && chatId !== config.GRUPO_WORKERS_ID) {
    return;
  }

  const phone = msg.author || msg.from; // En grupos msg.author es quien manda
  const text = msg.body?.trim() || '';

  // ── LÓGICA PRINCIPAL ──────────────────────

  if (isGroup && chatId === config.GRUPO_WORKERS_ID) {
    // ── MENSAJES DEL GRUPO DE WORKERS ──────
    await handleWorkerMessage(msg, chat, phone, text);
    return;
  }

  // ── MENSAJES PRIVADOS (CLIENTES) ─────────
  await handleClientMessage(msg, chat, phone, text);
});

// ── HANDLER: WORKERS ──────────────────────────

async function handleWorkerMessage(msg, chat, phone, text) {
  const lower = text.toLowerCase();
  const sender = await msg.getContact();
  const senderName = sender.pushname || sender.name || 'Repartidor';

  // Registrar / entrar al sistema
  if (lower === 'entrar' || lower === 'registrar') {
    db.registerWorker(phone, senderName);
    await sendWithTyping(chat, `✅ ${senderName}, quedaste registrado como repartidor.\nCuando estés libre para tomar pedidos, escribí "disponible".`);
    return;
  }

  // Ver si el worker existe
  const worker = db.getWorker(phone);
  if (!worker) {
    await sendWithTyping(chat, `👋 Bienvenido al grupo de repartidores.\nPara empezar escribí "entrar" o "registrar".`);
    return;
  }

  // Disponible
  if (lower === 'disponible' || lower === 'libre') {
    const ok = db.markWorkerAvailable(phone);
    if (ok) {
      await sendWithTyping(chat, `✅ Ahora estás disponible para tomar pedidos.`);

      // Si hay pedidos pendientes, mostrar el más antiguo
      const pending = db.getPendingOrders();
      if (pending.length > 0) {
        const first = pending[0];
        const fecha = new Date(first.createdAt).toLocaleString();
        await sendWithTyping(chat, `📦 *Pedido #${first.id}* - ${fecha}\n📝 ${first.details}\n📱 Cliente\n🔗 ${first.link}\n\nPara tomarlo, escribí "tomar ${first.id}"`);
      }
    } else {
      await sendWithTyping(chat, `❌ No podés marcarte disponible mientras tenés un pedido activo.`);
    }
    return;
  }

  // Tomar pedido
  const tomarMatch = lower.match(/^tomar\s+(\d+)$/);
  if (tomarMatch) {
    const orderId = parseInt(tomarMatch[1]);
    const result = db.assignOrder(orderId, phone, senderName);
    if (result) {
      const order = db.getOrder(orderId);
      await sendWithTyping(chat, `✅ *Pedido #${orderId} asignado a ${senderName}*`);
      await safeSend(order.phone, `🛵 *Tu pedido #${orderId} fue asignado!*\nRepartidor: ${senderName}\n\n📝 ${order.details}\n📍 ${order.link}\n\nEstamos preparando tu pedido. Pronto lo tendrás.`);
      web.notifyClients();
    } else {
      await sendWithTyping(chat, `❌ El pedido #${orderId} ya no está disponible o no existe.`);
    }
    return;
  }

  // Listar pedidos pendientes
  if (lower === 'pedidos' || lower === 'lista') {
    const pending = db.getPendingOrders();
    if (pending.length === 0) {
      await sendWithTyping(chat, '✅ No hay pedidos pendientes.');
      return;
    }
    let response = `📋 *Pedidos pendientes:*\n`;
    for (const o of pending) {
      const fecha = new Date(o.createdAt).toLocaleString();
      response += `\n#${o.id} - ${fecha}\n📝 ${o.details}\n🔗 ${o.link}\n`;
    }
    await sendWithTyping(chat, response);
    return;
  }

  // Ver mi pedido activo
  if (lower === 'mi pedido' || lower === 'mi pedido') {
    const active = db.getActiveWorkerOrder(phone);
    if (!active) {
      await sendWithTyping(chat, '❌ No tenés ningún pedido activo.');
      return;
    }
    await sendWithTyping(chat, `📦 *Pedido #${active.id}* - ${active.status}\n📝 ${active.details}\n📍 ${active.link}\n🕐 ${new Date(active.createdAt).toLocaleString()}`);
    return;
  }

  // Ayuda
  if (lower === 'ayuda' || lower === 'comandos') {
    await sendWithTyping(chat, `📋 *Comandos para repartidores:*\n\n• "entrar" - Registrarse\n• "disponible" - Estar libre\n• "tomar #" - Tomar pedido\n• "pedidos" - Ver pendientes\n• "mi pedido" - Ver mi pedido activo\n• "ayuda" - Esta ayuda`);
    return;
  }
}

// ── HANDLER: CLIENTES ─────────────────────────

async function handleClientMessage(msg, chat, phone, text) {
  const lower = text.toLowerCase();
  const state = getState(phone);
  const history = getHistory(phone);

  // ── CANCELAR ────────────────────────────────
  if (lower === 'cancelar') {
    const actives = db.getActiveClientOrders(phone);
    if (actives.length === 0) {
      await sendWithTyping(chat, '❌ No tenés pedidos activos para cancelar.');
      return;
    }
    setState(phone, 'CONFIRMAR_CANCELAR', { orders: actives });
    let msg = '¿Cuál querés cancelar?\n';
    actives.forEach((o, i) => {
      msg += `\n${i + 1}. #${o.id} - ${o.details.substring(0, 30)}`;
    });
    msg += '\n\nRespondé con el número (1, 2, ...) o "ninguno".';
    await sendWithTyping(chat, msg);
    return;
  }

  if (state?.step === 'CONFIRMAR_CANCELAR') {
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || idx < 0 || idx >= state.data.orders.length) {
      await sendWithTyping(chat, '❌ Número inválido. Respondé con un número de la lista o "ninguno".');
      return;
    }
    const order = state.data.orders[idx];
    const oldStatus = db.cancelOrder(order.id, phone);
    if (oldStatus) {
      await sendWithTyping(chat, `✅ *Pedido #${order.id} cancelado.*`);
      if (isGroupConfigured()) {
        safeSend(config.GRUPO_WORKERS_ID, `❌ *Pedido #${order.id} cancelado* por el cliente.`);
      }
      web.notifyClients();
    } else {
      await sendWithTyping(chat, '❌ No se pudo cancelar el pedido.');
    }
    clearState(phone);
    return;
  }

  // ── INICIO / PEDIR ──────────────────────────
  if (lower === 'hola' || lower === 'pedir' || lower === 'menu' || lower === 'inicio') {
    const actives = db.getActiveClientOrders(phone);
    if (actives.length > 0) {
      let msg = '📋 *Tus pedidos activos:*\n';
      actives.forEach(o => {
        msg += `\n#${o.id} - ${o.details.substring(0, 30)} - ${o.status}`;
      });
      msg += '\n\n¿Querés hacer otro pedido? Escribí "pedir"';
      await sendWithTyping(chat, msg);
      return;
    }

    // Si tiene AI, le damos la bienvenida con AI
    if (isAiConfigured()) {
      await sendWithTyping(chat, tmpl.welcome(phone));
      return;
    }

    // Sin AI: flujo manual
    await sendWithTyping(chat, tmpl.welcome(phone));
    setState(phone, 'ESPERANDO_DETALLES');
    return;
  }

  // ── FLUJO SIN AI: ESPERANDO_DETALLES ────────
  if (state?.step === 'ESPERANDO_DETALLES') {
    setState(phone, 'ESPERANDO_UBICACION', { details: text });
    await sendWithTyping(chat, tmpl.pedirUbicacion());
    return;
  }

  if (state?.step === 'ESPERANDO_UBICACION') {
    // Si manda una ubicacion
    if (msg.location) {
      const orderId = db.createOrder({
        phone,
        details: state.data.details,
        link: `https://www.google.com/maps?q=${msg.location.latitude},${msg.location.longitude}`,
        lat: msg.location.latitude,
        lng: msg.location.longitude,
      });
      await sendWithTyping(chat, tmpl.orderCreated(orderId));
      if (isGroupConfigured()) {
        const order = db.getOrder(orderId);
        await safeSend(config.GRUPO_WORKERS_ID,
          `📦 *Nuevo pedido #${orderId}!*\n\n📝 ${order.details}\n📍 ${order.link}\n📱 Cliente\n\nPara tomarlo, escribí "tomar ${orderId}"`);
      }
      clearState(phone);
      web.notifyClients();
      return;
    }

    // Si manda un link (maps)
    if (text.startsWith('http')) {
      const orderId = db.createOrder({
        phone,
        details: state.data.details,
        link: text,
      });
      await sendWithTyping(chat, tmpl.orderCreated(orderId));
      if (isGroupConfigured()) {
        const order = db.getOrder(orderId);
        await safeSend(config.GRUPO_WORKERS_ID,
          `📦 *Nuevo pedido #${orderId}!*\n\n📝 ${order.details}\n📍 ${order.link}\n📱 Cliente\n\nPara tomarlo, escribí "tomar ${orderId}"`);
      }
      clearState(phone);
      web.notifyClients();
      return;
    }

    // Si manda texto como ubicación
    const orderId = db.createOrder({
      phone,
      details: state.data.details,
      link: `https://www.google.com/maps?q=${encodeURIComponent(text)}`,
    });
    await sendWithTyping(chat, tmpl.orderCreated(orderId));
    if (isGroupConfigured()) {
      const order = db.getOrder(orderId);
      await safeSend(config.GRUPO_WORKERS_ID,
        `📦 *Nuevo pedido #${orderId}!*\n\n📝 ${order.details}\n📍 ${order.link}\n📱 Cliente\n\nPara tomarlo, escribí "tomar ${orderId}"`);
    }
    clearState(phone);
    web.notifyClients();
    return;
  }

  // ── CON AI: manejo generico ─────────────────
  if (isAiConfigured() && lower !== 'cancelar') {
    const aiResponse = await ai.generateResponse({ phone, text, history });
    if (aiResponse) {
      // Detectar si la AI quiere crear un pedido
      if (aiResponse.action === 'crear_pedido') {
        const orderId = db.createOrder({
          phone,
          details: aiResponse.details || text,
          link: aiResponse.link || '',
          lat: aiResponse.lat,
          lng: aiResponse.lng,
        });
        await sendWithTyping(chat, tmpl.orderCreated(orderId));
        if (isGroupConfigured()) {
          const order = db.getOrder(orderId);
          await safeSend(config.GRUPO_WORKERS_ID,
            `📦 *Nuevo pedido #${orderId}!*\n\n📝 ${order.details}\n📍 ${order.link}\n📱 Cliente\n\nPara tomarlo, escribí "tomar ${orderId}"`);
        }
        web.notifyClients();
        return;
      }
      await sendWithTyping(chat, aiResponse.text || aiResponse);
      return;
    }
  }

  // ── POR DEFECTO ─────────────────────────────
  if (!state) {
    await sendWithTyping(chat, tmpl.defaultMsg(phone));
  }
}

// ── INICIO ───────────────────────────────────
console.log('🚀 Iniciando bot de delivery...\n');

web.start(config.WEB_PANEL_PORT);

client.initialize();
