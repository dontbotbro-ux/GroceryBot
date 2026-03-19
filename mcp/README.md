## Local MCP Setup

This repo includes a local stdio MCP server at:

- `/Users/swaq/Downloads/grobots/scripts/grocery-imessage-mcp.mjs`

It exposes two native tools for Codex:

- `query_grocery_database`
  - Searches the local grocery feeds in `public/store-data.json` or `public/best-price-data.json`
- `send_grocery_imessage`
  - Sends an iMessage through the local macOS Messages app using AppleScript

### Why this stays local

- The MCP server runs as a local `node` process over stdio.
- Grocery data is read only from local files in this repo.
- iMessages are sent only through the local Messages app on this Mac.
- No remote database or cloud messaging service is involved.

### Example Codex MCP config

Use the example config in:

- `/Users/swaq/Downloads/grobots/mcp/codex.local.example.json`

The relevant server entry is:

```json
{
  "mcpServers": {
    "grobots-local-imessage": {
      "command": "node",
      "args": [
        "/Users/swaq/Downloads/grobots/scripts/grocery-imessage-mcp.mjs"
      ],
      "cwd": "/Users/swaq/Downloads/grobots"
    }
  }
}
```

### Tool definitions

`query_grocery_database`

- Inputs:
  - `query`: search text
  - `source`: `deals` or `catalog`
  - `storeIds`: optional store filter
  - `limit`: max rows
- Output:
  - `generatedAt`
  - `resultCount`
  - `matches[]` with store, title, price, detail, category, and link

`send_grocery_imessage`

- Inputs:
  - `phoneNumber`
  - `summary` optional
  - `storeIds` optional
  - `dealsPerStore` optional
- Output:
  - `phoneNumber`
  - `sent`
  - `generatedAt`
  - `summary`

### Run locally

```bash
npm run mcp:grocery-imessage
```

### Notes

- The iMessage tool requires macOS.
- The first send may prompt for Messages and Accessibility permissions.
- This local MCP server is the part that Codex can use natively. If you still want to compare it against a third-party iMessage MCP server like `photon-imsg-mcp` or `jons-mcp-imessage`, use this one as the local-only baseline.
