#!/bin/bash
set -e

echo "======================================="
echo "  DeliveryBot - Instalacion en Oracle"
echo "======================================="

# 1. Actualizar e instalar Docker si no existe
if ! command -v docker &> /dev/null; then
  echo "[1/5] Instalando Docker..."
  sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
  sudo usermod -aG docker ubuntu
else
  echo "[1/5] Docker ya instalado"
fi

# 2. Clonar repositorio si no existe
REPO_DIR="$HOME/deliverybot"
if [ ! -d "$REPO_DIR" ]; then
  echo "[2/5] Descargando codigo..."
  cd "$HOME"
  git clone https://github.com/automatizaciones54-dot/deliverybot.git deliverybot
fi

cd "$REPO_DIR"

# 3. Crear archivo .env
if [ ! -f .env ]; then
  echo "[3/5] Creando archivo .env"
  read -p "GRUPO_WORKERS_ID (ID del grupo de WhatsApp): " GRUPO_ID
  read -p "GEMINI_API_KEY (dejá vacío si usás OpenAI): " GEMINI_KEY
  read -p "OPENAI_API_KEY (dejá vacío si usás Gemini): " OPENAI_KEY
  read -p "WEB_PANEL_PIN (PIN del panel web): " PIN

  cat > .env << EOF
GRUPO_WORKERS_ID=${GRUPO_ID:-120363427390428113@g.us}
AI_PROVIDER=$([ -n "$GEMINI_KEY" ] && echo "gemini" || echo "openai")
GEMINI_API_KEY=$GEMINI_KEY
OPENAI_API_KEY=$OPENAI_KEY
WEB_PANEL_PIN=${PIN:-1234}
EOF

  echo ".env creado"
else
  echo "[3/5] .env ya existe"
fi

# 4. Buildear e iniciar
echo "[4/5] Construyendo imagen e iniciando..."
sudo docker compose up -d --build

# 5. Mostrar QR
echo "[5/5] Esperando QR de WhatsApp..."
echo ""
echo "======================================="
echo "  IMPORTANTE: Escaneá el QR en 60 seg"
echo "======================================="
sleep 5
sudo docker logs deliverybot --tail 50 2>&1 | grep -A 5 "QR" || \
  echo "Esperando QR... ejecutá: docker logs deliverybot -f"

echo ""
echo "✅ Instalación completada"
echo "📱 Panel web: http://$(curl -s ifconfig.me):3000"
echo "📋 Para ver QR: docker logs deliverybot -f"
echo "🔄 Para reiniciar: docker compose restart"
echo "📝 Para editar configuración: nano $REPO_DIR/.env"
