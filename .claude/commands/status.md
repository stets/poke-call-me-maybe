Check the status of the Telnyx MCP server:

1. Check if Docker containers are running: `docker compose ps`
2. Check recent logs for health: `docker compose logs --tail=20`
3. Verify environment variables are set (without revealing secrets)

Report:
- Container status (running/stopped)
- Uptime
- Any recent errors
- Configuration status (which optional features are enabled)
