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

### `pre-commit`（已存在）
跑 `lint-kanet.mjs` 检 ANTI-PATTERNS 规则。失败拒 commit。

## 日志

`logs/post-commit-test.log` 记每次 hook 触发的 commit / domain / 输出。

## 详情

- 测试框架设计 → `docs/TEST-FRAMEWORK.md`
- 写 case 教程 → `kasia-console/test-framework/README.md`
