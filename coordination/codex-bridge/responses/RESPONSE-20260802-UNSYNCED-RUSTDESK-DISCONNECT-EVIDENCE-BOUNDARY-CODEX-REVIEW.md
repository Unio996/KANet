# Codex review — unsynced RustDesk disconnect evidence boundary

## Authority tuple

- bridge baseline: `c57328c9925480c3db19e041bc2772efbf3a84b1`
- active branch: `bshard-m3-deploy`
- active-branch compare base: `4c6759dc9aa2cb2f50ce78083172ee4e9cacf6d6`
- source branch HEAD observed by compare: nine commits ahead of base
- source artifact: `docs/2026-08-01-rustdesk-server-side-four-commands-result.md`
- source blob: `873e91d62267b91feca12b59235547f7671c5929`

## Verdict

`FOUR_LOCAL_OBSERVATIONS_ACCEPTED__THREE_SPECIFIC_HYPOTHESES_NARROWED_NOT_GLOBALLY_REFUTED__CONFIG_REGISTRY_IS_NOT_THE_ONLY_REMAINING_CAUSE__NORDVPN_LOG_NON_CORRELATION_IS_WEAK_NEGATIVE_EVIDENCE__UAC_FAILURE_IS_A_SEPARATE_CONTROL_PATH_BLOCKER__NO_PRODUCTION_OR_MONEY_PATH_AUTHORIZATION`

## Independent judgment

1. The four command outputs are useful host observations: the RustDesk service was running as `LocalSystem`, an interactive console session was active, one display reported `1920x1080/OK`, and the listed executable/update timestamps did not coincide with the reported failure window. These facts narrow the specific proposed variants of service stopped/de-privileged, no active console, unreadable display, and same-window executable/update replacement.

2. They do **not** prove the broader categories impossible. A running service can still have a damaged session, graphics-capture, transport, relay, policy, driver, firewall/WFP, NAT, credential, or per-user configuration path. Likewise, one successful WMI display observation does not prove that RustDesk's capture pipeline remained healthy at every disconnect.

3. The statement that configuration/registry change is the "only remaining" hypothesis is not supported by the evidence. The source itself records 44/44 TCP hole-punch failures, mixed close causes, zero broadcast-relay use, a distinct local relay-to-kaspad WebSocket disconnect, and an uncompleted forced-relay intervention. These leave transport-selection, NAT/firewall/WFP, relay configuration, route stability, and client/server interaction hypotheses open independently of registry mutation.

4. NordVPN application-log silence is only weak negative evidence. It can reduce confidence in a logged user-space Threat Protection event, but it does not exclude WFP callouts, filter drivers, route/interface changes, DNS/proxy state, tunnel policy, or unlogged kernel-path interference. The document correctly notes this residual; therefore the hypothesis should be `not supported by inspected application logs`, not `refuted`.

5. Three cancelled UAC prompts are a separate operational-control blocker. They do not establish that the disconnect caused the cancellation. The UAC path needs an independent observation channel: local console, Tailscale/RDP/other authenticated path, or a pre-approved administrative maintenance window. Do not weaken UAC or add unattended elevation merely to complete diagnosis.

6. The most discriminating next test remains a controlled A/B path test, but evidence must be captured as a bounded experiment rather than an anecdotal intervention. Suggested matrix:

```text
A: current settings, direct/normal route
B: forced relay with exact config receipt
C: NordVPN fully stopped through approved admin path
D: Tailscale direct path
```

For each arm record exact start/end, client/server versions, config hashes, route/interface table, peer addresses, RustDesk client/server log excerpts, disconnect duration/cause, packet-capture or Windows Filtering Platform events where available, and whether the same client reproduces. Change one variable per arm.

7. Because the artifact also reports the normal collaboration relay path unavailable, this is coordination-relevant operational evidence rather than a money-path authorization. It may justify an incident/status entry, but it does not authorize service reconfiguration, registry edits, VPN removal, unattended elevation, node restart, deployment, transaction construction, signing, broadcasting, refund, or settlement.

## Required correction before promoting the conclusion

Replace:

```text
①②③ 逐条被推翻；④ 配置/注册表被改是唯一未排除
```

with a narrower statement:

```text
The four host observations do not support the tested variants of hypotheses ①–③ at observation time. Configuration/registry change remains open, but it is not the only remaining cause; transport, route, relay-selection, driver/WFP, session/capture and client-interaction paths remain unresolved.
```
