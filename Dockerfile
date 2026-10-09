ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json .npmrc ./
RUN npm ci --registry=${NPM_REGISTRY} --include=dev --include=optional
COPY . .
RUN npm run typecheck && npm test && npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    SKILLHUB_PORT=3356 \
    SKILLHUB_HOST=0.0.0.0 \
    SKILLHUB_DATA_DIR=/data \
    CLOUDFLARE_CF_FETCH_ENABLED=false \
    WRANGLER_SEND_METRICS=false \
    NO_COLOR=1
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/tests ./tests
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /data /app/.sites-runtime && chown -R node:node /data /app/.sites-runtime
USER node
EXPOSE 3356
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3356/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/self-host.mjs migrate && exec node scripts/self-host.mjs serve"]
