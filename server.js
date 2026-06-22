const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./database');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

let mpClient = null;
if (config.MERCADO_PAGO_ACCESS_TOKEN) {
  mpClient = new MercadoPagoConfig({ accessToken: config.MERCADO_PAGO_ACCESS_TOKEN });
}

function notifyClients() {
  io.emit('orders', db.getAllOrders());
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Delivery Panel</title>
<script src="/socket.io/socket.io.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,sans-serif}
body{background:#f0f2f5;padding:16px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.header h1{font-size:20px;color:#1a1a2e}
.filtros{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.filtros button{padding:6px 14px;border:1px solid #ddd;border-radius:20px;background:#fff;cursor:pointer;font-size:13px}
.filtros button.activo{background:#1a1a2e;color:#fff;border-color:#1a1a2e}
.order{background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.order h3{font-size:14px;color:#1a1a2e;margin-bottom:6px}
.order .detalle{color:#555;font-size:13px;margin-bottom:6px}
.order .meta{font-size:12px;color:#888;margin-bottom:8px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge.pendiente{background:#fff3cd;color:#856404}
.badge.asignado{background:#cce5ff;color:#004085}
.badge.en_camino{background:#d4edda;color:#155724}
.badge.entregado{background:#d1e7dd;color:#0f5132}
.badge.cancelado{background:#f8d7da;color:#721c24}
.acciones{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.acciones button{padding:6px 12px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600}
.btn-camino{background:#cce5ff;color:#004085}
.btn-entregar{background:#d4edda;color:#155724}
.btn-pago{background:#e8daef;color:#6c3483}
.btn-pago:disabled{opacity:.5;cursor:default}
.vacio{text-align:center;color:#888;padding:40px 0;font-size:14px}
#login{position:fixed;inset:0;background:#1a1a2e;display:flex;align-items:center;justify-content:center;z-index:999}
#login form{background:#fff;padding:24px;border-radius:12px;width:280px;text-align:center}
#login input{width:100%;padding:10px;margin:10px 0;border:1px solid #ddd;border-radius:8px;font-size:16px;text-align:center}
#login button{width:100%;padding:10px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer}
#login .error{color:#dc3545;font-size:13px;margin-top:6px}
</style>
</head>
<body>
<div id="login">
  <form onsubmit="return login(this)">
    <h2 style="margin-bottom:12px;color:#1a1a2e">🔐 Delivery Panel</h2>
    <input type="password" id="pin" placeholder="PIN" required>
    <button type="submit">Entrar</button>
    <div class="error" id="loginError"></div>
  </form>
</div>
<div id="app" style="display:none">
  <div class="header">
    <h1>📦 Pedidos</h1>
    <span id="total" style="font-size:13px;color:#888"></span>
  </div>
  <div class="filtros" id="filtros">
    <button onclick="filtrar('todas')" class="activo" data-filtro="todas">Todas</button>
    <button onclick="filtrar('pendiente')" data-filtro="pendiente">Pendientes</button>
    <button onclick="filtrar('asignado')" data-filtro="asignado">Asignados</button>
    <button onclick="filtrar('en_camino')" data-filtro="en_camino">En camino</button>
    <button onclick="filtrar('entregado')" data-filtro="entregado">Entregados</button>
    <button onclick="filtrar('cancelado')" data-filtro="cancelado">Cancelados</button>
  </div>
  <div id="lista"></div>
</div>
<script>
const PIN = '';
let filtroActual = 'todas';
let orders = [];

function login(f) {
  const pin = f.querySelector('#pin').value;
  fetch('/api/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})})
    .then(r=>r.json()).then(d=>{
      if(d.ok){document.getElementById('login').style.display='none';document.getElementById('app').style.display='block'}
      else document.getElementById('loginError').textContent='PIN incorrecto'
    });
  return false;
}

function filtrar(f) {
  filtroActual = f;
  document.querySelectorAll('#filtros button').forEach(b=>b.classList.toggle('activo',b.dataset.filtro===f));
  render();
}

function estadoTexto(s) {
  const map={pendiente:'Pendiente',asignado:'Asignado',en_camino:'En camino',entregado:'Entregado',cancelado:'Cancelado'};
  return map[s]||s;
}

function render() {
  const filtradas = filtroActual==='todas' ? orders : orders.filter(o=>o.status===filtroActual);
  document.getElementById('total').textContent = filtradas.length+' pedidos';
  const lista = document.getElementById('lista');
  if(!filtradas.length){lista.innerHTML='<div class="vacio">📭 No hay pedidos</div>';return}
  lista.innerHTML = filtradas.map(o=>{
    const fecha = new Date(o.createdAt).toLocaleString();
    const cliente = (o.phone||'').replace(/@.*$/,'');
    return \`<div class="order">
      <h3>#\${o.id} <span class="badge \${o.status}">\${estadoTexto(o.status)}</span>\${o.pagado?' <span class="badge entregado">✅ Pagado</span>':''}</h3>
      <div class="detalle">\${o.details}</div>
      <div class="meta">📱 \${cliente} | 🕐 \${fecha}\${o.workerName?' | 👤 '+o.workerName:''}</div>
      <div class="meta">📍 <a href="\${o.link}" target="_blank">Ver mapa</a></div>
      \${accionesHtml(o)}</div>\`;
  }).join('');
}

function accionesHtml(o) {
  let btns = '';
  if(o.status==='pendiente') btns += '<button class="btn-camino" onclick="liberar('+o.id+')">🔄 Liberar</button>';
  if(o.status==='asignado') btns += '<button class="btn-camino" onclick="marcarCamino('+o.id+')">🚚 En camino</button>';
  if(o.status==='en_camino') btns += '<button class="btn-entregar" onclick="marcarEntregado('+o.id+')">✅ Entregar</button>';
  const tienePago = o.paymentLink && o.paymentLink!=='';
  btns += '<button class="btn-pago" onclick="generarPago('+o.id+')" '+(tienePago?'disabled':'')+'>'+(tienePago?'💳 Link generado':'💰 Link pago')+'</button>';
  if(o.pagado) {
    btns += ' <span class="badge entregado" style="vertical-align:middle">✅ Pagado</span>';
  } else if(o.status==='asignado'||o.status==='en_camino'||o.status==='entregado') {
    btns += ' <button class="btn-entregar" onclick="confirmarPago('+o.id+')" style="background:#d1e7dd;color:#0f5132">💰 Confirmar pago</button>';
  }
  return '<div class="acciones">'+btns+'</div>';
}

function marcarCamino(id) {
  fetch('/api/order/'+id+'/camino',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.ok)fetchOrders()});
}
function marcarEntregado(id) {
  fetch('/api/order/'+id+'/entregar',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.ok)fetchOrders()});
}
function liberar(id) {
  fetch('/api/order/'+id+'/liberar',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.ok)fetchOrders()});
}
function confirmarPago(id) {
  fetch('/api/order/'+id+'/pago/confirmar',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.ok)fetchOrders()});
}
function generarPago(id) {
  fetch('/api/order/'+id+'/pago',{method:'POST'}).then(r=>r.json()).then(d=>{
    if(d.ok&&d.link) navigator.clipboard.writeText(d.link).then(()=>alert('✅ Link copiado al portapapeles'));
    fetchOrders();
  });
}
function fetchOrders() {
  fetch('/api/orders').then(r=>r.json()).then(d=>{orders=d;render()});
}
const socket = io();
socket.on('orders', d=>{orders=d;render()});
setTimeout(fetchOrders, 500);
</script>
</body>
</html>`;

app.get('/qr.png', (req, res) => {
  const p = path.join(__dirname, 'qr.png');
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).type('text').send('⚠️ QR no disponible aún. Revisá los logs del deploy.');
});

app.get('/', (req, res) => {
  res.send(DASHBOARD_HTML);
});

app.post('/api/login', (req, res) => {
  res.json({ ok: req.body.pin === config.WEB_PANEL_PIN });
});

app.get('/api/orders', (req, res) => {
  res.json(db.getAllOrders());
});

app.post('/api/order/:id/camino', (req, res) => {
  const ok = db.markAsEnCamino(parseInt(req.params.id));
  if (ok) { notifyClients(); emitEvent('camino', parseInt(req.params.id)); }
  res.json({ ok });
});

app.post('/api/order/:id/entregar', (req, res) => {
  const ok = db.markAsEntregado(parseInt(req.params.id));
  if (ok) { notifyClients(); emitEvent('entregado', parseInt(req.params.id)); }
  res.json({ ok });
});

app.post('/api/order/:id/pago', async (req, res) => {
  const orderId = parseInt(req.params.id);
  const order = db.getOrder(orderId);
  if (!order) return res.json({ ok: false });

  if (order.paymentLink) return res.json({ ok: true, link: order.paymentLink });

  if (!mpClient) return res.json({ ok: false, error: 'Mercado Pago no configurado' });

  try {
    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: [{
          title: 'Pedido #' + orderId,
          description: order.details.substring(0, 40),
          quantity: 1,
          unit_price: 1,
          currency_id: 'ARS',
        }],
        payer: { email: 'comprador@email.com' },
        back_urls: {
          success: 'http://localhost:' + config.WEB_PANEL_PORT + '/',
          failure: 'http://localhost:' + config.WEB_PANEL_PORT + '/',
          pending: 'http://localhost:' + config.WEB_PANEL_PORT + '/',
        },
        auto_return: 'approved',
      }
    });
    const link = result.init_point || result.sandbox_init_point || '';
    if (link) {
      db.updateOrderPayment(orderId, link);
      notifyClients();
      return res.json({ ok: true, link });
    }
    res.json({ ok: false });
  } catch (err) {
    console.error('Error MP:', err.message);
    res.json({ ok: false });
  }
});

app.post('/api/order/:id/pago/confirmar', (req, res) => {
  const ok = db.markPaymentConfirmed(parseInt(req.params.id));
  if (ok) notifyClients();
  res.json({ ok });
});

app.post('/api/order/:id/liberar', (req, res) => {
  const ok = db.releaseOrderAdmin(parseInt(req.params.id));
  if (ok) notifyClients();
  res.json({ ok });
});

let eventCallback = null;

function onEvent(cb) {
  eventCallback = cb;
}

function emitEvent(type, orderId) {
  if (eventCallback) eventCallback(type, orderId);
}

io.on('connection', (socket) => {
  socket.emit('orders', db.getAllOrders());
});

function start(port) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Panel web: http://0.0.0.0:${port}`);
  });
}

module.exports = { start, notifyClients, onEvent };
