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
if (!TELNYX_API_KEY) {
  console.error('ERROR: TELNYX_API_KEY environment variable is required');
  process.exit(1);
}

console.log(`[auth-proxy] Starting supergateway on internal port ${SUPERGATEWAY_PORT}...`);

const supergateway = spawn('npx', [
  'supergateway',
  '--stdio', 'uvx --from git+https://github.com/team-telnyx/telnyx-mcp-server.git telnyx-mcp-server',
  '--port', String(SUPERGATEWAY_PORT),
  '--host', '127.0.0.1',
  '--cors'
], {
  env: { ...process.env, TELNYX_API_KEY },
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
