# Contributing to KANet

Thanks for wanting to contribute. KANet exists to give every user their own AI agent on a truly decentralized chain. Your contributions strengthen that vision — or, if they push in the opposite direction, they make the project worse for everyone. Please read this before opening a PR.

---

## The spirit of the project

KANet is **protocol infrastructure**, not a product. We build primitives — secure communication, on-chain identity, value settlement — and stop there. We do not build the businesses on top. We do not run the services. We do not take platform fees. We are the road, not the car.

This means:

- **Every user runs their own node.** There is no "KANet Inc." server to connect to. If a change makes KANet harder to self-host, it probably shouldn't land.
- **The chain is the truth.** Local databases are just indexes. Any state must be reconstructable from on-chain data.
- **No hidden trust.** If a user can't verify something on-chain, we don't treat it as real.
- **No lock-in.** AI providers, RPC endpoints, exchanges — all swappable. Abstractions should never assume a specific vendor.
- **The vision is users owning their agents.** Not us, not a foundation, not a DAO treasury. Users.

If your change conflicts with any of the above, it probably won't be merged, no matter how technically elegant.

---

## What we're looking for

**Enthusiastically welcome:**

- **New skills** — Trading strategies, social behaviors, market analysis, anything that makes an agent more capable on its own
- **New adapters** — Support for more AI providers (local or hosted)
- **New market data sources** — More price feeds, more data sources, more chains
- **Protocol improvements** — Better encryption, smaller messages, new message types with clear use cases
- **Documentation** — Tutorials, architecture explanations, trap documentation, translations
- **Security audits** — Report issues privately first (see below), then PRs to fix
- **Test coverage** — Especially for trade state machines, encryption, and on-chain interaction paths
- **Portability** — Cross-platform startup scripts (currently Windows-first), Linux/macOS tooling
- **Bug fixes** — Always. Please include a test or a way to reproduce

**Probably not welcome:**

- **Features that centralize.** Anything that requires "our server," "our API," or "our hosted version." KANet has no center.
- **Premium tiers, platform fees, payment middleware.** The protocol is free. Users trade peer-to-peer. We take nothing.
- **Vendor lock-in.** "Only works with X provider" is a code smell.
- **Speculative abstractions.** Three similar lines of code is fine. Wrapping them in a factory pattern for hypothetical future cases is not.
- **Scope creep.** A bug fix doesn't need to refactor surrounding code. A feature doesn't need a config system. Match the scope of the PR to the scope of the change.
- **Anything that hides from the user.** Silent fallbacks, swallowed errors, hidden state. If something fails, the user should know.

---

## Before you write code

**Read these first:**

- [`docs/DEVELOPER-GUIDE.md`](docs/DEVELOPER-GUIDE.md) — The single source of truth. 15 chapters. Read the parts relevant to your change.
- [`docs/DATABASE.md`](docs/DATABASE.md) — Every table, every column, who writes, who reads. Required reading before any schema change.
- [`docs/kanet-investigation-methodology.md`](docs/kanet-investigation-methodology.md) — The six-layer debugging process. Required reading before reporting any "bug that doesn't make sense."

**For non-trivial changes, open an issue first.** Describe what you want to change and why. Get alignment before writing code. This saves both of us time.

---

## Core principles (violate these and the PR bounces)

These are enforced, not suggestions:

1. **NO TX NO STATE CHANGE.** If a transaction doesn't make it to the chain, local state must not advance. Never optimistically write state and fix it later. Try-catch that swallows a broadcast failure is a bug, not error handling.

2. **Don't guess code — check first.** Column names, function names, paths. Every reference must be verified against the actual code. Comments and memory are not authoritative; the code is.

3. **Read before you write.** Understand existing code before modifying it. If you don't understand why a check exists, it exists for a reason you haven't found yet.

4. **Inherit and improve, don't replace.** Existing functionality must not regress. If you're replacing something, the replacement must cover every case the old code covered.

5. **Test before delivery.** Don't make the maintainer your tester. For UI changes: actually open a browser and click the thing. For backend changes: run the code path end-to-end.

6. **Explain what you changed.** Even the small things — renamed label, adjusted padding, tweaked a comment. The PR description is where reviewers discover what to look at.

7. **Verify every code path that spends money.** The chain charges for every mistake. If a function can broadcast a transaction, every branch must handle the outcome — including failures.

8. **Investigate anomalies through the six layers.** Scenario → real data → protocol → execution logic → data flow → storage. Don't skip steps. Report findings before proposing fixes.

---

## Development setup

```bash
git clone https://github.com/Unio996/KANet.git
cd KANet
bash install.sh          # cross-platform: deps + env scaffolding
bash kanet-start.sh      # Windows (Git Bash). Linux/macOS: see install.sh output
```

See [`README.md`](README.md) for the full getting-started flow.

**For testing against a live chain:** Use Kaspa testnet (TN12) or a very small amount of mainnet KAS. Do not use a funded mainnet wallet for development.

---

## Pull request process

1. **Fork** and create a branch with a descriptive name (`fix/ledger-broadcast-sort`, not `patch-1`)
2. **Keep PRs focused.** One feature or fix per PR. Don't bundle unrelated changes.
3. **Write a clear PR description**: what, why, how to test, any risks
4. **Self-review your diff** before submitting. Delete debug prints, commented-out code, and accidental whitespace changes.
5. **Match the existing code style.** No project-wide reformatting in feature PRs.
6. **Update docs** if you changed behavior that's documented. `DEVELOPER-GUIDE.md` and `DATABASE.md` are the main ones.
7. **Be patient with review.** KANet is a small project; reviews may take a few days.

---

## Security

**Found a vulnerability?** Do not open a public issue. Email the maintainer directly (see the repository's primary contact) with:

- Description of the issue
- Steps to reproduce
- Potential impact
- A suggested fix if you have one

We'll respond, confirm the issue, coordinate a fix, and credit you in the fix commit. Responsible disclosure is appreciated and will not be punished.

**Especially sensitive areas:**

- Private key handling in `kasia-relay/`
- Encryption key management (`CONSOLE_ENCRYPTION_KEY`)
- Cross-chain verification logic (`cross-chain-verify.mjs`)
- Trade state machines (`order-machine.js`, `exchange-machine.js`)
- Fund lock logic

---

## Code of Conduct

Be kind. Disagree about technical decisions, not people. If you're rude, your PR gets closed regardless of merit.

English and 中文 are both welcome in issues, PR descriptions, and code comments. Pick whichever communicates the idea most clearly. Source code identifiers (variable names, function names) should be English.

---

## License

By contributing, you agree that your contributions will be licensed under the same [AGPL-3.0](LICENSE) license that covers the project. Your commits are yours; your contributions are open.

---

## Questions?

- Open a [Discussion](../../discussions) for questions that aren't bugs
- Open an [Issue](../../issues) for bugs and feature requests
- Read [`docs/DEVELOPER-GUIDE.md`](docs/DEVELOPER-GUIDE.md) — it probably has the answer

Thanks for helping build a decentralized, agent-native economy.
