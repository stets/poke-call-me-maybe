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
const TELNYX_PUBLIC_KEY = process.env.TELNYX_PUBLIC_KEY || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Default: Sarah
const ENABLE_TRANSCRIPTION = process.env.ENABLE_TRANSCRIPTION === 'true'; // Transcribe calls to detect voicemail vs human

if (!TELNYX_API_KEY) {
  console.error('ERROR: TELNYX_API_KEY environment variable is required');
  process.exit(1);
}
if (!TELNYX_PUBLIC_KEY) {
  console.warn('WARNING: TELNYX_PUBLIC_KEY not set - webhook signature verification disabled');
}
if (!ELEVENLABS_API_KEY) {
  console.warn('WARNING: ELEVENLABS_API_KEY not set - using Telnyx built-in TTS (lower quality)');
}
if (ENABLE_TRANSCRIPTION) {
  console.log('Transcription-based voicemail detection: ENABLED');
} else {
  console.log('Transcription-based voicemail detection: DISABLED (set ENABLE_TRANSCRIPTION=true to enable)');
}

// Store AMD results by call_control_id
const amdResults = new Map();

// Store transcription text by call_control_id
const transcriptions = new Map();

// Store final call results (for check_call_result tool)
const callResults = new Map();

// Voicemail detection patterns
const VOICEMAIL_PATTERNS = [
  /leave\s*(a\s*)?(message|voicemail)/i,
  /not\s*(available|here)/i,
  /after\s*the\s*(tone|beep)/i,
  /reached\s*(the\s*)?(voicemail|mailbox)/i,
  /please\s*leave/i,
  /call\s*you\s*back/i,
  /can't\s*(come|get)\s*to\s*the\s*phone/i,
  /at\s*the\s*tone/i
];

console.log(`[auth-proxy] Starting supergateway on internal port ${SUPERGATEWAY_PORT}...`);

// Use our custom MCP wrapper that adds call_and_speak tool
const supergateway = spawn('npx', [
  'supergateway',
  '--stdio', 'node mcp-wrapper.js',
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

// Call result lookup (used by check_call_result tool)
app.get('/call-result/:callControlId', (req, res) => {
  const callControlId = req.params.callControlId;
  const result = callResults.get(callControlId);

  if (!result) {
    return res.json({
      found: false,
      message: 'Call not found or not yet answered. The call may still be ringing.'
    });
  }

  res.json({
    found: true,
    call_control_id: callControlId,
    ...result
  });
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

  // Handle AMD result - store it for when call.answered fires
  if (eventType === 'call.machine.detection.ended' && callControlId) {
    const result = event.payload?.result; // 'human', 'machine', 'not_sure', 'unknown'
    console.log(`[webhook] AMD result for ${callControlId}: ${result}`);
    amdResults.set(callControlId, result);

    // Also store in callResults for later querying
    callResults.set(callControlId, {
      answered_by: result,
      status: 'in_progress',
      timestamp: new Date().toISOString()
    });
  }

  // Handle transcription events
  if (eventType === 'call.transcription' && callControlId) {
    const text = event.payload?.transcription_data?.transcript || '';
    if (text) {
      const existing = transcriptions.get(callControlId) || '';
      transcriptions.set(callControlId, existing + ' ' + text);
      console.log(`[webhook] Transcription: "${text}"`);
    }
  }

  // Handle call.hangup - finalize call result with transcription analysis
  if (eventType === 'call.hangup' && callControlId) {
    const existing = callResults.get(callControlId) || {};

    // Analyze transcription if available
    let transcriptionResult = null;
    const transcriptionText = transcriptions.get(callControlId);
    if (transcriptionText) {
      console.log(`[webhook] Full transcription: "${transcriptionText.trim()}"`);

      // Check for voicemail patterns
      const isVoicemail = VOICEMAIL_PATTERNS.some(pattern => pattern.test(transcriptionText));
      transcriptionResult = {
        text: transcriptionText.trim(),
        detected_as: isVoicemail ? 'voicemail' : 'human'
      };
      console.log(`[webhook] Transcription analysis: ${transcriptionResult.detected_as.toUpperCase()}`);

      // Clean up transcription
      transcriptions.delete(callControlId);
    }

    callResults.set(callControlId, {
      ...existing,
      status: 'completed',
      hangup_cause: event.payload?.hangup_cause,
      completed_at: new Date().toISOString(),
      transcription: transcriptionResult,
      // Override answered_by if transcription is more reliable
      answered_by: transcriptionResult ? transcriptionResult.detected_as : existing.answered_by
    });
    console.log(`[webhook] Call completed: ${JSON.stringify(callResults.get(callControlId))}`);

    // Clean up after 5 minutes
    setTimeout(() => callResults.delete(callControlId), 5 * 60 * 1000);
  }

  // Handle call.answered - speak the message from client_state
  if (eventType === 'call.answered' && callControlId) {
    const amdResult = amdResults.get(callControlId);
    if (amdResult) {
      console.log(`[webhook] Call answered by (AMD): ${amdResult.toUpperCase()}`);
      amdResults.delete(callControlId);
    }

    // Start transcription if enabled (to detect voicemail vs human)
    if (ENABLE_TRANSCRIPTION) {
      console.log(`[webhook] Starting transcription for voicemail detection...`);
      try {
        const transcriptionResponse = await fetch(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/transcription_start`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${TELNYX_API_KEY}`
            },
            body: JSON.stringify({
              language: 'en',
              transcription_tracks: 'inbound' // Only transcribe what the other party says
            })
          }
        );
        if (transcriptionResponse.ok) {
          console.log(`[webhook] Transcription started`);
        } else {
          const error = await transcriptionResponse.text();
          console.error(`[webhook] Transcription start failed: ${error}`);
        }
      } catch (e) {
        console.error(`[webhook] Error starting transcription: ${e.message}`);
      }
    }

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
      // Use Eleven Labs if available, otherwise fall back to Telnyx TTS
      if (ELEVENLABS_API_KEY) {
        console.log(`[webhook] Using Eleven Labs TTS...`);

        // Generate audio with Eleven Labs
        const elevenLabsResponse = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': ELEVENLABS_API_KEY
            },
            body: JSON.stringify({
              text: message,
              model_id: 'eleven_turbo_v2_5',
              output_format: 'mp3_44100_128',
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75
              }
            })
          }
        );

        if (!elevenLabsResponse.ok) {
          const error = await elevenLabsResponse.text();
          throw new Error(`Eleven Labs API failed: ${elevenLabsResponse.status} - ${error}`);
        }

        // Get audio as buffer and convert to base64
        const audioBuffer = await elevenLabsResponse.arrayBuffer();
        const audioBase64 = Buffer.from(audioBuffer).toString('base64');
        console.log(`[webhook] Generated ${audioBuffer.byteLength} bytes of audio`);

        // Upload audio to Telnyx media storage using multipart form
        const mediaName = `elevenlabs-${Date.now()}.mp3`;
        const boundary = '----TelnyxBoundary' + Date.now();
        const audioData = Buffer.from(audioBuffer);

        // Build multipart form data manually
        const formParts = [
          `--${boundary}\r\n`,
          `Content-Disposition: form-data; name="media_name"\r\n\r\n`,
          `${mediaName}\r\n`,
          `--${boundary}\r\n`,
          `Content-Disposition: form-data; name="media"; filename="${mediaName}"\r\n`,
          `Content-Type: audio/mpeg\r\n\r\n`
        ];

        const formStart = Buffer.from(formParts.join(''));
        const formEnd = Buffer.from(`\r\n--${boundary}--\r\n`);
        const formBody = Buffer.concat([formStart, audioData, formEnd]);

        const uploadResponse = await fetch(
          'https://api.telnyx.com/v2/media',
          {
            method: 'POST',
            headers: {
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Authorization': `Bearer ${TELNYX_API_KEY}`
            },
            body: formBody
          }
        );

        if (!uploadResponse.ok) {
          const error = await uploadResponse.text();
          throw new Error(`Media upload failed: ${uploadResponse.status} - ${error}`);
        }

        console.log(`[webhook] Uploaded audio as ${mediaName}`);

        // Play audio via Telnyx
        const playbackResponse = await fetch(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/playback_start`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${TELNYX_API_KEY}`
            },
            body: JSON.stringify({
              media_name: mediaName
            })
          }
        );

        if (playbackResponse.ok) {
          console.log(`[webhook] Eleven Labs audio playback started`);
        } else {
          const error = await playbackResponse.text();
          console.error(`[webhook] Playback failed: ${playbackResponse.status} - ${error}`);
        }
      } else {
        // Fallback to Telnyx built-in TTS
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
          console.log(`[webhook] Telnyx TTS speak command sent successfully`);
        } else {
          const error = await response.text();
          console.error(`[webhook] Speak command failed: ${response.status} - ${error}`);
        }
      }
    } catch (e) {
      console.error(`[webhook] Error in TTS: ${e.message}`);
    }
  }

  // Handle playback/speak ended - hang up the call
  if ((eventType === 'call.playback.ended' || eventType === 'call.speak.ended') && callControlId) {
    console.log(`[webhook] Audio finished, hanging up call...`);

    try {
      const hangupResponse = await fetch(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TELNYX_API_KEY}`
          },
          body: JSON.stringify({})
        }
      );

      if (hangupResponse.ok) {
        console.log(`[webhook] Call hung up successfully`);
      } else {
        const error = await hangupResponse.text();
        console.error(`[webhook] Hangup failed: ${hangupResponse.status} - ${error}`);
      }
    } catch (e) {
      console.error(`[webhook] Error hanging up: ${e.message}`);
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
