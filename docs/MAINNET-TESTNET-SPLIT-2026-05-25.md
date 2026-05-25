# Mainnet / Testnet 物理分离 — Audit + 实施方案

**生成**: 2026-05-25 by J1
**触发**: Owner 5/25 钦定 "物理文件架绝对独立, 不相互污染"
**状态**: AUDIT 完成 / 等 Owner ack backup 策略 / 等 Bettor 审核 split plan / 才执行

---

## 0. 当前 inventory (= 实测, 0 file changed)

### 🔴 MAINNET `/d/Anthropic` (= 真资产线)

| 资产 | 数量 | 状态 |
|---|---|---|
| Kaspa relay (有 mnemonic) | **5** (Sophie / Martin / Kasia_1 / Eric / Qwen) | 加密 in `relay_nodes.mnemonic_encrypted` |
| **Kaspa 总余额** | **9.5006 KAS** (Sophie 1.59 + Martin 1.59 + Kasia_1 1.58 + Eric 0 + Qwen 0) | 链上真实 |
| `agent_wallets` (EVM/SOL/TRON 私钥) | **11** (BNB×6 / ETH×2 / Polygon×1 / SOL×1 / TRON×1) | 加密 `privkey_encrypted` |
| `exchange_accounts` (CEX API key) | **5** (mexc / gateio / bybit / kucoin / bitget) | 加密 `api_key_encrypted` + `api_secret_encrypted` |
| `console.db` 大小 | **718 MB** (= 历史 chain_events / messages / monitor_events 累积) | 单 file |
| `kanet.env` | 含 `CONSOLE_ENCRYPTION_KEY` (= 64-char hex, 解密 ALL 资产唯一钥匙) | 单 file |

### 🟢 TESTNET `/d/Anthropic/kanet-tn12` (= 测试线, 共 .git with mainnet)

| 资产 | 数量 | 状态 |
|---|---|---|
| Kaspa relay (有 mnemonic) | **9** (J1tn-{Alice/Bob/Carol/Dave/Eve} + pred-{maker/taker/broker} + 其他) | 加密 |
| Kaspa testnet 余额 | **0 KAS** (faucet 可补, 无价值) | — |
| `agent_wallets` | **0** | — |
| `exchange_accounts` | **0** | — |
| `console.db` 大小 | 4.9 MB | — |
| `kanet.env` | 含独立 `CONSOLE_ENCRYPTION_KEY` (= 跟 mainnet 同 OR 不同, 待 Owner verify) | — |

### 现有备份状态

| 备份 | 时间 | 完整度 |
|---|---|---|
| `/d/Anthropic/KANet-deploy.tar.gz` | 4/27 | 8.4 MB, **非完整 DB** |
| `/d/Anthropic/qwen*.tar.gz` | 4/20-4/27 | toolchain, **非资产** |
| `/d/Anthropic/backups/agent-adapter-20260310_210256/` | 3/10 | adapter only |
| `console.db.fixture-backup-2026-04-13` | 4/13 | **完整 DB 但 6 周前**, 4/14 之后所有 wallet/balance 缺失 |
| **完整最近 mainnet console.db 备份** | — | **🔴 0** |
| **Off-disk 备份** (= 不在 D 盘) | — | **🔴 0** |

---

## 1. 🚨 风险评级

| 风险 | 级别 | 触发 | 影响 |
|---|---|---|---|
| D 盘硬件故障 | 🔴 critical | disk crash | 9.5 KAS + 11 EVM wallet + 5 CEX API 全丢 |
| `CONSOLE_ENCRYPTION_KEY` 丢 (= 文件删/改/typo) | 🔴 critical | kanet.env 受损 | DB 仍在但 0 解密 = 资产永丢 |
| 误删 `/d/Anthropic` 不备份 | 🔴 critical | rm -rf 失误 | physical 全丢 |
| 跨网络 mnemonic 复制 | 🟡 medium | mainnet key 拷到 testnet host | testnet 玩崩 / 截图分享 → mainnet key 泄露 |
| 4/13 fixture 备份过旧 | 🟡 medium | 重建只能回 4/13 | 4/14+ 新 wallet / 余额变化全丢 |
| split 操作中断 (= 半路 fail) | 🟡 medium | 移动文件中途 stop | 文件分散 2 处, 不知哪个 authoritative |

---

## 2. 必须执行的 safeguards (= 动 split 前)

### Step S1: 完整 tar 备份 mainnet
```bash
cd /d
tar czf mainnet-backup-20260525.tar.gz Anthropic/kasia-console/data/ Anthropic/kanet.env Anthropic/kasia-relay/ Anthropic/kasia-scout/ Anthropic/agent-mind/ Anthropic/agent-adapter/
# 预计 ~700 MB+ 含 console.db
```

### Step S2: 完整 tar 备份 testnet
```bash
cd /d
tar czf testnet-backup-20260525.tar.gz Anthropic/kanet-tn12/
# 预计 ~10-20 MB
```

### Step S3: 第二份 backup 到不同 disk
- 把 `mainnet-backup-20260525.tar.gz` + `testnet-backup-20260525.tar.gz` 复制到:
  - C 盘 (= 不同 disk, D 盘 fail 也有 fallback)
  - U 盘 (= off-machine, 物理盗窃/失火/雷击 也有 fallback)
  - (可选) 网盘 (= 异地, 但加密 mnemonic 上传 OK)

### Step S4: CONSOLE_ENCRYPTION_KEY 单独抄写
- 纸 / password manager / encrypted note
- 跟 backup tar 分离 (= 不一份 leak = 资产 leak)
- (= 这是 disk 全 fail 时最后保命 — 知道 key + 知道 mnemonic 算法 (BIP39+BIP32) = 能从纸 + 链上 address 重派生)

### Step S5: 链上 address 列表 export
```
mainnet addresses:
  Sophie: kaspa:qpjjv2uhj22592mq76kqr3v6...
  Martin: kaspa:qptg465n4jedfujewj3hfgkx...
  Kasia_1: kaspa:qptle8yz34q3nw4zezje4nnu...
  Eric: kaspa:qqjdpjp0tskthe4xtvq2juhp...
  Qwen: kaspa:qqp49k5hfydlel0x5t6akj7u...
  (+ 11 EVM addresses)
```
单独 file (= 链是真相, 备份是索引)

### Step S6: DB 解密 dry-run
- 把 backup tar 在 C 盘 temp 解, 用同 CONSOLE_ENCRYPTION_KEY 启动一个 **read-only** console
- 验证: mnemonic 真能解 + 地址真能派生 + 链上余额真能查
- 证明备份完整可用 (= 不是 dead bits)

---

## 3. Split 思路 (= 7 条原则)

1. **目录层物理隔离** — 不同盘符 / 不同根目录, **不**子目录, **不** git worktree
2. **git 仓库独立** — 每网络一独立 `.git`, **不**共享 history, **不**靠 branch 区分
3. **配置独立** — 各有自己的 `kanet.env` / DB / logs / pids, 0 共享
4. **进程独立** — `kanet-start.sh` 各自目录跑, 不同 port (mainnet 3100 / testnet 3300)
5. **GitHub repo 独立** — 推荐两 repo (`KANet-mainnet` + `KANet-testnet`), 不同 origin
6. **commit 单向流动** — testnet 验证 → Owner 显式 ack → cherry-pick to mainnet. mainnet → testnet **0** cross
7. **物理 disk layout 终态**:
   - `C:/KANet-mainnet/` ← mainnet 唯一
   - `D:/kanet-testnet/` ← testnet 唯一

---

## 4. 5 决策点 + J1 推荐

| # | 决策 | 选项 | J1 推荐 | 理由 |
|---|---|---|---|---|
| D1 | mainnet 位置 | (a) `C:/KANet-mainnet` / (b) `/d/kanet-mainnet` / (c) 其他 | **(a)** | 不同盘最强物理隔离, D 盘 fail mainnet 安全 |
| D2 | GitHub 策略 | (a) 同 repo 两 branch / (b) 两独立 repo / (c) testnet LAN-only | **(b)** | 同 repo 仍可 cherry-pick 误操作 (= 我之前犯过); 两 repo 物理 0 cross |
| D3 | 现 origin/master 污染 | (a) revert force-push / (b) 留旧 master, mainnet 从精选 clean commit / (c) 接受污染 | **(b)** | force-push 破坏其他人 working state; (c) 矛盾思路 |
| D4 | kanet-tn12 worktree | (a) 删 worktree, 单 root / (b) split 独立 clone / (c) 其他 | **(b)** | worktree 共 .git 跟 D2=(b) 矛盾; testnet 也要 fresh clone |
| D5 | 切换窗口 | (a) 30-60 min downtime / (b) staged平滑 | **(a)** | 简单, 错误向量少; testnet 0 真用户 |

---

## 5. 实施方案 (= 等 Owner ack + Bettor 审核才动)

### Phase 0: backup (= S1-S6 上面)

### Phase 1: 准备 mainnet repo on C 盘
```bash
# GitHub 创建 KANet-mainnet (Owner 操作)
mkdir -p /c/KANet-mainnet
cd /c/KANet-mainnet
git init
git remote add origin https://github.com/<owner>/KANet-mainnet.git
# Copy 现 /d/Anthropic working tree (但不 .git) → /c/KANet-mainnet
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'logs' --exclude 'bundles' /d/Anthropic/ /c/KANet-mainnet/
# fresh commit 现状 (= clean start)
git add -A
git commit -m "init mainnet repo at 2026-05-25 — from /d/Anthropic state"
git push origin master
```

### Phase 2: 准备 testnet repo (= 同 D 盘 但 rename + 独立 .git)
```bash
# GitHub 创建 KANet-testnet (Owner 操作)
# 移 /d/Anthropic/kanet-tn12 内容 → /d/kanet-testnet
mv /d/Anthropic/kanet-tn12 /d/kanet-testnet
# 此时 /d/kanet-testnet 仍 worktree of /d/Anthropic
# 解 worktree + init fresh
cd /d/kanet-testnet
rm -rf .git  # 或 git worktree remove from /d/Anthropic
git init
git remote add origin https://github.com/<owner>/KANet-testnet.git
git add -A
git commit -m "init testnet repo at 2026-05-25 — from /d/Anthropic/kanet-tn12 state"
git push origin master
```

### Phase 3: 旧 /d/Anthropic 处理
- Option A: rename → `/d/Anthropic-DEPRECATED-2026-05-25` 保留 N 月作 fallback
- Option B: 验证 mainnet + testnet 全 OK 后, `rm -rf /d/Anthropic` (= 真彻底)
- 推荐 A → 30 天后再 B

### Phase 4: kanet.env 路径更新
- `/c/KANet-mainnet/kanet.env`:
  - `KANET_ROOT=/c/KANet-mainnet`
  - 保留同 `CONSOLE_ENCRYPTION_KEY` (= mainnet 资产解密)
- `/d/kanet-testnet/kanet.env`:
  - `KANET_ROOT=/d/kanet-testnet`
  - 保留同 `CONSOLE_ENCRYPTION_KEY` (= testnet 资产解密)

### Phase 5: 启动各自 service
```bash
cd /c/KANet-mainnet && bash kanet-start.sh
cd /d/kanet-testnet && bash kanet-start.sh
```
verify:
- mainnet console http://127.0.0.1:3100 → 5 relay + 9.5 KAS balance shown
- testnet console http://127.0.0.1:3300 → 9 relay + testnet KAS shown
- agents 真 active / 真能 receive DM / 真能 sign TX

### Phase 6: 清理 (= Phase 3 后)
- 30 天观察期: 0 issue 则 `rm -rf /d/Anthropic-DEPRECATED-2026-05-25`
- backup tar 保留 90 天

---

## 6. 总时间估算

- Phase 0 (backup): ~30 min (= 700 MB tar + copy)
- Phase 1 (mainnet init): ~15 min
- Phase 2 (testnet init): ~10 min
- Phase 3 (rename): ~2 min
- Phase 4 (env update): ~5 min
- Phase 5 (启动 + verify): ~20 min
- **Total: ~80-90 min** (= acceptable downtime)

---

## 7. ack 矩阵 (= 谁 ack 什么)

| 内容 | Owner ack | Bettor ack | J1 ship |
|---|---|---|---|
| inventory 对吗 | ✅ 必 | — | — |
| 5 决策选择 (D1-D5) | ✅ 必 | ✅ 必 | — |
| 备份策略 (S1-S6) | ✅ 必 | — | ✅ 执行 |
| 实施方案 (Phase 1-6) | ✅ 必 | ✅ 必 | ✅ 执行 |
| 旧 /d/Anthropic 清理 (Phase 3 B) | ✅ 必 (30 天后再) | — | ✅ 执行 |

---

## 8. J1 当前 standby 状态

- **0 file moved**
- audit 完成
- 等 Owner ack inventory + 备份策略
- 等 Bettor 审核 5 决策 + 实施方案
- 全 ack 后 ship Phase 0 backup → 验证 → ship Phase 1-5

**FILE END.** 提交时间: 2026-05-25 by J1.
