FROM node:22-alpine AS base

RUN apk add --no-cache libc6-compat python3 py3-pip py3-virtualenv gcc g++ musl-dev python3-dev git
COPY requirements.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
# The AtelierVR/UnityPy fork uses Git LFS for lzma.tpk — pip clone doesn't pull LFS objects,
# so we download the actual binary directly from GitHub's LFS CDN.
RUN TPK=$(python3 -c "import glob; print(glob.glob('/opt/venv/lib/python*/site-packages/UnityPy/resources/lzma.tpk')[0])") \
    && wget -q -O "$TPK" "https://media.githubusercontent.com/media/AtelierVR/UnityPy/refs/heads/master/UnityPy/resources/lzma.tpk"
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHON3_BIN=/opt/venv/bin/python3
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package*.json ./
RUN npm ci

# Development stage
FROM base AS development
ENV NODE_ENV=development
EXPOSE 8080

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production stage
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1000 nodejs && adduser --system --uid 1000 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY config.yaml ./config.yaml
COPY --chown=nestjs:nodejs tools/ ./tools/
USER nestjs
EXPOSE 8080
CMD ["node", "dist/main"]
