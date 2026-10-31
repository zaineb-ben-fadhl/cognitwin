# One container serving the web app and the (optional) LLM coach API on the same origin.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/sync-camera-assets.mjs ./scripts/sync-camera-assets.mjs
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production API_PORT=8787
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/engine ./src/engine
COPY --from=build /app/tsconfig.json ./
EXPOSE 8787
USER node
CMD ["npx", "tsx", "server/index.ts"]
