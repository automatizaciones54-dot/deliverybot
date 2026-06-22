FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

RUN mkdir -p /data /data/.wwebjs_auth

ENV DB_PATH=/data/database.json \
    LOCAL_AUTH_PATH=/data/.wwebjs_auth

EXPOSE 8080

CMD ["node", "index.js"]
