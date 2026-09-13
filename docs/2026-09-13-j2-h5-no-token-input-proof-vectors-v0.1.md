# H5 不在场证明（"没有代币模板输入在场"）· v1.0.0 离线向量实证 v0.1

> **Status**: FINAL-EVIDENCE v0.1（2026-09-13T11:23Z `date -u`）· J2 · Bettor 派工 SendMessage 11:2xZ（"P7 四档向量 + cli-debugger 离线跑通，先于任何 .sil 改动"）· 交 NWT · 回填批 T v0.5。
> 结论一句话：**NWT f4abb387 ① 的改写（遍历输入按代币模板尾部字节匹配）在 v1.0.0 上能编、能跑、能挡**——7 档向量全部与预期一致，harness 自检（翻转 expect 必 FAIL、输入超界必拒）通过。产物 `docs/provenance/2026-09-13-j2-h5-p7-no-token-input-vectors/`（.sil / ctor / 两份 .test.json / run.log / MANIFEST.sha256）。
> 边界：cli-debugger 是 v1.0.0 自带解释器，**不是 kaspad 共识 VM**；链上等价在批 D 真链验（同 gate (a) 探针法）。sigScript 喂的是裸字节，真实 P2SH 输入的 sigScript = 各 push + redeem，尾部就是 redeem 末尾 = 模板后缀（`readInputStateWithTemplate` 同一定位法）。

## 1. 写法（`P7_no_token_input.sil`，v1.0.0 编过 217 B）

```
function no_token_input_present() : bool {
    bool found = false;
    for (i, 0, tx.inputs.length, max_ins) {
        byte[] ss = tx.inputs[i].sigScript;
        int n = ss.length;
        if (n >= token_tmpl_suffix_len) {
            byte[] tail = ss.slice(n - token_tmpl_suffix_len, n);
            if (tail == token_tmpl_suffix) { found = true; }
        }
    }
    return !found;
}
#[covenant.singleton]
function step_without_token(State prevState, State newState) { require(no_token_input_present()); … }
```
- `token_tmpl_suffix` / `token_tmpl_suffix_len` 是 ctor 参数，与 H1 (b) 模板前缀锁**同源**（一份模板字节，两处用）。
- 用 `sigScript` 而非 `scriptPubKey`：P2SH 输入的 `scriptPubKey` 只是哈希，模板字节只在 sigScript 尾部可见（DECL.md/TUTORIAL:1284 "reads bytes from another input's sigscript"）。
- `for` 界 `max_ins` 是 ctor 常量（#246 允许）；**输入数超界 ⇒ 脚本失败**（v7），即"看不完就拒"，fail-closed。

## 2. 向量（`P7_no_token_input.test.json` · 每输入 `signature_script_hex` 显式喂 · ctor `['0xaabbccddee', 5, 4, 100]`）

| # | 输入（除 input 0 = 市场 covenant 本身） | expect | 结果 | 证什么 |
|---|---|---|---|---|
| v0 | 无其它输入 | pass | ✅ | 基线 |
| v1 | 1 个 sigScript 尾 = `aabbccddee` | fail | ✅ | 一个代币模板输入在场即拒 |
| v2 | 2 个尾匹配 | fail | ✅ | 多匹配 |
| v3 **弱注入臂** | 尾 = `aabbccddef`（末字节差一） | pass | ✅ | 匹配读的是整段尾部字节，不是长度/前缀 |
| v4 | sigScript `aabb`（短于后缀） | pass | ✅ | 长度守卫不越界 |
| v5 | `aabbccddee00`（后缀不在尾部） | pass | ✅ | 只认尾部（模板位置），不做子串搜索 |
| v6 | 3 个混合：短 / 差一字节 / **尾匹配** | fail | ✅ | 循环遍历到最后一个，不因前面不匹配提前放行 |

## 3. harness 自检（`P7_harness_check.test.json`）

| # | 设置 | 结果 | 证什么 |
|---|---|---|---|
| v0_FLIPPED | v0 的 expect 改 fail | **FAIL**（"expected failure but bytecode passed"） | PASS 行不是空信息：harness 会报不一致 |
| v1_FLIPPED | v1 的 expect 改 pass | **FAIL** | 同上（反向） |
| v7 | 5 个其它输入（6 > max_ins=4）、全不匹配 | expect fail ⇒ ✅ | 超界即拒（看不完的输入不放行） |

## 4. 对批 T 的含义

- H5 负向证明的写法**成立**，可进 T1/T3 设计；成本 = 每条不共花入口一段 `max_ins` 次展开的尾部切片比较（bytecode 随 `max_ins` 线性涨；本探针 max_ins=4 ⇒ 217 B，主网集入口按各自 `max_ins` 估）。
- 要与 H1 (b) 共用一份模板字节：代币合约模板变 ⇒ 两处 ctor 同时重烤（批 T v0.4 §0.5 H1 的维护成本项）。
- 🔴 debugger 可喂 `signature_script_hex` 但 README 没写（`debugger/cli/src/main.rs:712/810`）——记进重编清单附录，免得下一个人以为不能离线跑。

## 5. 没核到的

- 真实 P2SH 输入 sigScript 的尾部是否**恰好**等于 `readInputStateWithTemplate` 的 suffix 定位（本探针用裸字节；批 D 真链时用真 covenant 输入复核一次）。
- 共识 VM 下 `slice`/`length` 对 sigScript 的行为与 debugger 一致性（cli-debugger 非共识 VM）。
