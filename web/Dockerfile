FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY migrations ./migrations
ENV NODE_ENV=production KEY_DIR=/data/keys
EXPOSE 3000
CMD ["node", "src/server.js"]
