# Use a Node image that comes with Chrome dependencies pre-installed
FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to handle permissions
USER root

# Set the working directory
WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm ci --verbose

# Copy the rest of your code
COPY . .

# Ensure the storage directory exists and has permissions
RUN mkdir -p saved_sites && chmod -R 777 saved_sites

# Use the port Railway provides
ENV PORT=5000
EXPOSE 5000

# Start the server
CMD ["node", "server.js"]