# Conversational Ops — Developer Guide

## Overview

`conversational-ops` is KANet's first **core-level package skill**. It turns the chat dialog into a unified control interface — users query data and execute operations through natural conversation with their Agent.

## Architecture

```
User input → Mind.handleMessage()
  → parseIntent(message)
    ├── Match (score > 0) → executeQuery() → buildQueryTask() → Brain summarizes → return
    ├── Execute intent → preflight check → confirm card (wait for click) → execute
    └── No match → existing Brain reactive flow (unchanged)
```

**Five principles:**
1. Rule layer fetches data, Brain interprets
2. Dimensions decide format (single=one-liner, multi=card+summary, none=Brain free-form)
3. Lives in Mind layer (Agent's capability, not Console's)
4. Replaces Brain task (not appended to context)
5. Permission check before intent processing

## File Structure

```
agent-mind/src/
  intent-parser.mjs              — Passive registry: registerIntents(), parseIntent(), checkPermission()
  confirm-store.mjs              — One-time tokens for execute intents (30s expiry)
  skills/conversational-ops/
    skill.json                   — Package metadata (id, version, permissions)
    intents.json                 — 13 intents (keywords, params, dimensions)
    executor.mjs                 — Query functions calling Console API

kasia-console/src/
  api/trading.js                 — POST /api/trade/preflight (mode/limit/cooldown check)
  api/chat.js                    — POST /api/chat/confirm (execute confirmed action)
  ui/chat.eta                    — Confirm card + query card rendering
```

## Intent Registry

Intents are defined in `intents.json` (not hardcoded). Each intent:

```json
{
  "intent_name": {
    "keywords": ["keyword1", "keyword2", ...],
    "category": "query|execute|trigger|reputation|collaboration",
    "dimensions": "single|multi|none",
    "label": "Human-readable label",
    "params": [
      { "name": "amount", "pattern": "(\\d+\\.?\\d*)\\s*KAS", "flags": "i" }
    ]
  }
}
```

**Current intents (13):**

| # | Intent | Category | Dimensions |
|---|--------|----------|------------|
| 1 | query_balance | query | multi |
| 2 | query_price | query | single |
| 3 | query_orders | query | multi |
| 4 | query_goals | query | multi |
| 5 | query_system | query | multi |
| 6 | query_tx_history | query | multi |
| 7 | query_contacts | query | multi |
| 8 | query_network | query | multi |
| 9 | send_kas | execute | single |
| 10 | publish_order | execute | single |
| 11 | cancel_order | execute | single |
| 12 | trigger_reflect | trigger | none |
| 13 | query_reputation | reputation | single |

## Adding a New Intent

1. Edit `intents.json` — add an object (keywords + category + params)
2. If new category: add executor function in `executor.mjs`
3. Restart Mind — registry auto-loads
4. No core code changes needed

## Adding a New Skill Package

```
agent-mind/src/skills/my-new-skill/
  skill.json       ← { id, version, name, intents, executor }
  intents.json     ← Intent definitions
  executor.mjs     ← export async function executeQuery(intent, params, config)
```

`registry.mjs` auto-discovers on Mind startup. Console DB activation required (same as single-file skills).

## Permission Model

```javascript
checkPermission(senderRelation, intentCategory)
  owner     → allow everything
  trusted/sibling → query OK, execute silent_deny
  stranger  → query OK, execute silent_deny
  blocked   → deny all
```

Execute intents silently denied for non-owners (no error returned, avoids probe detection).

## Preflight (Trade Safety)

`POST /api/trade/preflight` — called by Mind before executing trade actions in proactive mode.

Three layers:
1. **Mode**: manual → deny, approval → pending, auto → continue
2. **Limits**: per_order (1000 KAS), daily (5000 KAS), auto_mode (200 KAS)
3. **Cooldown**: 30 min between proactive trades

Fail-closed: if preflight unreachable, trade is blocked.

## Proactive Trading

Brain's proactive prompt now uses ACTION tags (not JSON):

```
[ACTION:PLACE_ORDER side=sell amount=100 price=0.04 market=exchange]
[ACTION:SEND_MESSAGE target=kaspa:q... message="hello"]
[ACTION:DO_NOTHING reason="no opportunity"]
```

`market` parameter routes to exchange, free_market, or both.

## Confirm Cards (Execute Intents)

When user triggers an execute intent through chat:
1. Mind generates confirm card JSON with one-time token
2. chat.eta renders amber card with params + approve/reject buttons
3. User clicks "确认执行" → POST /api/chat/confirm with token
4. Token consumed, action executed, result returned

## Query Cards (Multi-Dimension Data)

Multi-dimension query results wrapped as `query_card` JSON:
```json
{
  "type": "query_card",
  "intent": "query_balance",
  "label": "资产余额",
  "data": { ... },
  "summary": "Brain's interpretation"
}
```

chat.eta renders as blue data card + summary text below.

## Testing

```bash
# Query intent
curl -X POST http://localhost:3100/api/agent/reply \
  -H 'Content-Type: application/json' \
  -d '{"relayNodeId":"ID","peer":"owner:test","message":"balance"}'

# Execute intent (returns confirm card)
curl -X POST http://localhost:3100/api/agent/reply \
  -H 'Content-Type: application/json' \
  -d '{"relayNodeId":"ID","peer":"owner:test","message":"send 10 KAS to kaspa:qtest"}'

# Preflight check
curl -X POST http://localhost:3100/api/trade/preflight \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"ID","action":"PLACE_ORDER","amount":100,"side":"sell"}'

# Pending approvals
curl http://localhost:3100/api/trade/pending-approvals
```
