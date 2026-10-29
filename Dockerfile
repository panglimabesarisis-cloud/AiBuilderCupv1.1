FROM node:20-slim

WORKDIR /app

# Install dependencies needed for node-gyp if any (kept minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package descriptors
COPY package*.json ./

# Install all dependencies (including devDependencies required for Vite build and tsx)
RUN npm ci

# Copy application source code
COPY . .

# Build the Vite frontend into dist
RUN npm run build

# Cloud Run injects PORT environment variable
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Start server using tsx
CMD ["npm", "run", "start"]
