FROM node:20-bullseye-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 5000

ENV PORT=5000
ENV HOST=0.0.0.0

CMD ["node", "server.js"]
