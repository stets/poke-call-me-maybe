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
