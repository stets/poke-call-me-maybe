# Deployment Guide - Telnyx MCP Server

## Goal
Deploy the Telnyx MCP Server to the home server and expose it via Cloudflare Tunnel at `telnyx.example.com`.

## Current Progress
- [x] Auth proxy server created (`server.js`)
- [x] Docker + docker-compose configured
- [x] Tested locally with ngrok - working!
- [x] Pushed to GitHub (private repo)
- [ ] Deploy to server via Dockge
- [ ] Set up Cloudflare Tunnel

## Server Details
- **IP**: 192.168.1.100
- **Hostname**: claude
- **Dockge**: Running on port 5001
- **Stacks directory**: `/opt/stacks/`
- **Cloudflared**: Already installed and running
- **Target domain**: `telnyx.example.com`

## Environment Variables Needed
```bash
TELNYX_API_KEY=your-telnyx-api-key
MCP_API_KEY=your-mcp-api-key
PORT=3000
```

## Deployment Steps

### 1. Create the stack directory
```bash
sudo mkdir -p /opt/stacks/telnyx-mcp-server
sudo chown $USER:$USER /opt/stacks/telnyx-mcp-server
cd /opt/stacks/telnyx-mcp-server
```

### 2. Clone or copy files
Option A - Clone from GitHub:
```bash
git clone https://github.com/youruser/poke-call-me-maybe.git .
```

Option B - Copy docker-compose.yml directly:
```bash
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  telnyx-mcp:
    build: .
    container_name: telnyx-mcp-server
    ports:
      - "3000:3000"
    environment:
      - TELNYX_API_KEY=${TELNYX_API_KEY}
      - MCP_API_KEY=${MCP_API_KEY}
      - PORT=3000
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
EOF
```

### 3. Create .env file
```bash
cat > .env << 'EOF'
TELNYX_API_KEY=your-telnyx-api-key
MCP_API_KEY=your-mcp-api-key
PORT=3000
EOF
```

### 4. Start with Docker Compose (or use Dockge UI)
```bash
docker-compose up -d --build
```

### 5. Set up Cloudflare Tunnel

Add a route in your cloudflared config to point `telnyx.example.com` to `http://localhost:3000`.

If using cloudflared config file (usually `~/.cloudflared/config.yml` or `/etc/cloudflared/config.yml`):
```yaml
ingress:
  - hostname: telnyx.example.com
    service: http://localhost:3000
  # ... other routes ...
  - service: http_status:404
```

Then restart cloudflared:
```bash
sudo systemctl restart cloudflared
```

Or if using Cloudflare Zero Trust dashboard, add a public hostname:
- Subdomain: `telnyx`
- Domain: `example.com`
- Service: `http://localhost:3000`

### 6. Test the deployment
```bash
# Local test
curl http://localhost:3000/health

# Test via Cloudflare (after tunnel is set up)
curl https://telnyx.example.com/health

# Test auth
curl -H "Authorization: Bearer your-mcp-api-key" https://telnyx.example.com/sse
```

## Final Connection Details for Poke.com

Once deployed:
- **URL**: `https://telnyx.example.com/sse`
- **Transport**: SSE
- **Authorization Header**: `Bearer your-mcp-api-key`

## Architecture
```
Poke.com → Cloudflare Tunnel → Docker (port 3000) → Auth Proxy → Supergateway → Telnyx MCP
              telnyx.example.com
```
