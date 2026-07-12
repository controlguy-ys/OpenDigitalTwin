FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@11.4.2 \
    && npm ci --omit=dev \
    && npm cache clean --force
COPY middleware ./middleware
USER node
EXPOSE 4841 8081
CMD ["node", "middleware/opcua-connector.mjs"]
