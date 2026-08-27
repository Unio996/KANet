# 非交互会话推不了 git：GCM 的 wincredman 存储读不到 —— 换 dpapi 根治

> **Status**: CURRENT · J1 2026-08-27 · 运维/接位向

## 症状

任何**非交互会话**（SSH 进来的 agent 会话、无 TTY 的自动化）在本机跑 `git push` 必失败：

```
fatal: Unable to persist credentials with the 'wincredman' credential store.
bash: line 1: /dev/tty: No such device or address
error: failed to execute prompt script (exit code 1)
fatal: could not read Username for 'https://github.com': No such file or directory
```

而**同一台机器、同一个账号**在已登录的桌面会话里 `git push` 一切正常。表现上像"agent 没权限"，实则不是。

## 根因

`credential.helper=manager`（Git Credential Manager）默认用 **`wincredman`** 后端 = Windows 凭据管理器。
该后端**要求有交互桌面会话**才能读写；SSH 会话/服务会话拿不到，于是 GCM 退回交互提示 → 无 TTY → 失败。

`fetch` 看似正常会掩盖这一点 —— 公开仓匿名可读，**只有 push 需要认证**，所以问题只在写的时候暴露。

## 修法（一次性，之后永久非交互可用）

```powershell
# 1) 把 GCM 存储后端换成 dpapi(按【用户账号】DPAPI 加密的文件, 非交互会话可解)
git config --global credential.credentialStore dpapi

# 2) 在【已登录的桌面会话】里做一次认证(跑一次真实 push, 会弹浏览器登录)
cd D:\kanet-tn12; git push origin bshard-m3-deploy

# 3) 验证凭据已落新存储
dir $env:USERPROFILE\.gcm\dpapi_store -Recurse     # 应有内容
```

若第 2 步没弹登录（直接用了旧 wincredman 凭据、新存储没写入），强制重认证：

```powershell
"protocol=https`nhost=github.com`n" | git credential reject
git push origin bshard-m3-deploy
```

## 验收判据（不是"看着像成了"）

非交互会话里跑，能取到 username/password 才算数：

```powershell
"protocol=https`nhost=github.com`n`n" | git credential fill
# 期望: username=<账号> + password=<令牌>；两者都取到 = 非交互推送可用
```

实测（2026-08-27，J1 从 younio 经 SSH 打 da9）：修前两者皆 False；修后 `username=Unio996` + password 取到 ⇒ 通。

## 为什么值得记

- **这条卡住的是"自动化"本身**：不修，每次 push 都要人工介入一次，agent 交付链在最后一米断掉。
- **误判方向明显**：症状指向"凭据没配/权限不够"，真因是**存储后端与会话类型不兼容**。查的时候容易去折腾 PAT、SSH key（本机 `id_ed25519_kanet113/157` 对 GitHub 均 `Permission denied (publickey)`，试了也是白试），而正确的只是换个 store。
- 同族：`reference-harness-background-tasks-get-reaped-nohup-survives`、SSH 会话 Job Object 连坐杀 —— 都是**"交互会话 vs 非交互会话"能力差异**咬人，不是权限问题。

## 边界

- dpapi 存储按**用户账号**加密：同账号的非交互会话可解，**换账号（如 SYSTEM）不可解**。若日后把 agent 跑成服务/SYSTEM，需另行处理。
- 令牌仍在本机磁盘（DPAPI 加密），不是明文；比 `credential.credentialStore=plaintext` 安全。
