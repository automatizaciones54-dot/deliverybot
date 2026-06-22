FROM node:22-bookworm

RUN apt-get update && apt-get install -y \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libatspi2.0-0 libxshmfence1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

RUN mkdir -p /data /data/.wwebjs_auth

ENV DB_PATH=/data/database.json \
    LOCAL_AUTH_PATH=/data/.wwebjs_auth

EXPOSE 8080

CMD ["node", "index.js"]
