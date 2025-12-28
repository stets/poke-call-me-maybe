const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');

const app = express();

// Configuration
const API_KEY = process.env.MCP_API_KEY || 'change-me-in-production';
const PORT = process.env.PORT || 3000;
const SUPERGATEWAY_PORT = 8000;

// Start supergateway as child process
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_PUBLIC_KEY = process.env.TELNYX_PUBLIC_KEY;
if (!TELNYX_API_KEY) {
  console.error('ERROR: TELNYX_API_KEY environment variable is required');
  process.exit(1);
}
if (!TELNYX_PUBLIC_KEY) {
  console.error('ERROR: TELNYX_PUBLIC_KEY environment variable is required');
  process.exit(1);
}

console.log(`[auth-proxy] Starting supergateway on internal port ${SUPERGATEWAY_PORT}...`);

// Only expose essential call control tools to avoid overwhelming the client
const ALLOWED_TOOLS = [
  'dial_calls',
  'speak_calls_actions',
  'hangup_calls_actions',
  'list_call_control_applications',
  'retrieve_status_calls',
  'answer_calls_actions',
  'start_playback_calls_actions',
  'send_dtmf_calls_actions'
];

const telnyxMcpCmd = `npx -y telnyx-mcp ${ALLOWED_TOOLS.map(t => `--tool="${t}"`).join(' ')}`;

const supergateway = spawn('npx', [
  'supergateway',
  '--stdio', telnyxMcpCmd,
  '--port', String(SUPERGATEWAY_PORT),
  '--host', '127.0.0.1',
  '--cors'
], {
  env: { ...process.env, TELNYX_API_KEY, TELNYX_PUBLIC_KEY },
  stdio: ['pipe', 'pipe', 'pipe']
});

supergateway.stdout.on('data', (data) => {
  console.log(`[supergateway] ${data.toString().trim()}`);
});

supergateway.stderr.on('data', (data) => {
  console.error(`[supergateway] ${data.toString().trim()}`);
});

supergateway.on('close', (code) => {
  console.log(`[supergateway] Process exited with code ${code}`);
  process.exit(code);
});

// Wait for supergateway to start
setTimeout(() => {
  console.log(`[auth-proxy] API Key authentication enabled`);
  console.log(`[auth-proxy] Your API Key: ${API_KEY}`);
  console.log(`[auth-proxy] Listening on port ${PORT}`);
}, 3000);

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// API Key authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  // Support both "Bearer <key>" and just "<key>"
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (token !== API_KEY) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
};

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'telnyx-mcp-server' });
});

// Telnyx webhook handler (no auth - Telnyx signs these)
app.post('/webhook', express.json(), async (req, res) => {
  const event = req.body?.data;

  if (!event) {
    console.log('[webhook] Received empty event');
    return res.sendStatus(200);
  }

  const eventType = event.event_type;
  const callControlId = event.payload?.call_control_id;
  const clientStateBase64 = event.payload?.client_state;

  console.log(`[webhook] Received event: ${eventType}`);

  // Handle call.answered - speak the message from client_state
  if (eventType === 'call.answered' && callControlId) {
    let message = 'Hello, this is a call from your AI assistant.';

    // Decode client_state if present
    if (clientStateBase64) {
      try {
        const clientState = JSON.parse(Buffer.from(clientStateBase64, 'base64').toString('utf-8'));
        if (clientState.message) {
          message = clientState.message;
        }
        console.log(`[webhook] Decoded client_state:`, clientState);
      } catch (e) {
        console.log(`[webhook] Could not parse client_state: ${e.message}`);
      }
    }

    console.log(`[webhook] Speaking message: "${message}"`);

    try {
      const response = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TELNYX_API_KEY}`
        },
        body: JSON.stringify({
          payload: message,
          voice: 'female',
          language: 'en-US'
        })
      });

      if (response.ok) {
        console.log(`[webhook] Speak command sent successfully`);
      } else {
        const error = await response.text();
        console.error(`[webhook] Speak command failed: ${response.status} - ${error}`);
      }
    } catch (e) {
      console.error(`[webhook] Error calling speak API: ${e.message}`);
    }
  }

  // Always respond 200 to acknowledge receipt
  res.sendStatus(200);
});

// Proxy all other requests to supergateway (with auth)
app.use('/', authenticate, createProxyMiddleware({
  target: `http://127.0.0.1:${SUPERGATEWAY_PORT}`,
  changeOrigin: true,
  ws: true,
  onError: (err, req, res) => {
    console.error('[proxy] Error:', err.message);
    res.status(502).json({ error: 'Proxy error', message: err.message });
  }
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[auth-proxy] Auth proxy starting on port ${PORT}...`);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('[auth-proxy] Shutting down...');
  supergateway.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[auth-proxy] Shutting down...');
  supergateway.kill();
  process.exit(0);
});
