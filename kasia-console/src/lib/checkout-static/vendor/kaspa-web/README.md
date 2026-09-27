# kaspa-wasm 浏览器版构建产物（本目录 gitignored，不入库）

NWT diff 审 SHOULD③（2026-09-27T10-11Z）：本仓 `node_modules/kaspa-wasm` 只有 `wasm-bindgen
--target nodejs` 构建，无法在浏览器运行；上游 `rusty-kaspa` 的 `wasm/build-web` 脚本本来就会产出
一个 `--target web` 的浏览器兼容版本。真实跑通（本轮实测，非猜测）：

```bash
cd <rusty-kaspa checkout>/wasm
CC=clang bash build-web --sdk
```

（第一次不带 `CC=clang` 会在 `secp256k1-sys` 等带 C 依赖的 crate 上因为找不到 `clang` 失败——需要
一个能编译 C 依赖的 clang/gcc 在 PATH 上，本机装在 `C:\Program Files\LLVM\bin`，只是不在 PATH 上，
加这一条环境变量即可，不是无法解决的阻塞。）真实构建耗时约 3 分钟（编译 1m30s + wasm-bindgen/
wasm-opt 优化 1m45s）。

产物：`<rusty-kaspa checkout>/wasm/web/kaspa/{kaspa.js, kaspa_bg.wasm, kaspa.d.ts, LICENSE}`。

**sha256(kaspa_bg.wasm) = `732bdaa3ee8353c026654e9c7dd729674eb1bd064e8a0b8927b4cfb7df859e51`**
（本轮实测值，构建产物本身不确定性来自 wasm-opt 优化的非完全确定性构建——如果重新构建这个 sha 变了
不代表出错，是否需要把这个值纳入 D-019 pin 由 Bettor/Owner 决定，J2 不越权替他们拍板，仅如实记录）。

**真实冒烟测试通过**（`scratch/_j2_commission_impl_research/test_web_wasm_smoke.mjs`，用 `initSync`
在 Node 里直接加载 wasm 字节验证——`signMessage`/`verifyMessage`/`payToAddressScript`/地址推导全部
正常工作，且与 Node 版 kaspa-wasm 对同一私钥产出逐字节相同的地址/pubkey/scriptPubKey，两个构建版本
密码学一致，不是各自独立实现）。

## 部署本目录

```bash
cp <rusty-kaspa checkout>/wasm/web/kaspa/{kaspa.js,kaspa_bg.wasm,kaspa.d.ts,LICENSE} \
   kasia-console/src/lib/checkout-static/vendor/kaspa-web/
```

`checkout.js`/`config.js` 会从 `./vendor/kaspa-web/kaspa.js` 相对导入——本目录缺失时页面顶部会
明确提示"浏览器版 kaspa-wasm 未部署"，不会静默降级或误报成功。
