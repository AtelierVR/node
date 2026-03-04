# Stage 1: Build typescript to javascript
FROM node:24-alpine3.21 AS build

# Install build dependencies
RUN apk add --no-cache python3 py3-pip build-base

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
COPY tsconfig.json ./

# Install dependencies with exact versions and clean cache
RUN npm ci --ignore-scripts && npm cache clean --force

# Copy Prisma schema and generate client
COPY ./prisma ./prisma
RUN npm run generate

# Copy source code and build
COPY ./src ./src
COPY ./schemas ./schemas
COPY ./tools ./tools
COPY ./templates ./templates
RUN npm run build

# Stage 2: Development runtime
FROM node:24-alpine3.21 AS development

# Install runtime dependencies and build tools
RUN apk add --no-cache python3 py3-pip build-base python3-dev && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy Python requirements and install in virtual environment
COPY requirements.txt ./
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --upgrade --no-cache-dir setuptools>=78.1.1 && \
    /opt/venv/bin/pip install --no-cache-dir --no-compile -r requirements.txt && \
    rm -rf ~/.cache/pip

# Add virtual environment to PATH
ENV PATH="/opt/venv/bin:$PATH"

# Copy package files and install all dependencies (including dev)
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts && npm cache clean --force

# Copy Prisma schema and generate client
COPY ./prisma ./prisma
RUN npm run generate

# Copy all source files for development
COPY ./src ./src
COPY ./public ./public
COPY ./schemas ./schemas
COPY ./templates ./templates
COPY ./tools ./tools

ENV NODE_ENV=development

EXPOSE 3000

CMD ["npm", "run", "dev"]

# Stage 3: Dependencies
FROM node:24-alpine3.21 AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Stage 4: Production runtime
FROM node:24-alpine3.21 AS production

# Install runtime dependencies and build tools needed for Python packages
RUN apk add --no-cache python3 py3-pip build-base python3-dev && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy Python requirements and install in virtual environment
COPY requirements.txt ./
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --upgrade --no-cache-dir setuptools>=78.1.1 && \
    /opt/venv/bin/pip install --no-cache-dir --no-compile -r requirements.txt && \
    rm -rf ~/.cache/pip

# Add virtual environment to PATH
ENV PATH="/opt/venv/bin:$PATH"

# Create user and group early to use --chown during COPY operations
RUN addgroup -g 1001 -S nodejs && \
    adduser -S noxuser -u 1001 -G nodejs

# Copy production node_modules with proper ownership
COPY --from=deps --chown=noxuser:nodejs /app/node_modules ./node_modules
COPY --chown=noxuser:nodejs package.json ./

# Copy built application and necessary runtime files with proper ownership
COPY --from=build --chown=noxuser:nodejs /app/dist ./dist
COPY --from=build --chown=noxuser:nodejs /app/prisma ./prisma
COPY --from=build --chown=noxuser:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=noxuser:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Copy runtime files with proper ownership
COPY --chown=noxuser:nodejs ./public ./public
COPY --chown=noxuser:nodejs ./schemas ./schemas
COPY --chown=noxuser:nodejs ./templates ./templates
COPY --chown=noxuser:nodejs ./tools ./tools

# Prisma client is already generated in build stage, no need to regenerate

# For Docker socket access on Windows/Docker Desktop, we need to run as root
# The application will handle dropping privileges where appropriate

# Expose port (adjust if different)
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node ./tools/healthcheck.js || exit 1

CMD ["npm", "run", "start"]
