// money-path-manifests.mjs — 机器可读 money-path/exit-path/fault-domain 清单
// (Owner 终裁件④, docs/2026-07-16-money-path-manifest-schema-and-lint-gate-design.md 定义的 schema
// 的实现存储层。设计稿写的是 YAML 示例, 这里用零依赖的 JS 对象数组承载同一 schema——项目没有现成
// YAML 解析依赖, 加一个新 npm 包属于更大的架构决定, 不在本次范围内自行拍板, 先用 plain object 落地。)
//
// 首批范围(诚实标注, 见设计稿 §五): 只有下方 3 条已在红队里核过的实战案例, 不是全系统 money-path
// 的完整清单。scripts/lint-kanet.mjs 的 R-MANIFEST-* 系列规则读这个数组做校验。

export const MONEY_PATH_MANIFESTS = [
  {
    path_id: 'z20-broker-kas-refund',
    description: 'broker 对过期/超时 exchange_offers 的 KAS 退款',
    intake_transaction: {
      mechanism: '用户向 seeder buy-side 挂单充值 USDT, 状态机进 retail_dex_buy_publications',
      code_ref: 'kasia-console/src/services/market-seeder.js:36-48',
    },
    locked_states: [
      {
        state: "exchange_offers.protocol_status IN ('expired','cancelled','timed_out','open'+deadline过)",
        description: '过期未成交挂单, KAS 卡在 broker 钱包',
        table_or_covenant: 'exchange_offers',
      },
    ],
    normal_exit: {
      trigger: 'timeout-automatic',
      mechanism: 'advanceToRefunded (via _scanExpiredBrokerOffers)',
      code_ref: 'kasia-console/src/services/broker-intake-watcher.js:459',
    },
    timeout_exit: { trigger: 'none', mechanism: null },
    escape_exit: {
      trigger: 'permissioned-manual',
      mechanism: 'POST /api/admin/clear-z20-circuit',
      condition: 'Z20 circuit-breaker 熔断后',
      code_ref: 'kasia-console/src/api/pool.js',
    },
    responsible_worker: {
      process_or_cron: '_refundInterval (broker-intake-watcher.js:1060, 5min tick)',
      code_ref: 'kasia-console/src/services/broker-intake-watcher.js:1059-1074',
    },
    kill_switch_effect: {
      env_var: 'DEMO_SEEDER_OFF',
      when_off: 'blocks-new-entry-only',
    },
    fault_domain: {
      shares_process_with: 'isolated',
      k16_compliant: true,
    },
    admin_capabilities: [
      { capability: '清空 Z20 熔断闸', admin_secret_var: null, risk_tier: 'T-STATE-PREP' },
    ],
    required_tests: [
      { test_file: 'kasia-console/test-framework/cases/broker/', covers: 'normal_exit' },
      { test_file: '待补(Z20熔断闸清除端点当前无回归用例覆盖, lint捕获的真实缺口, 不代补)', covers: 'escape_exit' },
    ],
  },
  {
    path_id: 'kr5l4-bshard-close-settlement',
    description: 'bshard(A)-model rolling-shard 市场结算/退款(694 注/25075 KAS 规模级案例)',
    intake_transaction: {
      mechanism: '用户下注创建 PoolSide ticket covenant, mint 进 ShardLeaf 聚合状态',
      code_ref: 'kasia-console/src/lib/pool-shard-register.mjs',
    },
    locked_states: [
      {
        state: "market_shards.status = 'open'/'sealed' 未 consolidate",
        description: '分片资金锁在 ShardLeaf covenant, 未汇入 PayoutShard',
        table_or_covenant: 'market_shards / ShardLeaf covenant',
      },
    ],
    normal_exit: {
      trigger: 'permissioned-manual',
      mechanism: 'settle-daemon tick → enforceCloseAttest → committee 签名 → consolidate → 派彩',
      code_ref: 'kasia-console/src/lib/bshard-close-enforce.mjs',
    },
    timeout_exit: { trigger: 'none', mechanism: null },
    escape_exit: {
      trigger: 'none',
      mechanism: null,
      condition: '当前无——本次 P0 暴露的真实缺口, K-10 违反实例, 待补(选项D落码后填此格)',
    },
    responsible_worker: {
      process_or_cron: 'bshard-settle-daemon.mjs 各 tick',
      code_ref: 'kasia-console/src/services/bshard-settle-daemon.mjs',
    },
    kill_switch_effect: {
      env_var: 'SETTLE_DAEMON_OFF',
      when_off: 'blocks-all-including-exit',
    },
    fault_domain: {
      shares_process_with: 'isolated',
      k16_compliant: false,
    },
    admin_capabilities: [
      { capability: 'propose-close-v2/zk-handoff-v2 手动触发', admin_secret_var: 'ADMIN_SECRET_ZK_STATE_PREP', risk_tier: 'T-STATE-PREP' },
      { capability: 'zk-close-v2 广播', admin_secret_var: 'ADMIN_SECRET_ZK_CLOSE_BROADCAST', risk_tier: 'T-BROADCAST' },
    ],
    required_tests: [
      { test_file: '待补(本次 P0 暴露测试覆盖缺口)', covers: 'normal_exit' },
    ],
  },
  {
    path_id: 'tg-wallet-custodial-withdraw',
    description: 'TG 托管钱包用户提现——唯一让托管资金离开 KANet 控制的正常出口, 对应 K-13/§9 fund+claim custodial 架构性冲突',
    intake_transaction: {
      mechanism: 'TG 用户通过 bot 发起提现请求',
      code_ref: 'kasia-console/src/services/tg-wallet.js',
    },
    locked_states: [
      {
        state: 'tg_custodial_wallets 持有的余额',
        description: '托管资金, 私钥由 KANet 服务端持有',
        table_or_covenant: 'tg_custodial_wallets',
      },
    ],
    normal_exit: {
      trigger: 'permissioned-manual',
      mechanism: 'POST /api/tg-wallet/:tg_user_id/send——just-in-time 解密 mnemonic→派生 privkey→IPC 给 relay(custodial_transfer)→用完即弃',
      code_ref: 'kasia-console/src/services/tg-wallet.js',
    },
    timeout_exit: { trigger: 'none', mechanism: null },
    escape_exit: {
      trigger: 'none',
      mechanism: null,
      condition: '当前无独立于 normal_exit 的 escape path——若 CUSTODIAL_RELAY_ID/FAUCET_RELAY_ID 未配(tg-wallet.js:101 判据), 唯一出口直接 503 不可用, 没有备用通道。K-13 违反实例(现状, 非理论)。',
    },
    responsible_worker: {
      process_or_cron: '无常驻(用户主动触发型 money-path, 与前两条 daemon-tick 型互补)',
      code_ref: 'kasia-console/src/services/tg-wallet.js',
    },
    kill_switch_effect: {
      env_var: 'CUSTODIAL_RELAY_ID / FAUCET_RELAY_ID (必需配置项, 非为关闭而设计的 kill-switch, 但效果等价)',
      when_off: 'blocks-all-including-exit',
    },
    fault_domain: {
      shares_process_with: 'console 主进程(与所有 pool.js/tg-bot 路径共享, 未隔离)',
      k16_compliant: false,
    },
    admin_capabilities: [],
    required_tests: [
      { test_file: '待确认(需查 test-framework/cases/ 是否有 tg-wallet 提现覆盖用例)', covers: 'normal_exit' },
    ],
  },
];
