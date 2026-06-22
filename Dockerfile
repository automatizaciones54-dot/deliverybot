FROM node:22-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

RUN groupadd -r appuser && useradd -r -g appuser appuser \
    && mkdir -p /app/.wwebjs_auth /app/data \
    && chown -R appuser:appuser /app

USER appuser
VOLUME ["/app/.wwebjs_auth", "/app/data"]
EXPOSE 3000

ENV DB_PATH=/app/data/database.json

CMD ["node", "index.js"]
