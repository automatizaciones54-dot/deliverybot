const config = require('./config');

let generateResponse;

const SYSTEM_PROMPT = `Sos un asistente virtual de delivery con tono CALUROSO y PROFESIONAL.

=== FLUJO DEL SISTEMA ===
1. Cliente pide algo → bot captura y pide ubicación
2. Cliente comparte ubicación → bot crea pedido y lo publica
3. Repartidor toma pedido → bot notifica al cliente
4. Repartidor marca en camino → bot avisa
5. Repartidor marca entregado → bot agradece

=== ESTADOS DEL USUARIO ===
- awaiting_order: el bot ya pidió qué quiere, debe responder con su pedido
- awaiting_location: ya dijo qué quiere, debe compartir ubicación
- awaiting_cancel_id: tiene varios pedidos, debe elegir cuál cancelar

=== REGLAS ===
- Respondé MÁXIMO 2 líneas
- Tonos: "che", "querido", "genial", "dale", "tranqui"
- Si está en awaiting_location, NO preguntes qué quiere, pedí ubicación
- Si tiene pedidos activos, ofrecé "cancelar" o "estado"
- NUNCA inventes números de pedido, precios ni repartidores
- Si no sabés algo, decí "Hablá con el administrador"
- Siempre agradecé al final si corresponde`;

function buildPrompt(userMessage, context) {
  const { step, hasActiveOrders, history } = context || {};
  let ctx = [];
  if (step === 'awaiting_order') ctx.push('ESTADO: esperando que diga QUÉ quiere pedir.');
  else if (step === 'awaiting_location') ctx.push('ESTADO: ya pidió algo, esperando UBICACIÓN. NO preguntes qué quiere.');
  else if (step === 'awaiting_cancel_id') ctx.push('ESTADO: eligiendo qué cancelar.');
  else ctx.push('ESTADO: conversación libre.');
  if (hasActiveOrders) ctx.push('TIENE PEDIDOS ACTIVOS.');

  let historyText = '';
  if (history && history.length > 0) {
    for (const h of history.slice(-4)) {
      historyText += `${h.role === 'user' ? 'U' : 'B'}: ${h.text}\n`;
    }
  }

  return `${SYSTEM_PROMPT}\n\n=== CONTEXTO ===\n${ctx.join(' ')}\n${historyText}\n\nMensaje: "${userMessage}"\n\nRespondé:`;
}

// ── GEMINI ────────────────────────────────
if (config.AI_PROVIDER === 'gemini' && config.GEMINI_API_KEY) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  let cooldownUntil = 0;

  generateResponse = async function (userMessage, context) {
    if (Date.now() < cooldownUntil) return null;
    try {
      const result = await model.generateContent(buildPrompt(userMessage, context));
      const text = result.response.text().trim();
      if (!text) return null;
      return text.substring(0, 500);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('429') || msg.includes('quota') || msg.includes('Quota')) {
        cooldownUntil = Date.now() + 180000;
        console.log('⏳ Gemini: cuota agotada, salteando IA por 3 min');
      } else if (msg.includes('SAFETY')) {
        console.log('⚠️ Gemini: bloqueado por seguridad');
      } else {
        console.error('Error Gemini:', msg.substring(0, 80));
      }
      return null;
    }
  };
}

// ── OPENAI ────────────────────────────────
if (config.AI_PROVIDER === 'openai' && config.OPENAI_API_KEY) {
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  generateResponse = async function (userMessage, context) {
    try {
      const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
      const { history } = context || {};
      if (history && history.length > 0) {
        for (const h of history.slice(-4)) {
          messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text });
        }
      }
      messages.push({ role: 'user', content: userMessage });

      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 200,
      });
      const text = resp.choices?.[0]?.message?.content?.trim();
      if (!text) return null;
      return text.substring(0, 500);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('429') || msg.includes('insufficient_quota') || msg.includes('rate')) {
        console.log('⏳ OpenAI: límite alcanzado, salteando IA');
      } else {
        console.error('Error OpenAI:', msg.substring(0, 80));
      }
      return null;
    }
  };
}

if (!generateResponse) {
  generateResponse = async () => null;
}

module.exports = { generateResponse };