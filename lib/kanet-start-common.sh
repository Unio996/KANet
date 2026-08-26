#!/usr/bin/env bash
# kanet-start-common.sh — kanet-start.sh / kanet-start-headless.sh 共享函数库(VB-1 起, 逐函数抽·每个抽前证 behavior-identical)。
# 🔴 VB-1 只含【今日已证净行为等价】的函数; 漂移段(stop_old#9a/spawn_console#22/KANET_TEST_MODE#4/sidecars#15#24/
#    ensure_supervisor#9b#9c/archive_log#21/llama spawn 外壳)各留原脚本, 由 VB-2+ "抽+修"同 commit 引入(见设计稿 §B 注记)。
# 用法: 两脚本在 env 加载处 `source "$KANET_ROOT/lib/kanet-start-common.sh"; kanet_load_env`。

# ── kanet_load_env: 加载 kanet.env(全量 export)+ 派生 CONSOLE_PORT ──────────────
# [VB-1·已证净行为等价] kanet-start.sh(27-key case) 与 headless(3-key case + 分离 CONSOLE_PORT 派生)
#   在同一 kanet.env 下净 env 态 + shell 变量(CONSOLE_PORT/KANET_ROOT/CONSOLE_ENCRYPTION_KEY/OPENCLAW_TOKEN)【逐字相同】
#   (证据: scratch/vb1 env|sort diff 空; docs 证明文档 VB-1)。原两版 case 差异是【重命名/冗余 export】净出同一结果,
#   非行为差异 ⇒ 抽成单一 canonical 函数零净变更。
# 依赖(caller 须先设): ENV_FILE, KANET_ROOT, CONSOLE_PORT(fallback 初值), CONSOLE_ENCRYPTION_KEY, OPENCLAW_TOKEN
# 副作用: export kanet.env 每个 key; 设 CONSOLE_ENCRYPTION_KEY/OPENCLAW_TOKEN/KANET_ROOT; 派生 CONSOLE_PORT="${PORT:-$CONSOLE_PORT}"
# 🔴 不含各脚本特有的 UI log(kanet-start.sh 的 `ok "已加载配置"`)—— 那是外壳, 留原脚本。
kanet_load_env() {
  if [ -f "$ENV_FILE" ]; then
    while IFS='=' read -r k v; do
      [[ "$k" =~ ^# ]] && continue
      [ -z "$k" ] && continue
      # 全量 export(r472/r551): 不用手维护 allowlist, 结构性消除 case 未 match 漂移。
      export "$k=$v"
      case "$k" in
        KANET_ROOT)              KANET_ROOT="$v" ;;
        CONSOLE_ENCRYPTION_KEY)  CONSOLE_ENCRYPTION_KEY="$v" ;;
        OPENCLAW_TOKEN)          OPENCLAW_TOKEN="$v" ;;
      esac
    done < "$ENV_FILE"
  fi
  # Console 端口单一源 = kanet.env PORT; 无 PORT key 时退 caller 传入的 CONSOLE_PORT fallback。
  CONSOLE_PORT="${PORT:-$CONSOLE_PORT}"
}
