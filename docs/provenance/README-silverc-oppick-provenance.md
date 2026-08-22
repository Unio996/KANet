# silverc OP_PICK-fix provenance (Codex (g) 门·铁律0.5 根治备份)

**捕获**: 2026-08-22 by Bettor (P1 (g) toolchain provenance 驱动)
**根治**: 铁律0.5 —— OP_PICK 承重修复此前只以未推本地分支存在, 树若丢则无声消失。本目录是 durable 备份。

## 事实(2026-08-22 实核)
- 修复 commit: `8065184` "Fix OP_PICK off-by-one in compile_byte_sequence_cast_call"
- 父 commit(base): `d25bd3427a093c17327ca3d6b9e1aa5f7688c863`
- 所在分支: `j2-oppick-fix-2026-07-06` (本地 /d/silverscript)
- 🔴 **remote 状态**: 未推任何 remote(`git branch -r --contains 8065184` = 空)。上游 github.com/kaspanet/silverscript 无此修复。
- patch 文件: `silverc-oppick-fix-8065184.patch` (SHA-256: `b92c549c496942f932364a40064b86db189c6348a8ab56a17b8d9fcd07044f6d`)
- 编译器二进制 silverc.exe (Jul 8 build) SHA-256: `e0e9b62c086df6b6a63344cbbbd21a0d176af76c5a869826131a879ff06a2c06`

## 恢复法(树若丢)
```
cd /d/silverscript && git checkout d25bd3427a093c17327ca3d6b9e1aa5f7688c863 && git apply docs/provenance/silverc-oppick-fix-8065184.patch
# 或 git am < patch
```

## 🔴 未完(J2 P1 owns)
本备份 de-risk 了"无声消失", 但 Codex (g) 完整 PASS 还需: ① 推分支到 durable remote(我们控制的) ② 确定性重建指令(cargo build 精确 toolchain/rustc 版本)+ 重建出字节级同一 silverc.exe 验证 ③ 确认无其它 local-only 未推承重修复。J2 主攻。
