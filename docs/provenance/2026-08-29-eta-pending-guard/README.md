# provenance · operator 面 `exchange.eta` PENDING 前缀 guard（§B2-6 落码）· J2 2026-08-29

- **分支**：`coord/j2-eta-pending-guard`（从 origin 头 `3605d366` 开；worktree `scratch/_wt_eta`；**不合并**——随 chains-explorer 等 Owner 一句）。改动只有 `kasia-console/src/ui/exchange.eta`（+12/−2）。
- **设计**：`docs/2026-08-29-j2-broker-money-path-deploy-runbook-draft.md` §B2-6（3 步：判据一行 `isPendingPaymentMarker` / `getPaymentTx` 对标记回 `null` / `:533` 旁同形 pending 行无 `<a>` 无 Copy）。零新文案（标签沿用既有 `Payment`）。
- **写方常量**：`trade-protocol-filter.js:2200 PAYMENT_INTENT_PREFIX = 'PENDING:'`（batch-2 `8473f1ec`）；判据前缀精确、大小写精确。

## 1. 向量 V1–V8（node，三函数逐字抠自分支 eta）
`node scratch/_j2_eta/vectors.mjs scratch/_wt_eta/kasia-console/src/ui/exchange.eta`（脚本副本：本目录 `vectors.mjs`）
```
[PASS] V1 marker in column: getPaymentTx null / :533 hidden / pending row shown / getExplorerUrl # / href null (no link) / copy payload null
[PASS] V2 real evm txid: byte-identical to pre-change (link bscscan, copy = tx, pending row hidden)
[PASS] V3 column null, meta real tx: unchanged (meta path)
[PASS] V4 column null, meta holds marker (defensive): getPaymentTx null, both rows hidden
[PASS] V5 exact prefix only: lowercase / no colon / leading space are NOT markers (treated as txid, as before)
[PASS] V6 finalize replaced marker by txid ⇒ same as V2
[PASS] V7 undefined / {} / bad meta JSON: null, both hidden, no throw
[PASS] V8 :1394 meta path untouched: source still reads m.payment_tx directly (not via getPaymentTx)
8 PASS / 0 FAIL
```
（V8 = Bettor GO 要求的「`:1394` meta 路不受影响」源级钉死。）

## 2. DOM 级手核（headless Edge，离线页）
- 页面 = 分支 eta **逐字** `:532-548`（`:533` 链接行 + 新 pending 行）+ 本仓 `kasia-console/public/alpine.min.js` + `public/kanet-ui.js:154-164 explorerTxUrl` 逐字，三个 `x-data` 段各喂一组 offer。生成器与断言见本目录 `dom-assert.txt` 的产生命令（`scratch/_j2_eta/dom-check.html`，含 Alpine 体不入库）。
- `msedge --headless=new --screenshot` ⇒ `dom-check-V1-V2-V7.png`（**sha256 前 16 = `b868d7d88d85ff9c`**）；`--dump-dom` 后逐行断言：

| 段 | `:533` 链接行 | pending 行 |
|---|---|---|
| V1 `payment_tx='PENDING:ab12cd34:9f8e7d6c'`,bnb | **hidden**（`display:none`）、`<a>` **无 href**、Copy 按钮在隐藏行内 | **visible**、文本 `PENDING:ab12cd34:9f8e7d6c`、**0 按钮、无 `<a>`** |
| V2 `payment_tx='0xa1…'`,bnb | visible、`href=https://bscscan.com/tx/0xa1…`、1 Copy | hidden |
| V7 `{}` | hidden | hidden |

截图肉眼：V1 一行 `Payment PENDING:ab12cd34:9f8e7d6c bnb` 纯文本无下划线无按钮；V2 `0xa1…` 蓝色链接 + Copy 图标 + `bnb`；V7 空。

- 🔴 **如实记一次 harness 自错**：第一版测试页把 `explorerTxUrl` 切片时带了尾逗号 ⇒ `window.KANet` 语法错 ⇒ `:href` 表达式抛错、所有 `<a>` 的 href 皆空，而 `x-show` 仍正确 ⇒ 第一张截图"看起来对"但 href 断言无信息。修掉尾逗号后重跑，上表与截图是**第二次**的结果（第一张已覆盖）。判据：**截图证明可见性，不证明链接——链接必须从 dump-DOM 的 `href` 属性读。**

## 3. 复核命令
```
cd scratch/_wt_eta && git diff origin/bshard-m3-deploy --stat            # 1 file, +12 −2
node scripts/lint-kanet.mjs kasia-console/src/ui/exchange.eta            # 0 errors
node ../_j2_eta/vectors.mjs kasia-console/src/ui/exchange.eta            # 8 PASS / 0 FAIL
sha256sum docs/provenance/2026-08-29-eta-pending-guard/dom-check-V1-V2-V7.png   # b868d7d8…
```
