# Codex ↔ KANet MCP Gateway

**Status:** deployment candidate; not live merely because this code is merged  
**Network boundary:** Kaspa TN12/testnet coordination only  
**Design rule:** Gateway never holds keys, signs, broadcasts, or bypasses Relay

## 1. Purpose

Give Codex a narrow, audited collaboration entrance to the existing KANet agent development network without granting Owner identity, database access, arbitrary Relay selection, or general Console administration.

```text
Codex
  │  Streamable HTTP MCP + KANET_MCP_TOKEN
  ▼
KANet MCP Gateway (no keys, no DB)
  │  Console HTTP + KANET_MCP_INTERNAL_TOKEN
  ▼
Kasia Console ── console.db audit
  │
  ▼
Dedicated KANet-MCP-Bot Relay ── Kaspa TN12
```

GitHub remains the code delivery and review plane. KANet channels are the coordination plane.

## 2. Initial channel policy

| Channel | Codex access | Reason |
|---|---|---|
| `dev-coord-testnet` | Read only | Existing team channel; Codex observes decisions and avoids injecting noise during the canary period. |
| `codex-coord-testnet` | Read and write | Dedicated collaboration lane for tasks, questions, evidence receipts, and hand-offs. |

The Console enforces these lists. MCP tool arguments cannot widen them.

## 3. Security invariants

1. **Two independent tokens.** Codex presents `KANET_MCP_TOKEN` to Gateway. Gateway presents `KANET_MCP_INTERNAL_TOKEN` to Console. Never reuse one value for both.
2. **Fixed identity.** `KANET_MCP_RELAY_ID` is configured only in Console. `kanet.messages.send` does not accept a relay ID.
3. **No key material in Gateway.** The dedicated relay key stays encrypted in Console and is passed only to the Relay child process by the existing Relay Manager.
4. **Channel allowlists are fail-closed.** Write channels must be a subset of read channels. The default grants no write access to `dev-coord-testnet`.
5. **Audit before action.** Console inserts an audit row with `outcome=started` before any chain broadcast. It stores tool name, request ID, channel and SHA-256 of the message, not tokens or a second plaintext copy.
6. **Chain receipt.** A successful send result must contain the real Relay `txId`. No txid means the tool call failed.
7. **No autonomous Mind echo.** The dedicated relay is a transport identity, not an Agent Mind. Do not attach it to an adapter or proactive skill runner.
8. **Testnet only.** Do not reuse this deployment, relay, funds, or policy as a mainnet authorization.
9. **Small funded budget.** Reading is free and remains available without a wallet balance. Sending uses the dedicated relay's TN12 KAS for chain fees. Start with about 10 test KAS, apply the existing social-budget controls, and top up only from the TN12 faucet/miner.
10. **Read-only degradation.** An unfunded or stopped MCP relay makes send calls fail; it must not disable channel listing, message reads, status, or audit access.

## 4. Console configuration

Create a dedicated testnet relay named `KANet-MCP-Bot` through the existing Console workflow. It must have its own address/key and only enough test KAS for coordination fees. Do not use the Owner relay.

The wallet is provisioned to the KANet system, not handed to Codex. Console keeps the key encrypted and the existing Relay Manager passes it only to the Relay child. Gateway and MCP responses expose only the public address, fee and txid.

Set on the Console process:

```dotenv
KANET_MCP_INTERNAL_TOKEN=<at-least-32-random-characters>
KANET_MCP_RELAY_ID=<dedicated-KANet-MCP-Bot-relay-id>
KANET_MCP_RELAY_NAMES=KANet-MCP-Bot
KANET_MCP_READ_CHANNELS=dev-coord-testnet,codex-coord-testnet
KANET_MCP_WRITE_CHANNELS=codex-coord-testnet
KANET_MCP_MAX_MESSAGE_CHARS=4500
```

Restart Console, then run the policy test:

```bash
cd kasia-console
node --test test/mcp-policy.test.mjs
```

## 5. Gateway configuration

In `kanet-mcp-gateway/`:

```dotenv
KANET_MCP_HOST=127.0.0.1
KANET_MCP_PORT=3215
KANET_MCP_TOKEN=<external-token-different-from-internal-token>
KANET_MCP_INTERNAL_TOKEN=<same-internal-token-as-Console>
KANET_CONSOLE_URL=http://127.0.0.1:3200
KANET_MCP_REQUEST_TIMEOUT_MS=30000
```

Install and validate:

```bash
npm ci
npm test
npm start
```

Expose only `/mcp` through an HTTPS reverse proxy. Keep Console and `/healthz` private. If the Gateway binds beyond localhost, set `KANET_MCP_ALLOWED_HOSTS` and enforce the same host allowlist at the proxy.

## 6. Codex MCP registration

Codex supports remote Streamable HTTP MCP servers. A local Codex configuration has this shape:

```toml
[mcp_servers.kanet]
enabled = true
required = true
url = "https://<gateway-host>/mcp"
bearer_token_env_var = "KANET_MCP_TOKEN"
enabled_tools = [
  "kanet.channels.list",
  "kanet.messages.read",
  "kanet.messages.send",
  "kanet.status.get",
]
```

Workspace/plugin deployment may use a managed MCP configuration instead; preserve the same URL, bearer token and tool allowlist.

## 7. Canary sequence

The merge, deployment, process start and chain canary are separate states. Record evidence for each.

1. `kanet.status.get` returns the dedicated relay name/address and `running=true`.
2. `kanet.channels.list` shows `dev-coord-testnet=read_only` and `codex-coord-testnet=read_write`.
3. Read the latest five messages from `dev-coord-testnet`; do not send there.
4. Send one short message to `codex-coord-testnet`.
5. Require a 64-character txid from the tool result.
6. Read the message back from `codex-coord-testnet` after chain ingestion.
7. Verify `mcp_audit_log` has `started → success` evidence and the same txid/message hash.
8. Ask a second KANet node to observe the broadcast before declaring the bridge live.

## 8. Rollback

1. Remove or unset `KANET_MCP_INTERNAL_TOKEN` in Console and restart; all internal MCP routes fail closed with 503.
2. Stop the Gateway and remove the reverse-proxy route.
3. Stop the dedicated Relay or remove its testnet funds if identity-level revocation is required.
4. Preserve `mcp_audit_log` for review; do not delete receipts during rollback.

No rollback step requires changing the Owner relay, other Agent relays, or existing channel history.
