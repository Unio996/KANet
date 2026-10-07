# J2 → Bettor: 交付实现步 1 交件 — 密码学 + nonce 只走片段的护栏（零链）

分支 `coord/j2-delivery-impl-step1-20261007`（新提交）。设计 v0.2/v0.3 已合；本步 = v0.3 §5 步 1。**未碰链、未碰主网、未改表、未部署。**

## 交付物
| 项 | 位置 |
|---|---|
| 纯函数模块（零 import，浏览器与 Node 同一份，WebCrypto） | `kasia-console/src/lib/checkout-static/delivery-crypto.js` |
| 单测 21 条 | `.../delivery-crypto.test.mjs` |
| lint 规则 `R-DELIVERY-NONCE-IN-QUERY`（v0.3 §3 断言 d，硬阻塞）+ 阳性/阴性对照测试 11 条 | `scripts/lint-kanet.mjs`、`scripts/lint-delivery-nonce.test.mjs` |

## 模块做了什么
- 派生：`HKDF-SHA256(ikm=orderNonce(128 位), salt=订单地址, info=…/aead | …/mailbox/<ctr>)` → AES-256-GCM 密钥、信箱私钥（拒绝采样至 1 ≤ k < n）；信箱地址由调用方注入 kaspa-wasm 派生（本模块不引入 wasm）。
- AEAD：`"KDL1" ‖ iv(12) ‖ 密文‖tag`，关联数据 = `"kanet-delivery-v1|" + 订单地址`（换订单地址即解不开）；明文 ≤ 1024 B；失败一律返回 `null` 不抛——**"粘贴密文本地解密"与"读链取货"走同一个 `decryptDeliverable`，同一 AEAD 校验**（你补的那条）。
- `pickDeliverable(txs, currentBlueScore)`：读后端返回的地址历史里，**先验 AEAD 再看深度**（垃圾/他人密文忽略），仅 `isAccepted` 且深度 ≥ 20 才返回 `delivered`，否则 `pending_depth`/`none`。
- 发票链接：`buildInvoiceLink`（nonce 只进 `#n=`；公开参数里藏 nonce ≥8 位 hex 子串（含大写）、键叫 n、baseUrl 带片段、路径含 nonce ⇒ 抛）；`readNonceFromHash`（只认片段）；`takeNonceFromLocation`（读到即 `history.replaceState` 抹片段）。

## 断言覆盖（v0.3 §3 清单对账）
| # | 状态 |
|---|---|
| a 链接 query 零 nonce | ✅ 单测 + 变异（nonce 放进查询串 ⇒ 红） |
| b 买家页请求 URL 零 nonce | ⏳ 步 3（买家页落地时做拦截测试；本步已保证密码学模块无 fetch/XHR/WebSocket 的静态断言） |
| c replaceState 抹片段 | ✅ 单测 + 变异 |
| d 静态扫描 lint | ✅ 5 个坏写法阳性对照全抓到（退出码≠0）、4 个合法写法不误伤、规则关掉后对照臂变红（6 pass/5 fail）；范围仅 checkout-static；现有 7 个源文件零命中 |
| e console 日志/表扫描 + 阳性对照 | ⏳ 步 2/3（需 console 流程） |
| f `receiptLinkMismatch` 不读 hash | ✅ 单测（附加 `#n=` 不影响比对；`order-receipt.js` 源码无 `.hash`） |
| g 后台不展示 nonce | ⏳ 步 2 |

## 自查质量
- **已知答案 + 独立再实现**：固定 iv 的 payload 与 `node:crypto`（hkdfSync + aes-256-gcm，不经 WebCrypto/本模块）逐字节一致；跨实现互通（解密独立实现产出的密文）。
- 篡改：逐个字节位置翻转 payload（魔数/iv/密文/tag）全部 ⇒ `null`；畸形输入（截断/加长/奇数/非 hex/空/超长）⇒ `null` 不抛。
- 变异 8 条：去掉 AAD 绑订单地址 / nonce 进查询串 / 不抹片段 / 深度边界 ≥→> / 拒绝采样接受 0 / 不查魔数 / 去掉"先验 AEAD" / 去掉公开参数泄漏检查 —— **全部使对应测试变红**（其中最后一条首次变异没红：因为后面还有第二道守卫兜底，我把用例收紧到断言**具体守卫的报错**后才红，两道守卫现在各有各的用例）。

## 需要你知道
1. 本步**没有**新开口、没有读服务调用、没有链上字节；密文格式（魔数 `KDL1`、`iv` 12 B、AAD 前缀、HKDF info 字符串）已被 KAT 冻结——**这些一旦上主网就不能再改**，请审时当作"线格式"看。
2. 信箱面值/网络费、payload 转账入口仍是步 2 的 simnet 实测项。
3. 买家页（用户面）文案尚未写，步 3 前单独交你送 Owner 批。
