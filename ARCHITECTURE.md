# KANet System Architecture

## Core Principle

**Mind decides. Console transmits. Relay executes.**

```
Mind (Brain)          — decision maker
Console (Neural Hub)  — signal conduit + data store (DB)
Relay (Hands)         — ONLY component that touches the chain
Adapter (Interface)   — connects Mind to AI providers
Scout (Eyes)          — observes chain activity
```

## Communication Rules

Two directions, two protocols, no exceptions:

```
Console → Relay:  IPC  (commands)
Relay → Console:  HTTP (reports & queries)
```

Console NEVER sends chain transactions directly.
Relay NEVER writes to DB directly.

## Data Flow

### Receiving (chain → system)

```
Kaspa Chain
  → Relay (RPC listener detects handshake/comm/payment)
  → Relay processes (decrypt, classify)
  → Relay calls Console HTTP (getAIReply for response content)
  → Relay sends reply on chain (sendKaspa)
  → Relay calls Console HTTP (ingest API to record in DB)
```

### Sending (system → chain)

```
Mind decides action (handshake/message/card/broadcast/transfer)
  → action-executor calls Console API (/api/relay/:id/send-command)
  → Console calls relay-manager.sendCommand() (IPC)
  → Relay receives command (process.on('message'))
  → Relay executes (chain.mjs functions → sendKaspa)
  → Relay calls Console HTTP (ingest API to record in DB)
```

### Proactive (agent initiative)

Same as Sending. Mind's proactive cycle produces an action,
action-executor sends it through Console to Relay.

### Event-driven (discovery trigger)

Scout detects new address → reports to Console HTTP API → Console stores in DB.
Console notifies Relay via IPC when immediate action needed.
Relay executes and reports back via HTTP.

## Relay Capabilities (chain.mjs)

| Function | Purpose | Direction |
|----------|---------|-----------|
| `initiateHandshake(params)` | Send handshake TO target | outbound |
| `acceptHandshake(params)` | Accept incoming handshake | response |
| `sendMessage(params)` | Send encrypted comm | outbound |
| `publishCard(params)` | Publish Agent Card | self-send |
| `sendKaspa(params)` | Low-level TX sender | any |

All functions return `{ to, amount, payload }` drafts.
`sendKaspa()` signs and broadcasts the TX.

## Console API Routes for Chain Operations

| Route | Delegates to |
|-------|-------------|
| `POST /api/relay/:id/send-command` | `sendCommand(id, cmd)` → IPC → Relay |
| `POST /api/relay/:id/publish-card` | `sendCommand(id, { type: 'publish_card', ... })` |
| `POST /api/relay/:id/transfer` | `sendCommand(id, { type: 'transfer', ... })` |

## DB as System Memory

Console DB records everything. Both directions report to it:
- Relay ingest API writes inbound events (messages, handshakes, interactions)
- Relay ingest API writes outbound events (sent TXs, handshake records)
- Mind state (memory, intent, reflections) stored in JSON files
- Trading data (trade_log, baselines, executions) in DB

## Rules for Future Development

1. **Any new chain operation** → add function to Relay chain.mjs, add IPC handler in relay.mjs, add Console API route that calls sendCommand
2. **Console must never import kaspa-wasm for sending** — that is Relay's job
3. **Relay must never write to DB directly** — report via Console HTTP ingest API
4. **New communication channels between Console and Relay** → not allowed. Use existing IPC (Console→Relay) and HTTP (Relay→Console)
5. **Mind decides, Console transmits, Relay executes** — never blur these roles
