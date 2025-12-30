Show the recent logs from the Telnyx MCP server:

Run `docker compose logs --tail=100 -f` and analyze any errors or warnings.

Look for:
- Webhook events (call.initiated, call.answered, call.hangup)
- TTS generation (Eleven Labs or Telnyx fallback)
- MCP tool invocations
- Any error messages or stack traces

Summarize what's happening and flag any issues.
