# Use the official Puppeteer image which includes Node.js and all Chromium dependencies
FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to ensure we can create directories and set permissions
USER root

# Set working directory
WORKDIR /app

# Set Puppeteer cache directory environment variable
ENV PUPPETEER_CACHE_DIR=/home/pptruser/.cache/puppeteer

# Ensure cache directory exists and is owned by pptruser before/after npm ci
RUN mkdir -p /home/pptruser/.cache/puppeteer && chown -R pptruser:pptruser /home/pptruser/.cache

# Copy package files
COPY package*.json ./

# Install dependencies (runs as root, downloads Chrome to PUPPETEER_CACHE_DIR)
RUN npm ci

# Copy application source code
COPY . .

# Change ownership of the app directory and Puppeteer cache directory to pptruser
RUN chown -R pptruser:pptruser /app && chown -R pptruser:pptruser /home/pptruser/.cache

# Switch back to the non-root user provided by the Puppeteer image
USER pptruser

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
