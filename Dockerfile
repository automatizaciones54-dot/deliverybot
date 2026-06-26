FROM node:22-slim

RUN apt-get update && apt-get install -y git ca-certificates --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ && npm ci
COPY . .

RUN mkdir -p /data

ENV DB_PATH=/data/database.json
EXPOSE 8080

CMD ["node", "index.js"]
