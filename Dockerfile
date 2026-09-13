FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run setup:assets && npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3188 DATABASE_PATH=/app/data/gallery.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 3188
VOLUME ["/app/data"]
CMD ["node", "dist-server/index.js"]
