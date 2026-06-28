FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 5000

ENV PORT=5000
ENV HOST=0.0.0.0

CMD ["node", "server.js"]
