# Telnyx MCP Server with Voice Calls

A Docker-ready MCP (Model Context Protocol) server that enables AI assistants to make phone calls with text-to-speech messages. Built on top of [Telnyx](https://telnyx.com) with optional [Eleven Labs](https://elevenlabs.io) integration for high-quality voices.

## Features

- **`call_and_speak` Tool** - Simple tool for AI assistants to make calls with voice messages
- **`check_call_result` Tool** - Check if a call was answered by a human or went to voicemail
- **Voicemail Detection** - Uses transcription to reliably detect voicemail vs human
- **Eleven Labs TTS** - Natural-sounding voices (optional, falls back to Telnyx TTS)
- **Bearer Token Auth** - Secure API key protection for your MCP endpoint
- **SSE Transport** - HTTP-accessible MCP server for easy integration
- **Webhook Handler** - Automatically speaks message when call is answered
- **Auto-Hangup** - Hangs up after message plays (no 2-minute voicemails!)
- **Docker Ready** - Easy deployment with Docker Compose

## How It Works

```
AI Assistant calls call_and_speak(to, from, message)
    ↓
Server dials the number via Telnyx
    ↓
When call is answered, webhook triggers
    ↓
Eleven Labs generates audio → Telnyx plays it
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- [Telnyx account](https://telnyx.com) with:
  - API Key
  - Phone number
  - Call Control Application (with webhook URL pointed to your server)
- [Eleven Labs account](https://elevenlabs.io) (optional, for better voices)

### Setup

1. Clone the repo:
```bash
git clone https://github.com/stets/poke-call-me-maybe.git
cd poke-call-me-maybe
```

2. Create `.env` file:
```bash
TELNYX_API_KEY=your-telnyx-api-key
MCP_API_KEY=your-secure-random-key  # Generate with: openssl rand -hex 32

# Optional: Eleven Labs for better voice quality
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_VOICE_ID=pFZP5JQG7iQjIQuC4Bku  # Optional, defaults to Sarah
```

3. Build and run:
```bash
docker compose up -d
```

4. Configure Telnyx webhook:
   - Go to your Call Control Application in Telnyx portal
   - Set webhook URL to: `https://your-server/webhook`

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `call_and_speak` | Make a call and speak a message when answered |
| `check_call_result` | Check if a call was answered by human or voicemail |
| `list_call_control_applications` | List your Telnyx call control apps (to get connection_id) |
| `hangup_calls_actions` | Hang up an active call |

### call_and_speak Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `connection_id` | Yes | Your Call Control App ID |
| `to` | Yes | Destination phone number (E.164 format: +15551234567) |
| `from` | Yes | Your Telnyx phone number (E.164 format) |
| `message` | Yes | Message to speak when call is answered |

### check_call_result Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `call_control_id` | Yes | The call_control_id returned from call_and_speak |

Returns:
- `answered_by`: `"human"` or `"voicemail"` (when transcription enabled)
- `status`: `"in_progress"` or `"completed"`
- `transcription`: The actual transcription text (if enabled)

## Voicemail Detection

The server can detect whether a call was answered by a human or went to voicemail.

### Transcription-Based Detection (Recommended)

When `ENABLE_TRANSCRIPTION=true`, the server:
1. Transcribes the inbound audio when the call is answered
2. Analyzes the transcription for voicemail phrases like "leave a message"
3. Provides reliable detection with the actual transcript

**Cost**: ~$0.0125 (1.25 cents) per 30 seconds of audio

### AMD-Based Detection (Fallback)

Answering Machine Detection (AMD) is enabled by default but is less reliable with modern smartphones. It may misclassify voicemail as human, especially with natural-sounding greetings.

## API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Health check |
| `POST /webhook` | No | Telnyx webhook receiver |
| `GET /sse` | Yes | SSE connection for MCP |
| `POST /message` | Yes | Send MCP messages |

## Connecting MCP Clients

### URL & Auth
- **URL**: `https://your-server/sse`
- **Transport**: SSE
- **Header**: `Authorization: Bearer YOUR_MCP_API_KEY`

### Example Usage (from AI assistant)

```
Call +1-555-123-4567 and say "Good morning! This is your wake-up call."
```

The AI will use `call_and_speak` with:
- `to`: "+15551234567"
- `from`: your Telnyx number
- `message`: "Good morning! This is your wake-up call."

## Eleven Labs Voices

Set `ELEVENLABS_VOICE_ID` in `.env` to change voices:

**Female:**
- `EXAVITQu4vr4xnSDxMaL` - Sarah (default)
- `21m00Tcm4TlvDq8ikWAM` - Rachel
- `pFZP5JQG7iQjIQuC4Bku` - Lily

**Male:**
- `pNInz6obpgDQGcFmaJgB` - Adam
- `yoZ06aMxZJJ28mfd3POQ` - Sam
- `TxGEqnHWrfWFTfGW9XjX` - Josh

Browse all voices: [elevenlabs.io/voice-library](https://elevenlabs.io/voice-library)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | Yes | Your Telnyx API key |
| `MCP_API_KEY` | Yes | Bearer token for MCP authentication |
| `ELEVENLABS_API_KEY` | No | Eleven Labs API key (for better voices) |
| `ELEVENLABS_VOICE_ID` | No | Eleven Labs voice ID (default: Sarah) |
| `ENABLE_TRANSCRIPTION` | No | Enable transcription-based voicemail detection (default: false) |
| `PORT` | No | Server port (default: 3000) |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│  MCP Client │────▶│  Auth Proxy  │────▶│ MCP Wrapper │────▶│ Telnyx MCP  │
│   (Poke)    │     │  (Express)   │     │  (Custom)   │     │   (stdio)   │
└─────────────┘     └──────────────┘     └─────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │   Webhook   │
                    │  /webhook   │
                    └──────┬──────┘
                           │ call.answered
                           ▼
                    ┌─────────────┐     ┌─────────────┐
                    │ Eleven Labs │────▶│   Telnyx    │
                    │     TTS     │     │  Playback   │
                    └─────────────┘     └─────────────┘
```

## Exposing Publicly

### With ngrok (development)
```bash
ngrok http 3000
```

### Production
Use a reverse proxy (Traefik, Nginx, Caddy) with HTTPS.

## License

MIT
