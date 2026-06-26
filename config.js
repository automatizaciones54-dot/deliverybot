module.exports = {
  // ── GRUPO DE WHATSAPP ──
  GRUPO_WORKERS_ID: process.env.GRUPO_WORKERS_ID || '',

  // ── INTELIGENCIA ARTIFICIAL ──
  AI_PROVIDER: process.env.AI_PROVIDER || 'gemini',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',

  // ── PANEL WEB ──
  WEB_PANEL_PORT: parseInt(process.env.PORT || process.env.WEB_PANEL_PORT || '3000', 10),
  WEB_PANEL_PIN: process.env.WEB_PANEL_PIN || '',

  // ── MERCADO PAGO (opcional) ──
  MERCADO_PAGO_ACCESS_TOKEN: process.env.MERCADO_PAGO_ACCESS_TOKEN || '',

  // ── SESIÓN (baileys) ──
  AUTH_PATH: process.env.LOCAL_AUTH_PATH || process.env.AUTH_PATH || '.wwebjs_auth',
};
