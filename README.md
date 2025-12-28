# Telnyx MCP Server with Auth Proxy

A Docker-ready MCP (Model Context Protocol) server that wraps the [Telnyx MCP Server](https://github.com/team-telnyx/telnyx-mcp-server) with Bearer token authentication and exposes it via SSE (Server-Sent Events) transport.

## Features

- **Bearer Token Authentication** - Secure API key protection for your MCP endpoint
- **SSE Transport** - HTTP-accessible MCP server (instead of stdio)
- **Docker Ready** - Easy deployment with Docker Compose
- **Health Check** - Built-in `/health` endpoint for monitoring

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.x with `uv` package manager
- A [Telnyx account](https://telnyx.com) with API key

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
export TELNYX_API_KEY="your-telnyx-api-key"
export MCP_API_KEY="your-secure-random-key"  # Generate with: openssl rand -hex 32
export PORT=3000
```

3. Start the server:
```bash
node server.js
```

### Docker Deployment

1. Create a `.env` file:
```bash
TELNYX_API_KEY=your-telnyx-api-key
MCP_API_KEY=your-secure-random-key
```

2. Build and run:
```bash
docker-compose up -d
```

## API Endpoints

| Endpoint | Auth Required | Description |
|----------|---------------|-------------|
| `GET /health` | No | Health check |
| `GET /sse` | Yes | SSE connection for MCP |
| `POST /message` | Yes | Send MCP messages |

## Authentication

All endpoints except `/health` require a Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_MCP_API_KEY" https://your-server/sse
```

## Connecting from MCP Clients

### Poke.com / Other SSE Clients

- **URL**: `https://your-server/sse`
- **Transport**: SSE
- **Headers**: `Authorization: Bearer YOUR_MCP_API_KEY`

### Example with curl

```bash
# Test health (no auth)
curl https://your-server/health

# Connect to SSE (with auth)
curl -H "Authorization: Bearer YOUR_MCP_API_KEY" https://your-server/sse
```

## Available Telnyx Tools

Once connected, you have access to all Telnyx MCP tools:

- **Calls**: `make_call`, `hangup`, `speak`, `transfer`, `send_dtmf`
- **Messaging**: `send_message`, `list_messaging_profiles`
- **AI Assistants**: `create_assistant`, `list_assistants`, `start_assistant_call`
- **Phone Numbers**: `list_phone_numbers`, `list_available_phone_numbers`
- **And many more...**

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│  MCP Client │────▶│  Auth Proxy  │────▶│ Supergateway│────▶│ Telnyx MCP  │
│  (Poke.com) │     │  (port 3000) │     │ (port 8000) │     │   (stdio)   │
└─────────────┘     └──────────────┘     └─────────────┘     └─────────────┘
                           │
                    Bearer Token Auth
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | Yes | Your Telnyx API key |
| `MCP_API_KEY` | Yes | Bearer token for authentication |
| `PORT` | No | Server port (default: 3000) |

## Exposing Publicly

### With ngrok (development)

```bash
ngrok http 3000
```

### With Docker + Reverse Proxy (production)

Use with Traefik, Nginx, or Caddy as a reverse proxy with HTTPS.

## License

MIT
