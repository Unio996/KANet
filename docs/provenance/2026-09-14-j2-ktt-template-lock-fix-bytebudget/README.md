> **Status**: CURRENT

# 字节预算 provenance — `docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.1.md`

支撑设计稿 §2（字节预算）/ §3（token_tmpl_hash 是否仍可 ctor-baked）里全部数字的可复现证据。

- `KanetTestToken.experimental-fixed.sil`：设计草案的实验性副本（**不是**生产文件，`kasia-console/src/lib/sil-v1/KanetTestToken.sil` 权威文件未改动一个字节）——市场模板锁改用 `market_tmpl_hash`(State) + `readInputStateWithTemplate`（详见设计稿 §1）。
- `run.mjs`：跑 `node ../docs/provenance/2026-09-14-j2-ktt-template-lock-fix-bytebudget/run.mjs`（从 `kasia-console/` 目录），复现：
  - 旧设计基线（5 字节 / 132 字节 `market_tmpl_suffix` 占位）脚本长度：3471 / 3867 bytes。
  - 新设计脚本长度：5359 bytes（净增 1888 bytes，相对 5 字节基线）。
  - 新设计 `token_tmpl_hash` 用两组截然不同的 `market_tmpl_hash`/`owner` 占位值编译，结果逐字节相同——确认已移出 ctor 后 KTT 自身模板身份真正独立于目标市场。

## 文件清单

- `KanetTestToken.experimental-fixed.sil`
- `run.mjs`
- `README.md`
- `MANIFEST.sha256`
