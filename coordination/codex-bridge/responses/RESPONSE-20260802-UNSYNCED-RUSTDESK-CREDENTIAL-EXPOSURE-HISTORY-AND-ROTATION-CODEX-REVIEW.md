# Codex independent review — RustDesk credential exposure and history boundary

## Verdict

`PLAINTEXT_REMOTE_ACCESS_CREDENTIAL_EXPOSURE_CONFIRMED__WORKTREE_DELETION_ACCEPTED_AS_CONTAINMENT_ONLY__GIT_HISTORY_REMAINS_EXPOSED__IMMEDIATE_CREDENTIAL_ROTATION_REQUIRED__HISTORY_REWRITE_REQUIRES_SEPARATE_OWNER_COORDINATION__NO_PRODUCTION_OR_MONEY_PATH_AUTHORIZATION`

## Immutable inspection basis

- Active branch: `bshard-m3-deploy`
- Reviewed HEAD: `b351300296bcf5cc93e358987d2c6a696ae815aa`
- Commit action: deletes `docs/2026-08-01-rustdesk-remote-disconnect-diagnosis.md`
- The deletion diff itself proves that the prior committed file contained a reusable RustDesk permanent password, together with remote-access topology and endpoint details.

## Independent judgment

1. Deleting the file from the branch tip is a valid immediate containment step, because ordinary readers of the current worktree will no longer encounter or reuse the exposed credential.

2. The deletion does **not** remove the credential from Git history. The secret remains retrievable from the introducing commit, parent trees, clones, forks, caches, API responses, and any local checkout that fetched the affected history. Therefore the credential must be treated as compromised regardless of whether anyone is known to have used it.

3. The highest-priority remediation is credential invalidation, not documentation cleanup. The exposed RustDesk permanent password must be rotated or disabled immediately, and any unattended-access session/token derived from it must be revoked where supported. Reusing the same value with a cosmetic variant is not sufficient.

4. Git history rewrite is a separate operation with repository-wide coordination cost. It may reduce casual future discovery, but it cannot restore secrecy and must not delay rotation. Any rewrite requires explicit Owner coordination because it changes public commit identities and forces downstream clones/branches to reconcile.

5. The exposed document also included operational identifiers and access-path details. Those are not equivalent to a password, but after a credential leak they increase targeting value. Access controls should therefore be reviewed independently of password rotation: Tailscale membership, RustDesk unattended-access policy, ACL/device authorization, and remote-admin account exposure.

## Required evidence for closure

A closure receipt should record, without disclosing replacement secrets:

- old credential disabled/rotated;
- rotation authority and completion time;
- active sessions/tokens revoked or verified absent;
- Tailscale/RustDesk ACL and device membership reviewed;
- repository secret scan result for the exposed value and related credentials;
- decision on history rewrite, including Owner authorization if pursued;
- post-rotation connection test proving the old credential fails and the approved path still works.

Do not paste the replacement credential, access token, tailnet invite, private endpoint, or recovery secret into Git, bridge files, logs, or test fixtures.

## Boundary

This review authorizes no remote-login configuration change beyond urgent credential invalidation by the authorized operator. It does not authorize unattended privilege escalation, firewall weakening, node/relay restart, deployment, transaction construction, signing, broadcasting, refund, settlement, or any production/test-asset money-path action.
