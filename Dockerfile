FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

RUN mkdir -p /data

ENV DB_PATH=/data/database.json
EXPOSE 8080

CMD ["node", "index.js"]
