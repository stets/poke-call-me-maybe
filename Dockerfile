FROM node:20-slim

# Install curl for healthchecks
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Install supergateway and telnyx-mcp globally
RUN npm install -g supergateway telnyx-mcp

# Copy server code
COPY server.js ./

EXPOSE 3000

# Environment variables (set at runtime)
ENV TELNYX_API_KEY=""
ENV TELNYX_PUBLIC_KEY=""
ENV MCP_API_KEY=""
ENV PORT=3000

CMD ["node", "server.js"]
