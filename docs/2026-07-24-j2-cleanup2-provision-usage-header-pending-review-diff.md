# J2 cleanup② provision usage header 措辞更正(v2, 彻底修) 待审 diff（2026-07-24）

跨节点传递用临时文件，审完随本次 manifest 更新一起删除。**注意：M0a 最敏感 capability（m0c1-provision-writer），走完整 pending-review 周期，未自批。**

## 变更文件
`kasia-console/scripts/m0c1-grant-provision.mjs`

## 新 content_digest（sha256 hex）
```
4acf3e70e475950ab9e3e6c8909d303fe6849cf104c679bbfed94654ab09355f
```

## 背景（Bettor 二次抓到未彻底）

第一版修复（digest=8a325287...）只在 usage header 加了一行说明文字，但 line 15 的 usage synopsis 本身仍写成 `[--payee <addr1,addr2>]`（方括号 = 可选记法）——Bettor 指出：只扫一眼 synopsis 那一行的 operator 还是会读成"全局可选"，说明文字容易被跳过。

## 修法（v2）

把 synopsis 本身改掉：`--network <testnet-12> --payee <addr1,addr2>(涉款命令必传, 见下方) [--source ...] ...`——`--payee` 不再套 `[]` 方括号（跟其余真可选参数在视觉上区分开），并在括号内联一句"涉款命令必传"。下方说明段落调整措辞，明确"synopsis 里特意不给它套方括号，避免 operator 一眼扫过 usage 就当全局可选"。

## 测试

`node --check` 语法通过。纯注释/文档字符串改动，不影响任何逻辑。既有回归 26/2 零新增 + provision-payee-regression 13/13 零回归。

## 请求
NWT 独立核实：① sha256 digest 一致；② synopsis 本身（非仅说明文字）确实不再用方括号包裹 `--payee`；③ 给 `review_ref`。
