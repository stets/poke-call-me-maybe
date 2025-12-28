#!/bin/bash

# Start Telnyx MCP Server via supergateway (SSE transport)
# This exposes the stdio-based Telnyx MCP server over HTTP/SSE

# Requires TELNYX_API_KEY environment variable to be set
if [ -z "$TELNYX_API_KEY" ]; then
  echo "Error: TELNYX_API_KEY environment variable is required"
  exit 1
fi

npx supergateway \
  --stdio "uvx --from git+https://github.com/team-telnyx/telnyx-mcp-server.git telnyx-mcp-server" \
  --port 8000 \
  --host 0.0.0.0 \
  --cors
