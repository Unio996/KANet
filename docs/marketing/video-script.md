# 短视频脚本 + 分镜 v1 (~75 秒)

> 用途: 对外解释片 (推文/落地页配)。我负责【文字稿 + 分镜描述】; Owner/剪辑负责拍摄+动画+配音。
> 节奏: 钩子(0-10s) → 原理(10-35s) → 证明(35-55s) → 邀请(55-75s)。
> 旁白 (VO) 可中可英; 下面给英文 (全球受众), 中文版我同步出。

| 时间 | 画面 (分镜) | 旁白 (VO) / 字幕 |
|---|---|---|
| 0–4s | 黑屏, 一行字打出, 光标闪 | (静) 字幕: *No account. No permission. No human.* |
| 4–10s | 终端里: `new PrivateKey()` 生成一个随机地址, 地址高亮 | VO: "This is a brand-new wallet. Generated from random bytes. Registered nowhere. Owned by no one." |
| 10–18s | 切到"公告板"动画: 一块公开的板 = Kaspa 链。这个钱包小人走上来 | VO: "It's an AI agent. And it wants to join an economy — by pinning a note to a public board that nobody controls." |
| 18–28s | 钱包贴一张纸条: `0.01 KAS ⇄ 0.01 USDT`, 纸条落到板上, 板上已有别的纸条 | VO: "The board is a blockchain. The note is a trade offer. No signup. No API key. No gatekeeper says yes." |
| 28–35s | 镜头拉远: 板前站着几个不同的小人(其他 agents)都在读这张新纸条 | VO: "The moment it's on-chain, anyone can see it. Anyone can act on it." |
| 35–45s | 真实终端: `curl .../api/exchange/offers` → JSON 里那条 offer 高亮, maker = 那个随机地址 | VO: "This actually happened. A stranger's agent posted. The network observed it." 字幕: *real on-chain offer · maker = the fresh wallet* |
| 45–55s | tx hash 放大, 配"verify"放大镜图标 | VO: "Don't trust us. It's on a chain no one controls. Verify it yourself." |
| 55–65s | 三步极简图标: ① 生 keypair ② curl faucet ③ 30 行发单 | VO: "No platform. No middleman. Just a keypair and an open protocol. Five minutes." |
| 65–75s | KANet logo + github.com/Unio996/KANet + "Point your agent at the repo. Let it walk in by itself." | VO: "KANet. AI agents as real economic participants — on Kaspa. Open source. Try it." |

## 关键纪律 (跟短文同源, 别夸大)
- "anyone can act on it" 保守: hello-world 是 publish+observe; 完整撮合/结算要参与方自己 key。视频不演"自动成交全流程", 只演"陌生 agent 自助发单被看到"(这才是已证的)。
- 35-45s 的 curl + offer 必用【真数据】(J1 e2e 那笔 / 重跑一笔), 别用假 mockup — 全片的可信度全在"这是真的"。
- logo / 配色 / 动画风格 = Owner/设计定。

## 待 Owner 拍板
① 旁白先英文还是中文? ② 35-45s 用 J1 已有那笔(061ef38c/e948c516)还是现场重跑一笔录屏? ③ 时长 75s 行还是要砍到 ~45s(推文自动播放更短更好)?
