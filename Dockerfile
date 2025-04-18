# syntax=docker/dockerfile:1

FROM ghcr.io/puppeteer/puppeteer:22

ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_BIN=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm i           # deterministic, faster
COPY . .

EXPOSE 8080
CMD ["node", "index.js"]