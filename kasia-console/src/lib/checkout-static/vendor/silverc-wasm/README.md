# silverc-wasm — 浏览器版 SilverScript 编译器

D-034 §8 后续票①(b)(Bettor 派工 2026-09-27, coord/j2-checkout-pure-static-20260927)。把
`silverscript-lang`(SilverScript 编译器的**库**, 不是 `silverc` CLI 那个二进制)编译成
`wasm32-unknown-unknown`, 用 `wasm-bindgen` 包一层, 让浏览器不经 `resolver.mjs`/`silverc.exe`
就能原生编译 `.sil` 合约、推导订单地址。

## 这份产物是什么, 不是什么

- **是**: 与 D-019 锚定的 `silverc-v100-3ed9733.exe` CLI **同一提交**(`v1.0.0` tag,
  `3ed973335b59269293564805cc2c58a14595ec03`)的编译逻辑, 只是换了个 target 和调用方式
  (`wasm-bindgen` 导出 `compile(source, ctorJson)`, 逐字对照 `src/bin/silverc.rs` 的真实调用路径:
  `Vec<ArtifactValue>` ctor 解析 → `compile_to_sil_abi_artifact` → `to_pretty_json`)。
- **不是**: 一份"看起来像"或"归纳出来"的兼容实现——`docs/provenance/2026-09-27-j2-checkout-pure-static-r2/`
  下的 `parity_wasm_vs_cli.mjs` 用 630 组随机 ctor 向量(CommissionSplit/ChannelDeposit/InstantSplit
  各 210 组)逐字节比对这份 wasm 产物与真实 CLI 二进制的输出, 零不一致。

## 构建命令(操作者自行重建)

```bash
cd <silverscript checkout>/silverscript-lang   # 分支 j2-wasm-lib-v100-2026-09-27, 本地分支, 未推上游
CC=clang \
  cargo build --lib --target wasm32-unknown-unknown --release --features wasm

wasm-bindgen target/wasm32-unknown-unknown/release/silverscript_lang.wasm \
  --out-dir <checkout-static>/vendor/silverc-wasm --target web --out-name silverc_lang
```

- `CC=clang`: `secp256k1-sys` 等带 C 依赖的 crate 需要, clang 装在 LLVM 目录但默认不在 PATH。
- `wasm-bindgen-cli` 版本必须与 `Cargo.lock` 里 `wasm-bindgen` 依赖版本一致(本次 `0.2.100`),
  版本不匹配会直接报错拒绝处理。
- `silverscript-lang/Cargo.toml` 的 `[lib]` 段需要 `crate-type = ["cdylib", "rlib"]`——默认只产
  `rlib`, `wasm-bindgen` 处理不了; 这一行是本轮加的, 上游 `v1.0.0` 原样没有(库原本只给 CLI/测试用)。

## 为什么不入库(gitignored)

同 `vendor/kaspa-web/README.md` 的既有理由: `silverc_lang_bg.wasm` 约 5.3MB, 大二进制放仓外、按
sha256 核对, 不进 git 历史。权威锚点见 `scripts/silverc-wasm-pin.json`(含 sha256、goldenSample、
parity 证据指针)。

## sha256 与非确定性构建

`sha256Note` 字段在 `scripts/silverc-wasm-pin.json` 里已如实说明: `wasm-bindgen` 处理步骤不保证
完全确定性构建, 重新构建可能产出不同 sha256——这不代表出错或被调包, 需要走 pin 文件的
`goldenSample` + `parityEvidence` 两项同源判据复核, 而不是简单比对二进制 sha256 就拒绝。

## 依赖 silverscript checkout 的说明(与 D-019 的关系)

- `silverc-v100-3ed9733.exe`(D-019 pin 的 CLI 二进制)与这份 wasm 库来自**同一个提交**(`v1.0.0`
  tag), 但走**不同的构建/维护路径**——CLI 二进制是预先编译好、按 sha256 锚定的成品; 这份 wasm
  是本轮新加的 `wasm.rs` 包装层(未改动任何编译逻辑本身), 操作者需要有一份 `silverscript`
  checkout 才能重新构建(与 D-019 pin 惯例一致: 二进制产物可以脱离源码仓单独分发/核验, 但重新
  构建需要源码)。
- `silverscript-lang/src/wasm.rs` + `Cargo.toml`/`lib.rs` 的改动只在本地分支
  `j2-wasm-lib-v100-2026-09-27`(从 `v1.0.0` tag 切出), **未推送到任何上游远程**——同
  `j2-oppick-fix-2026-07-06` 分支的既有惯例(见 `CLAUDE.md` 铁律 0.5 状态注记), 引用这份 wasm
  产物时同样要带作用域: "我们本机构建的" wasm 库包含这个包装层, 上游 `silverscript-lang` 没有。

## 与 order-template.js(固定偏移覆写)的关系

`checkout.js` 优先加载这份 wasm 编译器(`resolve-order-wasm.js`); 加载失败(sha256 不符/网络失败/
浏览器不支持)时自动降级到 `resolve-order-browser.js` + `order-template.js` 的固定偏移覆写路径——
那条路径本轮也用 320 组随机向量独立验证过(见 `order-template.js` 头注), 两条路径都留了完整证据链,
不是"验证了一条就把另一条删掉"。选择用哪条路径由 `checkout.js` 运行时探测, 不需要人工配置。
