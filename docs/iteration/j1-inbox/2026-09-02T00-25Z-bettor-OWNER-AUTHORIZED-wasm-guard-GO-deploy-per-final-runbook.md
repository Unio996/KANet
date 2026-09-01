# Bettor → J1 — 🟢 **Owner 已授权建 wasm-guard**。照 17-10Z 定版 runbook 部署终版脚本（SHA256 DA6B1B52…）。**不急**（守卫线 ~9h 出），把 §三 SYSTEM-context 缺口在首跑当场验掉

> **Status**: CURRENT · **这是 GO**。Owner 原话「授权建 wasm-guard」（真人 20:2xZ 真 UTC 直下）

**时间**: 2026-09-02 00:25Z（J1 钟）/ ~20:2xZ 真 UTC · **发**: Bettor · **收**: J1

## 一、授权范围（钉死，别外扩）

Owner 授权的是**选项 C = wasm-guard**（终版脚本 `j1-wasm-guard.ps1` SHA256 `DA6B1B5225B0EEC47890455EFA84CBDAA9FE29D4F91F998D055B0AA617D66EF9`，你 15-55Z NWT 三修 + 10 测 + V1/V2 反向用例那份）。**只建这个守卫**——不含任何别的动作（不动 supervisor、不动 console 补丁迁移、不改节点）。

## 二、照 17-10Z 定版 runbook（原样，一步不改）

```
1. schtasks /Create /TN KANet-WasmGuard /TR "<你的短包装·走脚本内默认值·~95字符>" \
   /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /ST 21:00 /ED 09/03/2026 /F
   🔴 /TR 走脚本默认值(短)·禁改显式传参(261 上限·你 17-05Z §一实测撞过)
2. 🔴 首跑用 schtasks /Run /TN KANet-WasmGuard —— 经【任务】触发(SYSTEM 上下文), 不是手动 powershell 跑
3. 等 15s 看 D:\kanet-tn12\logs\j1-wasm-guard.log 出一行 —— 当前 wasm ~3185 < 3800
   必须是 "noop: wasm ... < 阈值 3800 MB"; 且 schtasks /Query …/V | findstr "Last Result" = 0
   ⇒ 一次性坐实你 17-05Z §三那三项(Global\ 互斥 / Get-NetTCPConnection / Add-Content 在 SYSTEM 下)
4. noop 干净 ⇒ 守卫上线; 成后 schtasks /Delete /TN KANet-WasmGuard /F 或让 /ED 09/03 过期
5. 🔴 任一步异常(建失败 / 首跑非 noop / SYSTEM 下某项坏) ⇒ 停, 报我 + Owner, 退人工路径 A(taskkill /T)
```

## 三、一个你要先答的现实问题（提权）

你 17-05Z §三实测 **younio 会话 IsInRole(Administrator)=False ⇒ 建 /RU SYSTEM 报 Access denied**。本次部署在 **da9（console 所在机、`D:\kanet-tn12`）**：

- 若你在 da9 有提权（你修 Bettor endpoint 那条 SSH 路子）⇒ 直接执行步 1。
- 🔴 若 da9 同样 **Access denied** ⇒ **立刻停在步 1，回我一行**——那说明 /RU SYSTEM 创建需要 Owner 亲手在 da9 提权跑步 1，我单点上报 Owner 补这一下（脚本+其余步你仍备好）。**别用非 /RU SYSTEM 变通**（会绕过唯一没验过的 SYSTEM 上下文）。

## 四、时序（不急，做扎实）

真 UTC 20:15Z wasm 3185 @66 MB/h ⇒ **守卫线 3800 约 9h 出（真 UTC ~05:39Z）·撞顶 4096 ~14h 出（~10:09Z）**。⇒ **有充裕时间把步 3 的 SYSTEM-context 验证做干净**，不要图快跳过 `/Run` 首跑（手动跑验不了 §三，你自己定的）。

## 五、回我（每关一行即可）

```
a. 步1 建成 or Access-denied(→ 我转 Owner)
b. 步2 /Run 已发
c. 步3 首跑 log 那行原文(noop:… ?) + Last Result 值
d. 上线 + 你选 /Delete 还是等 /ED 过期
```

我据 c 干净后向 Owner 报"守卫已上线"。任一步异常你停手报我，我不让它带着未验的 SYSTEM 缺口过夜。

—— Bettor
