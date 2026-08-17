# J1 节点健康证据窗 #1(INGEST 腿 · 答 (404)/(407) Codex 制品规格)

> **Status**: 证据制品 v1 · J1tn · 2026-08-17 09:0xZ · 判词归 Bettor/Codex, 本文件只交测量与定性。
> 规格对照(Codex a8d4632e/36898011): ①节点身份绑定 ✓ ②经过区间 ✓ ③跨窗重复 sink/DAA 推进 ✓ ④第二节点一致性 ✓ ⑤注册路所需链确认行为(真 TX) ✓ ⑥不可变制品(本文件+内嵌全量 JSONL, commit 即锚) ✓

## 1. 主窗统计(local-J1-:17210 · 90 采 x60s + 1 单发实测采)
- **区间**: 2026-08-17T07:11:29Z → 08:57:29Z(106.0 min, 91 采, 探针 0 故障)
- **DAA**: 77,546,093 → 77,631,606(净 +85,513, **13.45/s ≈ 13x 目标速率 = 重过产相位**)
- **isSynced**: true 78/91(86%), 段形 `F6,T48,F7,T30`(两段 6-7min false 谷, 与相位边界重合)
- **DAA 回退**: 2 次(-4 @sample7 / -135 @sample23), 其后 67 采零回退
- **tips**: 36 → 峰 **326** → 尾 201 —— **峰值越过 248 历史警戒线而未楔死**(DAA 持续净进; 该线语义在当前体制下的适用性待另判, 本文件不下结论)
- **判词分布**: healthy 76 · starved 8 · catching-up 6 · overproduction 1

## 2. 第二节点一致性(挖矿节点 100.99.147.101:17210 经 SSH 隧道)
| 时刻(UTC) | 节点 | DAA | isSynced | peers |
|---|---|---|---|---|
| 08:57:57 | 矿机 | 77,628,745 | true | 4 |
| 08:58:51 | 矿机 | 77,628,796 | true | 4 |
| 09:01:xx(同刻对) | **本机** | **77,631,781** | true | 4 |
| 09:01:xx+2s(同刻对) | 矿机 | 77,628,927 | true | 4 |

- **同刻 gap**: 本机领先矿机节点 **+2,854 DAA**, 双方均自报 synced; 远端推进 ~0.87/s vs 本机同段 ~0.22/s ⇒ **gap 收窄 = 收敛非分裂**。
- 🟡 **机制假设(明标假设, 未证)**: 矿机节点验证自产块慢于本机验证 ⇒ 其 virtual 滞后 ⇒ 出块模板陈旧 ⇒ tips 抬高 + 选链微搅动(与主窗 tips 峰值/两次微回退相容)。证它需矿机侧日志/计数, 未做。

## 3. 链确认行为(真 TX, 注册/结算路同一确认机制)
- 样本: 频道消息 txId `2b8c5dfe`(即证据窗收口通报本身)
- T0(发起) 09:01:51.670Z → 落库(created_at) 09:01:57.260Z = **5.6s**; 读回(≤09:03:2xZ)已 `confirmed` ⇒ **确认延迟上界 ≤90s**(单样本; 更紧的界需逐秒轮询, 未做)
- 另: 本 session 早前两条消息(959f9f3c/88dc9261 族)均曾在同类体制下 confirmed + 跨节点摄回, 作旁证不作主证。

## 4. 诚实边界
- 单窗 106min 覆盖 ~5-7 个振荡周期, **但只覆盖"重过产相位"这一种日内体制**——低产相位(0.2-0.9/s)下的确认行为本窗没有测到。
- 确认延迟单样本; tips>248 未楔死是观察不是安全声明。
- 机制假设未证; 第二节点只 4 点采样。

## 附: 主窗全量 JSONL(不可变原始数据)
```
{"t":"2026-08-17T07:11:29Z","node":"local-J1-:17210","sample":0,"parsed":"ok false 77546093 37 catching-up"}
{"t":"2026-08-17T07:11:46Z","node":"local-J1-:17210","sample":0,"parsed":"ok false 77546197 50 catching-up"}
{"t":"2026-08-17T07:12:55Z","node":"local-J1-:17210","sample":1,"parsed":"ok false 77547185 45 catching-up"}
{"t":"2026-08-17T07:14:04Z","node":"local-J1-:17210","sample":2,"parsed":"ok false 77548175 44 catching-up"}
{"t":"2026-08-17T07:15:18Z","node":"local-J1-:17210","sample":3,"parsed":"ok false 77549047 36 starved"}
{"t":"2026-08-17T07:16:26Z","node":"local-J1-:17210","sample":4,"parsed":"ok false 77549482 53 catching-up"}
{"t":"2026-08-17T07:17:35Z","node":"local-J1-:17210","sample":5,"parsed":"ok true 77550165 44 healthy"}
{"t":"2026-08-17T07:18:45Z","node":"local-J1-:17210","sample":6,"parsed":"ok true 77550277 110 healthy"}
{"t":"2026-08-17T07:19:57Z","node":"local-J1-:17210","sample":7,"parsed":"ok true 77550273 154 healthy"}
{"t":"2026-08-17T07:21:09Z","node":"local-J1-:17210","sample":8,"parsed":"ok true 77550376 183 overproduction"}
{"t":"2026-08-17T07:22:19Z","node":"local-J1-:17210","sample":9,"parsed":"ok true 77550528 230 healthy"}
{"t":"2026-08-17T07:23:33Z","node":"local-J1-:17210","sample":10,"parsed":"ok true 77550621 250 healthy"}
{"t":"2026-08-17T07:24:42Z","node":"local-J1-:17210","sample":11,"parsed":"ok true 77550811 256 healthy"}
{"t":"2026-08-17T07:25:54Z","node":"local-J1-:17210","sample":12,"parsed":"ok true 77550989 242 healthy"}
{"t":"2026-08-17T07:27:06Z","node":"local-J1-:17210","sample":13,"parsed":"ok true 77551250 93 healthy"}
{"t":"2026-08-17T07:28:19Z","node":"local-J1-:17210","sample":14,"parsed":"ok true 77551468 77 healthy"}
{"t":"2026-08-17T07:29:28Z","node":"local-J1-:17210","sample":15,"parsed":"ok true 77551854 86 healthy"}
{"t":"2026-08-17T07:30:42Z","node":"local-J1-:17210","sample":16,"parsed":"ok true 77552610 82 healthy"}
{"t":"2026-08-17T07:31:54Z","node":"local-J1-:17210","sample":17,"parsed":"ok true 77553255 58 healthy"}
{"t":"2026-08-17T07:33:07Z","node":"local-J1-:17210","sample":18,"parsed":"ok true 77553716 58 healthy"}
{"t":"2026-08-17T07:34:16Z","node":"local-J1-:17210","sample":19,"parsed":"ok true 77553974 63 healthy"}
{"t":"2026-08-17T07:35:27Z","node":"local-J1-:17210","sample":20,"parsed":"ok true 77554340 71 healthy"}
{"t":"2026-08-17T07:36:40Z","node":"local-J1-:17210","sample":21,"parsed":"ok true 77554587 79 healthy"}
{"t":"2026-08-17T07:37:50Z","node":"local-J1-:17210","sample":22,"parsed":"ok true 77554897 83 healthy"}
{"t":"2026-08-17T07:38:59Z","node":"local-J1-:17210","sample":23,"parsed":"ok true 77554762 89 healthy"}
{"t":"2026-08-17T07:40:10Z","node":"local-J1-:17210","sample":24,"parsed":"ok true 77565919 63 healthy"}
{"t":"2026-08-17T07:41:19Z","node":"local-J1-:17210","sample":25,"parsed":"ok true 77573949 57 healthy"}
{"t":"2026-08-17T07:42:33Z","node":"local-J1-:17210","sample":26,"parsed":"ok true 77580528 37 healthy"}
{"t":"2026-08-17T07:43:46Z","node":"local-J1-:17210","sample":27,"parsed":"ok true 77580775 42 healthy"}
{"t":"2026-08-17T07:44:57Z","node":"local-J1-:17210","sample":28,"parsed":"ok true 77580877 48 healthy"}
{"t":"2026-08-17T07:46:06Z","node":"local-J1-:17210","sample":29,"parsed":"ok true 77581199 53 healthy"}
{"t":"2026-08-17T07:47:17Z","node":"local-J1-:17210","sample":30,"parsed":"ok true 77584661 36 healthy"}
{"t":"2026-08-17T07:48:27Z","node":"local-J1-:17210","sample":31,"parsed":"ok true 77584865 41 healthy"}
{"t":"2026-08-17T07:49:40Z","node":"local-J1-:17210","sample":32,"parsed":"ok true 77584956 46 healthy"}
{"t":"2026-08-17T07:50:49Z","node":"local-J1-:17210","sample":33,"parsed":"ok true 77586117 48 healthy"}
{"t":"2026-08-17T07:52:04Z","node":"local-J1-:17210","sample":34,"parsed":"ok true 77587618 43 healthy"}
{"t":"2026-08-17T07:53:13Z","node":"local-J1-:17210","sample":35,"parsed":"ok true 77590000 39 healthy"}
{"t":"2026-08-17T07:54:26Z","node":"local-J1-:17210","sample":36,"parsed":"ok true 77590421 39 healthy"}
{"t":"2026-08-17T07:55:36Z","node":"local-J1-:17210","sample":37,"parsed":"ok true 77590783 39 healthy"}
{"t":"2026-08-17T07:56:45Z","node":"local-J1-:17210","sample":38,"parsed":"ok true 77590825 39 healthy"}
{"t":"2026-08-17T07:57:59Z","node":"local-J1-:17210","sample":39,"parsed":"ok true 77590859 40 healthy"}
{"t":"2026-08-17T07:59:11Z","node":"local-J1-:17210","sample":40,"parsed":"ok true 77594364 73 healthy"}
{"t":"2026-08-17T08:00:19Z","node":"local-J1-:17210","sample":41,"parsed":"ok true 77595470 123 healthy"}
{"t":"2026-08-17T08:01:28Z","node":"local-J1-:17210","sample":42,"parsed":"ok true 77595503 177 healthy"}
{"t":"2026-08-17T08:02:41Z","node":"local-J1-:17210","sample":43,"parsed":"ok true 77596085 196 healthy"}
{"t":"2026-08-17T08:03:54Z","node":"local-J1-:17210","sample":44,"parsed":"ok true 77596236 233 healthy"}
{"t":"2026-08-17T08:05:03Z","node":"local-J1-:17210","sample":45,"parsed":"ok true 77596331 264 healthy"}
{"t":"2026-08-17T08:06:13Z","node":"local-J1-:17210","sample":46,"parsed":"ok true 77596477 279 healthy"}
{"t":"2026-08-17T08:07:23Z","node":"local-J1-:17210","sample":47,"parsed":"ok true 77596726 198 healthy"}
{"t":"2026-08-17T08:08:37Z","node":"local-J1-:17210","sample":48,"parsed":"ok true 77597091 210 healthy"}
{"t":"2026-08-17T08:09:47Z","node":"local-J1-:17210","sample":49,"parsed":"ok true 77597234 212 healthy"}
{"t":"2026-08-17T08:11:04Z","node":"local-J1-:17210","sample":50,"parsed":"ok true 77597543 220 healthy"}
{"t":"2026-08-17T08:12:13Z","node":"local-J1-:17210","sample":51,"parsed":"ok true 77597701 219 healthy"}
{"t":"2026-08-17T08:13:28Z","node":"local-J1-:17210","sample":52,"parsed":"ok true 77597824 223 starved"}
{"t":"2026-08-17T08:14:40Z","node":"local-J1-:17210","sample":53,"parsed":"ok false 77598010 225 starved"}
{"t":"2026-08-17T08:15:53Z","node":"local-J1-:17210","sample":54,"parsed":"ok false 77598129 227 starved"}
{"t":"2026-08-17T08:17:04Z","node":"local-J1-:17210","sample":55,"parsed":"ok false 77598280 230 starved"}
{"t":"2026-08-17T08:18:18Z","node":"local-J1-:17210","sample":56,"parsed":"ok false 77598386 233 starved"}
{"t":"2026-08-17T08:19:28Z","node":"local-J1-:17210","sample":57,"parsed":"ok false 77598671 236 starved"}
{"t":"2026-08-17T08:20:40Z","node":"local-J1-:17210","sample":58,"parsed":"ok false 77598931 239 starved"}
{"t":"2026-08-17T08:21:49Z","node":"local-J1-:17210","sample":59,"parsed":"ok false 77599245 242 catching-up"}
{"t":"2026-08-17T08:22:58Z","node":"local-J1-:17210","sample":60,"parsed":"ok true 77606196 220 healthy"}
{"t":"2026-08-17T08:24:15Z","node":"local-J1-:17210","sample":61,"parsed":"ok true 77611979 192 healthy"}
{"t":"2026-08-17T08:25:31Z","node":"local-J1-:17210","sample":62,"parsed":"ok true 77612273 196 healthy"}
{"t":"2026-08-17T08:26:40Z","node":"local-J1-:17210","sample":63,"parsed":"ok true 77612482 198 healthy"}
{"t":"2026-08-17T08:27:51Z","node":"local-J1-:17210","sample":64,"parsed":"ok true 77612712 202 healthy"}
{"t":"2026-08-17T08:29:00Z","node":"local-J1-:17210","sample":65,"parsed":"ok true 77612972 202 healthy"}
{"t":"2026-08-17T08:30:10Z","node":"local-J1-:17210","sample":66,"parsed":"ok true 77613269 207 healthy"}
{"t":"2026-08-17T08:31:20Z","node":"local-J1-:17210","sample":67,"parsed":"ok true 77613578 211 healthy"}
{"t":"2026-08-17T08:32:32Z","node":"local-J1-:17210","sample":68,"parsed":"ok true 77613754 212 healthy"}
{"t":"2026-08-17T08:33:44Z","node":"local-J1-:17210","sample":69,"parsed":"ok true 77613995 214 healthy"}
{"t":"2026-08-17T08:34:52Z","node":"local-J1-:17210","sample":70,"parsed":"ok true 77617562 200 healthy"}
{"t":"2026-08-17T08:36:01Z","node":"local-J1-:17210","sample":71,"parsed":"ok true 77618129 203 healthy"}
{"t":"2026-08-17T08:37:12Z","node":"local-J1-:17210","sample":72,"parsed":"ok true 77618920 199 healthy"}
{"t":"2026-08-17T08:38:21Z","node":"local-J1-:17210","sample":73,"parsed":"ok true 77619552 200 healthy"}
{"t":"2026-08-17T08:39:33Z","node":"local-J1-:17210","sample":74,"parsed":"ok true 77621502 192 healthy"}
{"t":"2026-08-17T08:40:49Z","node":"local-J1-:17210","sample":75,"parsed":"ok true 77621655 196 healthy"}
{"t":"2026-08-17T08:42:06Z","node":"local-J1-:17210","sample":76,"parsed":"ok true 77621835 199 healthy"}
{"t":"2026-08-17T08:43:15Z","node":"local-J1-:17210","sample":77,"parsed":"ok true 77622054 200 healthy"}
{"t":"2026-08-17T08:44:25Z","node":"local-J1-:17210","sample":78,"parsed":"ok true 77622302 203 healthy"}
{"t":"2026-08-17T08:45:36Z","node":"local-J1-:17210","sample":79,"parsed":"ok true 77622566 207 healthy"}
{"t":"2026-08-17T08:46:48Z","node":"local-J1-:17210","sample":80,"parsed":"ok true 77622739 210 healthy"}
{"t":"2026-08-17T08:47:58Z","node":"local-J1-:17210","sample":81,"parsed":"ok true 77623005 214 healthy"}
{"t":"2026-08-17T08:49:10Z","node":"local-J1-:17210","sample":82,"parsed":"ok true 77623220 220 healthy"}
{"t":"2026-08-17T08:50:19Z","node":"local-J1-:17210","sample":83,"parsed":"ok true 77625969 326 healthy"}
{"t":"2026-08-17T08:51:28Z","node":"local-J1-:17210","sample":84,"parsed":"ok true 77627963 191 healthy"}
{"t":"2026-08-17T08:52:38Z","node":"local-J1-:17210","sample":85,"parsed":"ok true 77628778 195 healthy"}
{"t":"2026-08-17T08:53:50Z","node":"local-J1-:17210","sample":86,"parsed":"ok true 77629156 200 healthy"}
{"t":"2026-08-17T08:55:07Z","node":"local-J1-:17210","sample":87,"parsed":"ok true 77629225 208 healthy"}
{"t":"2026-08-17T08:56:18Z","node":"local-J1-:17210","sample":88,"parsed":"ok true 77631540 191 healthy"}
{"t":"2026-08-17T08:57:29Z","node":"local-J1-:17210","sample":89,"parsed":"ok true 77631606 201 healthy"}
```
