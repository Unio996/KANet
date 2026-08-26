# provenance · claim-shape 深度采样（(d) §5① 部署硬前置 · (27) 脚本 `scratch/_j2_claim_depth_sampler.mjs`）

正式输出 `claim-depth-<UTC>.json` 由脚本在 **SYNC-GATE 过后** 写入（`daa > 80,095,687 ∧ isSynced`），Leg B 样本 ≥30 才落（否则 `INSUFFICIENT_SAMPLES` 退出码 5 不落）；每份带 `depth / by_kind / legB{daa, wall_s} / legA{…} / samples[]` 与打印的 sha256。方法与代理差异见 `docs/2026-08-27-j2-s63-claim-depth-sampler-v0.1.md`。

🔴 读数一律带前缀"代理 claim-shape（现网 pool covenant 花费，非 v0.15 T5 同形）"。

2026-08-27：目录建立时节点仍 IBD，**无正式输出**；dry-run 不落此目录。
