module.exports = {
  // ── GRUPO DE WHATSAPP ──
  // Pone el ID de tu grupo de repartidores aca
  // Escribi !id en el grupo para obtenerlo
  GRUPO_WORKERS_ID: process.env.GRUPO_WORKERS_ID || '120363427390428113@g.us',

  // ── INTELIGENCIA ARTIFICIAL ──
  AI_PROVIDER: process.env.AI_PROVIDER || 'gemini', // 'gemini' | 'openai'
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',

  // ── NAVEGADOR ──
  NAVEGADOR_PATH: process.env.NAVEGADOR_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  PUPPETEER_HEADLESS: process.env.PUPPETEER_HEADLESS !== 'false',

  // ── PANEL WEB ──
  WEB_PANEL_PORT: parseInt(process.env.PORT || process.env.WEB_PANEL_PORT || '3000', 10),
  WEB_PANEL_PIN: process.env.WEB_PANEL_PIN || '1234',

  // ── MERCADO PAGO (opcional) ──
  MERCADO_PAGO_ACCESS_TOKEN: process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
};
