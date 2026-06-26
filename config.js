module.exports = {
  GRUPO_WORKERS_ID: process.env.GRUPO_WORKERS_ID || '',
  AI_PROVIDER: process.env.AI_PROVIDER || 'gemini',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  WEB_PANEL_PORT: parseInt(process.env.PORT || process.env.WEB_PANEL_PORT || '3000', 10),
  WEB_PANEL_PIN: process.env.WEB_PANEL_PIN || '',
  MERCADO_PAGO_ACCESS_TOKEN: process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
  AUTH_PATH: process.env.LOCAL_AUTH_PATH || process.env.AUTH_PATH || '.wwebjs_auth',
  BUSINESS_HOURS_START: process.env.BUSINESS_HOURS_START || '8',
  BUSINESS_HOURS_END: process.env.BUSINESS_HOURS_END || '22',
};
