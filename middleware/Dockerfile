FROM node:22-alpine AS gateway-build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@11.4.2 \
    && npm ci \
    && npm cache clean --force
COPY tsconfig.gateway.json ./
COPY src/core ./src/core
COPY middleware/runtime-gateway ./middleware/runtime-gateway
RUN npm run build:gateway

FROM node:22-alpine AS runtime

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@11.4.2 \
    && npm ci --omit=dev \
    && npm cache clean --force
COPY --from=gateway-build --chown=node:node /app/dist-gateway ./dist-gateway
USER node
EXPOSE 8081 4841
CMD ["node", "dist-gateway/middleware/runtime-gateway/main.js"]
