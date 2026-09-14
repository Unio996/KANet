> **Status**: CURRENT

# 字节预算 provenance — `docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.1.md`

支撑设计稿 §2（字节预算）/ §3（token_tmpl_hash 是否仍可 ctor-baked）里全部数字的可复现证据。

- `KanetTestToken.experimental-fixed.sil`：设计草案的实验性副本（**不是**生产文件，`kasia-console/src/lib/sil-v1/KanetTestToken.sil` 权威文件未改动一个字节）——市场模板锁改用 `market_tmpl_hash`(State) + `readInputStateWithTemplate`（详见设计稿 §1）。
- `run.mjs`：跑 `node ../docs/provenance/2026-09-14-j2-ktt-template-lock-fix-bytebudget/run.mjs`（从 `kasia-console/` 目录），复现：
  - 旧设计基线（5 字节 / 132 字节 `market_tmpl_suffix` 占位）脚本长度：3471 / 3867 bytes。
  - 新设计脚本长度：5359 bytes（净增 1888 bytes，相对 5 字节基线）。
  - 新设计 `token_tmpl_hash` 用两组截然不同的 `market_tmpl_hash`/`owner` 占位值编译，结果逐字节相同——确认已移出 ctor 后 KTT 自身模板身份真正独立于目标市场。

## 修正记录（2026-09-14 二次更新）

对照 `RootClaim.sil:91-92`（`ticket_prefix_len`/`ticket_suffix_len` 直接是 `int` entry 参数）才发现：`readInputStateWithTemplate(idx, prefixLen, suffixLen, hash)` **只需要长度（`int`），不需要调用方另外提供实际 prefix/suffix 字节**——它直接读目标 input 自己已在链上暴露的字节，按长度切片再核 hash。`KanetTestToken.experimental-fixed.sil`（v1）把 `mkt_prefix`/`mkt_suffix` 写成 `byte[]` witness 参数（只为取 `.length`）是画蛇添足。新增 `KanetTestToken.v2-lenonly.sil` 改用 `int mkt_prefix_len, int mkt_suffix_len` 直接传参——编译产物从 5359B 降到 4697B，KTT 侧 `transfer` 的 sigScript 从需要携带整段 `mkt_suffix`（可达 15,000+ 字节）降到只需两个小 int，但对 `register_append` 总体 `required_fee` 的影响不大（该交易成本大头是三个 20,000,000 sompi 输出各自的 storage mass，不是 witness 线性开销，见 `docs/provenance/2026-09-14-j2-bet-mint-stepB-register-append-mass-fee-estimate/`）。这条 int-长度写法是②/④两个候选共同的实现规范，不是只在某一个候选里改。

## 文件清单

- `KanetTestToken.experimental-fixed.sil`（v1，`byte[]` witness，已被 v2 取代，保留作对照）
- `KanetTestToken.v2-lenonly.sil`（v2，`int` 长度参数，正确写法）
- `run.mjs`
- `README.md`
- `MANIFEST.sha256`
