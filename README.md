# Telnyx MCP Server with Voice Calls

A Docker-ready MCP (Model Context Protocol) server that enables AI assistants to make phone calls with text-to-speech messages **and have two-way AI conversations**. Built on [Telnyx](https://telnyx.com) with [Eleven Labs](https://elevenlabs.io) for natural voices and [Claude AI](https://anthropic.com) for conversations.

## Features

### Voice Calls
- **`call_and_speak`** - Make calls with a one-way voice message
- **`call_and_converse`** - Have a two-way AI conversation on the phone
- **`check_call_result`** - Get transcripts and conversation history
- **Eleven Labs TTS** - Natural-sounding voices (Charlotte default)
- **Fast TTS Mode** - Option to use Telnyx built-in TTS for lower latency

### Two-Way Conversations
- **Claude AI Integration** - Powered by Claude Haiku for fast responses
- **Real-time Transcription** - Hear what the caller says
- **Barge-in Support** - Interrupt the AI while it's speaking
- **Natural Turn-Taking** - Waits for caller to speak first, then responds
- **Short Responses** - Optimized for voice (1-2 sentences)

### Infrastructure
- **Bearer Token Auth** - Secure API key protection
- **SSE Transport** - HTTP-accessible MCP server
- **Webhook Handler** - Processes Telnyx call events
- **Voicemail Detection** - Transcription-based detection
- **Docker Ready** - Easy deployment with Docker Compose

## Quick Start

### Prerequisites

- Docker & Docker Compose
- [Telnyx account](https://telnyx.com) with:
  - API Key
  - Phone number
  - Call Control Application (webhook URL pointed to your server)
- [Eleven Labs account](https://elevenlabs.io) for high-quality voices
- [Anthropic account](https://console.anthropic.com) for two-way conversations (optional)

### Setup

1. Clone the repo:
```bash
git clone https://github.com/yourusername/telnyx-mcp-server.git
cd telnyx-mcp-server
```

2. Create `.env` file:
```bash
# Required
TELNYX_API_KEY=your-telnyx-api-key
MCP_API_KEY=your-secure-random-key  # Generate: openssl rand -hex 32

# For high-quality voices (recommended)
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_VOICE_ID=XB0fDUnXU5powFXDhCwa  # Charlotte (default)

# For two-way AI conversations
ANTHROPIC_API_KEY=your-anthropic-key
ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# Optional settings
ENABLE_TRANSCRIPTION=true   # Enable call transcription
USE_FAST_TTS=false          # Use Telnyx TTS instead of Eleven Labs
```

3. Build and run:
```bash
docker compose build
docker compose up -d
```

4. Configure Telnyx webhook:
   - Go to your Call Control Application in Telnyx portal
   - Set webhook URL to: `https://your-server/webhook`

## MCP Tools

| Tool | Description |
|------|-------------|
| `call_and_speak` | Make a call, play a message, wait for response, hang up |
| `call_and_converse` | Make a call and have a multi-turn AI conversation |
| `check_call_result` | Get transcript/conversation after call ends |
| `list_call_control_applications` | List Telnyx apps (to get connection_id) |
| `hangup_calls_actions` | Hang up an active call |

### call_and_speak

Simple one-way call with a voice message.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `connection_id` | Yes | Your Call Control App ID |
| `to` | Yes | Destination phone (+15551234567) |
| `from` | Yes | Your Telnyx number (+15551234567) |
| `message` | Yes | Message to speak when answered |

**Timing**: Wait 45 seconds, then call `check_call_result`.

### call_and_converse

Two-way AI conversation on the phone.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `connection_id` | Yes | Your Call Control App ID |
| `to` | Yes | Destination phone (+15551234567) |
| `from` | Yes | Your Telnyx number (+15551234567) |
| `system_prompt` | Yes | Instructions for the AI personality |
| `initial_message` | Yes | First message AI says when human speaks |
| `max_turns` | No | Max conversation turns (default: 5) |

**Timing**: Wait 60-90 seconds (longer for more turns), then call `check_call_result`.

**Example**:
```
system_prompt: "You are Poke, a friendly AI assistant. Be casual and fun."
initial_message: "Hey! How's it going?"
max_turns: 5
```

### check_call_result

Get the result of a call after it ends.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `call_control_id` | Yes | ID returned from call_and_speak/call_and_converse |

**Returns**:
- `status`: `"in_progress"` or `"completed"`
- `answered_by`: `"human"` or `"voicemail"`
- `transcription.text`: What the person said
- `conversation.messages`: Full conversation history (for call_and_converse)

**Important**: If status is not `"completed"`, wait 30 seconds and retry!

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELNYX_API_KEY` | Yes | - | Telnyx API key |
| `MCP_API_KEY` | Yes | - | Bearer token for MCP auth |
| `ELEVENLABS_API_KEY` | No | - | Eleven Labs API key |
| `ELEVENLABS_VOICE_ID` | No | Charlotte | Eleven Labs voice ID |
| `ANTHROPIC_API_KEY` | No | - | Anthropic API key (for conversations) |
| `ANTHROPIC_MODEL` | No | claude-haiku-4-5-20251001 | Claude model to use |
| `ENABLE_TRANSCRIPTION` | No | false | Enable call transcription |
| `USE_FAST_TTS` | No | false | Use Telnyx TTS (faster, lower quality) |
| `PORT` | No | 3000 | Server port |

## Eleven Labs Voices

Set `ELEVENLABS_VOICE_ID` to change the voice:

| Voice | ID | Style |
|-------|-----|-------|
| **Charlotte** | `XB0fDUnXU5powFXDhCwa` | Seductive, calm (default) |
| Rachel | `21m00Tcm4TlvDq8ikWAM` | Calm, soothing |
| Aria | `9BWtsMINqrJLrRacOk9x` | Expressive, warm |
| Domi | `AZnzlk1XvdvUeBnXmlld` | Strong, confident |

Browse all: [elevenlabs.io/voice-library](https://elevenlabs.io/voice-library)

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│  MCP Client │────▶│  Auth Proxy  │────▶│ MCP Wrapper │────▶│ Telnyx MCP  │
│   (Poke)    │     │  (Express)   │     │  (Custom)   │     │   (stdio)   │
└─────────────┘     └──────────────┘     └─────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │   Webhook   │◀──── Telnyx Events
                    │  /webhook   │      (answered, hangup, transcription)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  Claude  │ │  Eleven  │ │  Telnyx  │
        │   API    │ │  Labs    │ │ Playback │
        │(respond) │ │  (TTS)   │ │ (audio)  │
        └──────────┘ └──────────┘ └──────────┘
```

### Conversation Flow

1. AI calls `call_and_converse` with phone number and prompts
2. Server dials via Telnyx, starts transcription
3. Waits for human to say hello
4. Plays initial message via Eleven Labs
5. Transcribes human response (with silence detection)
6. Claude generates reply, speaks it
7. Repeat until max_turns or hangup
8. Full transcript saved for `check_call_result`

## API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Health check |
| `POST /webhook` | No | Telnyx webhook receiver |
| `GET /sse` | Yes | SSE connection for MCP |
| `POST /message` | Yes | Send MCP messages |
| `GET /call-result/:id` | No | Get call result (internal) |

## Development

```bash
# View logs
docker compose logs -f

# Rebuild after changes
docker compose build && docker compose up -d

# Restart
docker compose restart
```

### Local Development with ngrok

```bash
ngrok http 3003
# Update Telnyx webhook URL with ngrok URL
```

## Costs

- **Telnyx calls**: ~$0.01/min
- **Telnyx transcription**: ~$0.025/min
- **Eleven Labs TTS**: ~$0.30/1000 chars
- **Claude Haiku**: ~$0.25/1M input tokens

A typical 5-turn conversation costs roughly $0.05-0.10.

## License

MIT
