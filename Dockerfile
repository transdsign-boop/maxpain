# Multi-stage Dockerfile for Aster DEX Liquidations Dashboard
# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for canvas
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies for canvas
RUN apk add --no-cache \
    cairo \
    jpeg \
    pango \
    giflib \
    pixman

# Install production dependencies only
COPY package*.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm ci --omit=dev

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy necessary config files
COPY --from=builder /app/server ./server

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/strategies', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

# Set production environment
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
