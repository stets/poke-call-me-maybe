# CLAUDE.md - Guidelines for Claude Code

## Security Rules

**NEVER commit secrets or API keys!**

- `.env` is in `.gitignore` - NEVER add it to git
- NEVER put actual API keys in README.md, code comments, or any committed file
- Use placeholder examples like `your-api-key-here` or `sk-ant-xxx...`
- If you accidentally see a secret, DO NOT include it in commits or responses

Files that contain secrets (DO NOT COMMIT):
- `.env` - All API keys and secrets
- Any file with `TELNYX_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `MCP_API_KEY`

## Project Structure

- `server.js` - Main Express server with webhook handling and conversation logic
- `mcp-wrapper.js` - MCP tool wrapper adding custom tools on top of telnyx-mcp
- `docker-compose.yml` - Container configuration
- `Dockerfile` - Container build

## Environment Variables

Required:
- `TELNYX_API_KEY` - Telnyx API key for calls
- `MCP_API_KEY` - Bearer token for MCP authentication

Optional:
- `ELEVENLABS_API_KEY` - For high-quality TTS
- `ANTHROPIC_API_KEY` - For two-way AI conversations
- `ENABLE_TRANSCRIPTION` - Enable call transcription (costs ~$0.025/min)

## Common Commands

### Docker Operations
- `docker compose build` - Rebuild the container
- `docker compose up -d` - Start services in background
- `docker compose logs -f` - Stream logs
- `docker compose ps` - Check container status
- `docker compose restart` - Restart services

### Development
- `npm install` - Install dependencies locally
- `node server.js` - Run server directly (for local dev)

## Webhook Events

The server handles these Telnyx webhook events:
- `call.initiated` - Outbound call started
- `call.answered` - Call connected, triggers TTS playback
- `call.speak.ended` - TTS finished playing
- `call.transcription` - Speech-to-text results (if enabled)
- `call.hangup` - Call ended

## MCP Tools

Custom tools provided via mcp-wrapper.js:
- `call_and_speak` - Initiate a call with a message (auto-encodes client_state)
- `list_call_control_applications` - List available Telnyx applications
- `hangup_calls_actions` - Hang up an active call

## Slash Commands

Use these custom commands:
- `/deploy` - Build and deploy to production
- `/logs` - View and analyze container logs
- `/status` - Check service status
- `/claude-code-tips` - Get recommendations for improving Claude Code usage

## Claude Code Expert Agent

Use the `claude-code-expert` agent for:
- Best practices on CLAUDE.md and settings
- Hook configuration for automation
- Custom command recommendations
- MCP development workflows

## Architecture Notes

### Call Flow
1. LLM invokes `call_and_speak` with phone number and message
2. Server initiates call via Telnyx API with encoded client_state
3. Webhook receives `call.answered` event
4. Server decodes client_state and plays TTS (Eleven Labs or Telnyx fallback)
5. After TTS completes, optional transcription for response
6. Call hangs up after timeout or explicit hangup

### TTS Priority
1. Eleven Labs API (if ELEVENLABS_API_KEY set) - Higher quality
2. Telnyx built-in TTS - Fallback option

## Testing

- Use ngrok or similar to expose webhooks locally
- Test with Telnyx Test Phone Numbers to avoid charges
- Check logs for webhook payload structure
