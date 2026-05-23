# KANet git hooks

## 安装

```bash
bash scripts/git-hooks/install.sh
```

会把本目录下所有 hook 复制到 `.git/hooks/` 并 `chmod +x`。

> .git/hooks/ 目录本身不被 git 跟踪，所以 hook 文件存在 `scripts/git-hooks/` 让仓库间能同步。

## 现有 hooks

### `post-commit`
commit 完后异步跑 test-framework 相关 domain 的 case，失败 broadcast dev-coord。
- **不阻塞 commit**（已经过了）
- **智能选 domain**：看 git diff 改了什么 → 推测哪个 domain（broker / future seeker / exchange）
- **console 不在跑 → 静默跳**（不报错）
- **PASS 静默 / FAIL 喧闹**（broadcast dev-coord 通报作者）

### `pre-commit`
- 跑 `lint-kanet.mjs` 检 ANTI-PATTERNS 规则（含 R37/R38 等机器 enforce backbone）。失败拒 commit。
- Advisory print：改非 critical 8 file 含 T-X-X / 撤回 / 灾难 / 不准 注释 → print warn（规 8 reviewer 必检 invariant 退化）。不 block。

### `commit-msg`（T-J1-2026-04-28）
docs/COLLAB-REFORM.md 规 13 + 规 10 机器 enforce：
- 阻塞：commit msg 缺 `coord-ack: <hash>` line → reject（规 13 0 容忍闷头干）
- 阻塞：改 critical 8 file 触发 anti-pattern grep → 必含 `acknowledged: T-X-X` line per surfaced（规 10）
- 例外：`bootstrap-exception: <reason>` line → 跳过 enforcement（chicken-and-egg）
- 例外：`coord-ack: emergency-Z<bug-id>` → 走 emergency SOP（规 13 emergency 6 SOP）
- Bypass merge / revert auto-generated msg

跟 pre-commit 互补：pre-commit 检 file content（lint + advisory），commit-msg 检 msg content（reform enforcement）。

完全跳过：`git commit --no-verify`（NEVER use unless Owner explicit，规 13 0 容忍）。

## 日志

`logs/post-commit-test.log` 记每次 hook 触发的 commit / domain / 输出。

## 详情

- 协作 reform 规 1-15 → `docs/COLLAB-REFORM.md`
- 测试框架设计 → `docs/TEST-FRAMEWORK.md`
- 写 case 教程 → `kasia-console/test-framework/README.md`
