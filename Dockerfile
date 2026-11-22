FROM node:22-alpine

WORKDIR /app

# Copy only production runtime files (zero npm dependencies required)
COPY package.json ./
COPY src ./src

# Run as non-root user for container security
USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/status || exit 1

CMD ["node", "src/server.js"]
