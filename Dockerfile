# Use official Puppeteer image (includes Node.js, Chromium & pptruser user)
# Pinned to match the puppeteer npm dependency (^25.1.0) — avoid `:latest` so
# Chromium/Node don't drift out from under PDF rendering unexpectedly.
FROM ghcr.io/puppeteer/puppeteer:25.3.0

# Set working directory
WORKDIR /app

# Set Puppeteer cache directory environment variable
ENV PUPPETEER_CACHE_DIR=/home/pptruser/.cache/puppeteer

# Copy package files with correct ownership directly (eliminates separate chown step)
COPY --chown=pptruser:pptruser package*.json ./

# Install production dependencies only (skip devDependencies like nodemon)
RUN npm ci --omit=dev

# Copy application source code with correct ownership directly
COPY --chown=pptruser:pptruser . .

# Expose application port
EXPOSE 3000

# Verify the app is responding, not just that the process is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start application directly so Node receives signals as PID 1
CMD ["node", "src/index.js"]
