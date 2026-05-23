# Persona Protocol (v1)

Personas simulate real users in multi-turn conversations with broker.

## Interface

Each persona module exports default object:

```js
export default {
  id: 'cn_newbie',          // unique id
  name: '中文新手',          // display name
  description: '...',        // what this persona simulates
  initialState() {           // returns starting state object
    return { turn: 0, fields: {}, ... };
  },
  step(state, brokerReply) {
    // state: persona internal state (mutable, runner persists)
    // brokerReply: broker's reply to previous user message (null on first turn)
    // returns: { message, nextState, done }
    //   message: string user message to send (or null if done)
    //   nextState: updated state for next turn
    //   done: true if conversation complete (e.g. confirmed / cancelled)
  },
};
```

## v1: Deterministic personas

State machine + template phrasing. No LLM. Fast, reproducible, 0 cost.
Used in regression tests + nightly fuzz.

## v2 (future): LLM-enhanced

Persona instruction → Qwen3.6 → natural phrasing keyed off broker reply.
Used in adversarial/exploratory tests.

## Runner integration

Use `persona_turn` action in case steps:

```js
{ action: 'persona_turn', persona_id: 'cn_newbie', state_key: 'persona_state', from_peer: 'kaspa:...', to_relay_id: relayId('trader-b') }
```

Runner:
1. Lazy-init `ctx.vars[state_key]` from persona.initialState() if absent
2. Lookup previous broker reply from `ctx.lastReply`
3. Call `persona.step(state, prevReply)` → message + nextState
4. If done, mark step as terminal (case can loop until done)
5. Send message via send_message under the hood, capture reply
6. Update `ctx.vars[state_key] = nextState`, `ctx.lastReply = reply`

This lets cases write `persona_turn` repeatedly to drive multi-turn flow without
hardcoding every user message — the persona reacts to broker behavior dynamically.
