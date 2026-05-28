# Track A Keyword Blocklist (= 公开频道泄露防护)

> **用途**: dev-channel public (kanet-*) 频道 + /api/v1/* 公开 API 绝不能泄露 Track A (= Owner 个人 mainnet 工具) 内容。
> **维护**: `scripts/audit-track-a-keywords.mjs` 扫 broadcast_messages WHERE visibility='public', 命中关键词 → 强制 visibility='internal' + 告警。
> **建立**: 2026-05-28 (KANet-UI Tier 1 缺件 fill, spec §2.D)
> **lint rule**: 加新 public-facing broadcast 前, 人工 OR 脚本扫此 list。

---

## 0. 原则

Track B (= KANet 协议公开) vs Track A (= Owner 个人 mainnet 工具) 双轨。dev-channel 公开频道是 Track B。任何 Track A 内容混入 public visibility = 泄露。

宁可误杀 (= 把不确定的标 internal), 不可漏放 (= Track A 泄露不可逆, 链上永存)。

---

## 1. 硬封锁关键词 (= 命中即强制 internal)

### 1.1 Mainnet 标识
- `kaspa:qq` / `kaspa:qr` / `kaspa:qz` (= mainnet 地址 prefix, 注意 testnet 是 `kaspatest:`)
- `mainnet`
- `主网` (= 中文 mainnet)
- `生产环境` (= production)

### 1.2 Owner 个人身份
- `fossamagnadl` (= Owner email prefix)
- `Unio996` (= Owner GitHub)
- `Owner 个人` (= Owner personal references in operational context)

### 1.3 真实资金 / CEX
- `Gate.io` / `gate_api` / `cex_api_key`
- `真金` / `真钱` / `real money` / `real funds`
- `mainnet KAS` / `主网 KAS`
- 大额数字 + KAS pattern (= e.g. "1028万 KAS" mining pool source — 人工 review)

### 1.4 Track A agent persona (= mainnet 个人 agent)
- `Sophie` / `Eric` / `fossa-stable` (= Owner 个人 chater agents)
- `Trader-B` (= Owner 个人 broker, mainnet)
- mainnet relay UUID (= 5b236c08 NWT mainnet 等, 人工维护具体 UUID list)

### 1.5 内部协调泄露
- `dev-coord-testnet` 内部 broadcast 原文 (= 内部频道不该出现在 public)
- 内部 r-number broadcast (= `[KANet-UI-tn rNN]` 这种内部 convention 不该 public)

---

## 2. 软警告关键词 (= 命中告警, 人工 review 不自动 flip)

- `Owner` (= 出现频繁, 多数无害, 但 operational context 需 review)
- `钦定` (= Owner 决策, 多数内部)
- 私有 IP (= 192.168.x.x / 10.x.x.x / 127.0.0.1)
- 文件系统路径 (= `D:/` / `C:/` / `/d/kanet`)

---

## 3. 白名单例外 (= 这些 OK public)

- `kaspatest:` (= testnet 地址, 公开 OK)
- `testnet` / `测试网` (= 公开 OK)
- KANet 协议术语 (= envelope / intent / pair / group 等 spec 词)
- MIT / open source / fork (= Track B 鼓励)

---

## 4. 维护流程

1. 撞新 Track A 泄露类型 → 立加本 list 对应分类
2. 跑 `node scripts/audit-track-a-keywords.mjs` 扫存量
3. 误杀 (= 白名单该放的被 flip) → 加 §3 白名单
4. 季度 review (= 关键词集随 Track A 工具演进更新)

---

— Maintained by KANet-UI, last updated 2026-05-28
