FROM node:20-slim

# Install Python and uv for running the Telnyx MCP server
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Install supergateway globally
RUN npm install -g supergateway

# Pre-cache the Telnyx MCP server
RUN uvx --from git+https://github.com/team-telnyx/telnyx-mcp-server.git telnyx-mcp-server --list-tools || true

# Copy server code
COPY server.js ./

EXPOSE 3000

# Environment variables (set at runtime)
ENV TELNYX_API_KEY=""
ENV MCP_API_KEY=""
ENV PORT=3000

CMD ["node", "server.js"]
