# Use the official Puppeteer image which includes Node.js and all Chromium dependencies
FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to ensure we can create directories and set permissions
USER root

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application source code
COPY . .

# Change ownership of the app directory to pptruser
RUN chown -R pptruser:pptruser /app

# Switch back to the non-root user provided by the Puppeteer image
USER pptruser

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
