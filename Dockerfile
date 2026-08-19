# name=Dockerfile
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies (production only)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Ensure data dir exists and is writable
RUN mkdir -p /app/data && chown -R node:node /app/data

ENV NODE_ENV=production
EXPOSE 3000

# Run as non-root user
USER node

CMD ["node", "server/index.js"]
