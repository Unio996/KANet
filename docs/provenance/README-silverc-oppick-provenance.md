# silverc OP_PICK-fix provenance (Codex (g) 门·铁律0.5 根治备份)

**捕获**: 2026-08-22 by Bettor (P1 (g) toolchain provenance 驱动)
**根治**: 铁律0.5 —— OP_PICK 承重修复此前只以未推本地分支存在, 树若丢则无声消失。本目录是 durable 备份。

## 事实(2026-08-22 实核)
- 修复 commit: `8065184` "Fix OP_PICK off-by-one in compile_byte_sequence_cast_call"
- 父 commit(base): `d25bd3427a093c17327ca3d6b9e1aa5f7688c863`
- 所在分支: `j2-oppick-fix-2026-07-06` (本地 /d/silverscript)
- 🔴 **remote 状态**: 未推任何 remote(`git branch -r --contains 8065184` = 空)。上游 github.com/kaspanet/silverscript 无此修复。
- patch 文件: `silverc-oppick-fix-8065184.patch` (SHA-256: `b92c549c496942f932364a40064b86db189c6348a8ab56a17b8d9fcd07044f6d`)
- 🔴 **更正(2026-08-22·J2 逮出·Bettor 原记错)**: OP_PICK-**fixed** 编译器二进制 = `/d/silverscript/versioned-builds/silverc-zk-8065184.exe` SHA-256 = **`9de7f2f682bc9e50...`**(commit 8065184, 见该目录 `MANIFEST.txt`)。
  - ⚠ **原记的 `e0e9b62c086df6b6...` 是【legacy pre-fix】那份**(`silverc-legacy-2c46231.exe` / commit 2c46231 / V1 族 pool-shard-register 用)——我当初 `sha256sum target/release/silverc.exe` 拿到的是 legacy(按设计 target/release 就是 legacy build, fixed 的版本化单独存放防覆盖, 见 MANIFEST 事故背景)。**照旧 hash 核验会核到【不含修复】的对象且不报错**(两 hash 都真、都核得过 = `reference-verification-tooling-fails-into-plausible-output` 那类坑, Codex 早警告"别拿 Jul-8 binary 当 derivation 证")。
  - ⇒ **fixed binary 确实存在**(9de7f2f6, 有 MANIFEST), 这比原记录更强; 但它仍是【观察】非【clean-rebuild derivation 证】(Codex item5 / J2 待做)。

## 恢复法(树若丢)
🔴 **patch 存于 KANet 仓 `D:/kanet-tn12/docs/provenance/`, 不在 silverscript 树里** —— 恢复命令必须用【绝对路径】引它, 否则从 /d/silverscript 相对路径解析不到会失败(Codex P1(g) 复审逮到原命令此 bug, 已修)。从干净机器:
```
cd /d/silverscript && git checkout d25bd3427a093c17327ca3d6b9e1aa5f7688c863 && git apply /d/kanet-tn12/docs/provenance/silverc-oppick-fix-8065184.patch
# 或: git am < /d/kanet-tn12/docs/provenance/silverc-oppick-fix-8065184.patch
# 若在别的机器/路径: 先把 KANet 仓的 patch 文件拷到本机, 再用其绝对路径 apply。
```

## item 5 实核(2026-08-22·Codex (g) 要求)— 无其它承重未推 patch
`git log --oneline --branches --not --remotes`(/d/silverscript)= **仅 1 个 commit: `8065184`**。⇒ 8065184 不是"更大未钉 toolchain delta"里的一员, 它是唯一的 local-only 承重修复。(另有 stash/index/untracked 的 WIP ref, 非分支承重 commit。)

## 🔴 未完(gate (g) 完整 PASS·J2 P1 owns)— Codex 复审锐化的 5 项
Codex P1(g) 复审: **MATERIAL PROGRESS / GATE (g) STILL OPEN**(接受本备份为 durable source-backup 里程碑)。完整 PASS 还需:
1. ✅ 已修: 恢复命令 clean-machine 可用(绝对路径, 见上)。
2. ✅ 已核(item 5): 无其它 local-only 承重 patch(仅 8065184)。
3. 🔴 推 8065184-fixed 源树到 durable remote(我们控制的)/tag, 或证明 clean-checkout+patch 从全新环境可跑通。
4. 🔴 钉死精确 Rust/Cargo/toolchain/依赖输入。
5. 🔴 clean rebuild 复现编译器行为 + 记源树 hash + 产物 hash; 若声称字节级同一 exe 须【证明】字节同一(现 silverc.exe SHA-256 只是观察、非 derivation 证)。
J2 主攻 3-5。
