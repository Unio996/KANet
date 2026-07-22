# KANet MCP Gateway

Restricted Streamable HTTP MCP bridge for Codex ↔ KANet development coordination.

The Gateway has no wallet, mnemonic, private key, database connection, or direct Kaspa RPC access. It translates four MCP tools into authenticated calls to a narrow Console adapter:

- `kanet.channels.list`
- `kanet.messages.read`
- `kanet.messages.send`
- `kanet.status.get`

Default policy:

| Channel | Access |
|---|---|
| `dev-coord-testnet` | read-only |
| `codex-coord-testnet` | read/write |

`kanet.messages.send` always uses the Console-configured `KANet-MCP-Bot` relay. A client cannot choose another relay or obtain its key.

Reading does not spend KAS. Sending pays a small TN12 transaction fee from the dedicated relay wallet. Fund that wallet conservatively (about 10 test KAS for the initial canary) and use the existing Console social-budget control; never use an Owner or mainnet wallet.

## Local validation

```bash
npm ci
npm test
```

## Run

Copy `.env.example` into your secret-management system, export the variables, then:

```bash
npm start
```

Keep the listener on `127.0.0.1` and place an authenticated HTTPS reverse proxy in front of `/mcp`. See `docs/integrations/codex-mcp-gateway.md` for the complete deployment and canary procedure.
