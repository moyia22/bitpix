FROM node:22.16-alpine AS builder

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

ARG NEXT_PUBLIC_API_URL=https://bitpix.nextfy.pro/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

ENV DATABASE_URL=postgresql://generate:generate@localhost:5432/generate

COPY package.json package-lock.json* turbo.json tsconfig.base.json eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci

COPY . .
RUN npm run db:generate && npm run build

FROM node:22.16-alpine AS runtime
RUN apk add --no-cache libc6-compat openssl wget dumb-init
WORKDIR /app
ENV NODE_ENV=production

# node:alpine já inclui o usuário não-root "node" (uid 1000).
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps ./apps
COPY --from=builder --chown=node:node /app/packages ./packages
COPY --from=builder --chown=node:node /app/turbo.json ./turbo.json
COPY --from=builder --chown=node:node /app/tsconfig.base.json ./tsconfig.base.json

USER node

# Healthcheck padrão da API; o serviço web sobrescreve no compose.
HEALTHCHECK --interval=15s --timeout=4s --start-period=30s --retries=6 \
  CMD wget --quiet --tries=1 --spider http://localhost:3333/health/live || exit 1

# dumb-init garante encaminhamento de sinais para shutdown gracioso.
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "--workspace", "@bitpix/api", "run", "start"]
