Deploy the Telnyx MCP server to production:

1. First, check that all changes are committed
2. Build the Docker image: `docker compose build`
3. Start/restart the service: `docker compose up -d`
4. Verify the service is running: `docker compose ps`
5. Check logs for any startup errors: `docker compose logs --tail=50`

If there are issues, show me the error logs and help debug.
