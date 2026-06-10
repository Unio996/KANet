// J2-tn r403 Track D Bettor r340 关1 PASS — 证据抽取器 (LLM 喂干净 evidence).
//
// 根因 (Bettor r339b): bettor-prediction-voter.js deriveKanetNativeVote L796-798
// fetch 后 slice(0, 2000) 截断 raw JSON, ESPN summary winner 字段被切 →
// LLM 蒙对/蒙错. 修: source-aware 抽取干净结果字段 (< 500 char) 喂 LLM.
//
// Bettor r340 关1 条件 (= baked here):
// (1) 比赛未结束/延期 → returns null (= LLM 弃权, 不假装 winner).
// (2) 防假并行 (gamma/UMA) 不在此模块, 仍 L102 voter assert 挡死.
// (3) 忠实抽取不加工 (winner 字段原样, 不做语义推理).
//
// 抽取器返干净 evidence_text (≤ 500 字符) 或 null (= 结果未出/抽取失败).
// J2-tn r412 (ABSTAIN-not-guess, Bettor r404): 没匹配 source / 抽取失败 → extractEvidence
// 返【null】→ voter ABSTAIN, 【不再 fallback raw slice(0,2000) 喂 LLM 瞎猜】(= w0s3m 4/5 错判
// 根因已删)。门C 档1 item4② guess-fallback grep 确认: 全库无 active raw-slice fallback。
// (上面 L4-5 描述的是已删的旧行为, 留作根因档案。)

/**
 * Parse ESPN summary JSON → extract winner + final score.
 * URL format: https://site.api.espn.com/apis/site/v2/sports/.../summary?event=<id>
 *
 * Bettor 条件 (1): 比赛未 final → 返 null.
 *   ESPN: status.type.completed === true && status.type.state === 'post' = final.
 *   其他状态 (pre/in/halftime/postponed) → 返 null.
 *
 * @param {string} rawText - raw HTTP response text
 * @returns {string|null} - "<winner_name> won (<home_abbr> <hs> - <as> <away_abbr>, <league>)" or null
 */
export function extractEspnEvidence(rawText) {
  let data;
  try { data = JSON.parse(rawText); } catch { return null; }

  // ESPN summary structure: { header: { competitions: [{ competitors: [{...}], status: {...} }] } }
  const comp = data?.header?.competitions?.[0];
  if (!comp) return null;

  // Bettor 条件 (1) — 比赛未 final → null. ESPN: status.type.completed === true.
  const status = comp.status;
  const completed = status?.type?.completed === true;
  const state = status?.type?.state;
  if (!completed || state !== 'post') {
    return null;  // pre/in/postponed → LLM 弃权
  }

  // Bettor 条件 (3) — 忠实抽取. competitors[] 每条含 winner: true/false + score + team.abbreviation.
  const competitors = comp.competitors || [];
  if (competitors.length !== 2) return null;
  const winner = competitors.find(c => c.winner === true);
  if (!winner) return null;

  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;

  const homeTeam = home.team?.abbreviation || home.team?.shortDisplayName || '?';
  const awayTeam = away.team?.abbreviation || away.team?.shortDisplayName || '?';
  const homeScore = home.score ?? '?';
  const awayScore = away.score ?? '?';
  const winnerName = winner.team?.displayName || winner.team?.shortDisplayName || winner.team?.abbreviation || '?';
  const league = data?.header?.league?.abbreviation || data?.leagues?.[0]?.abbreviation || '';

  const evidence = `${winnerName} won (${homeTeam} ${homeScore} - ${awayScore} ${awayTeam}${league ? ', ' + league : ''}).`;
  return evidence.length > 500 ? evidence.slice(0, 497) + '...' : evidence;
}

/**
 * Single source-of-truth registry (J2-tn r421 Bettor r441 钉1):
 * prevet mock-extract + voter deriveVote 共用此 registry → 永不分叉.
 *
 * 每条: { domainRe, extractor, label }
 *   domainRe — case-insensitive 正则匹 URL
 *   extractor — (rawText) => string|null (= clean evidence or null when not final)
 *   label — human-readable 源名 (= maker-facing UI 显)
 */
/**
 * J2-tn r427 (Bettor r462 跨域 ramp 第 1 个): CoinGecko price extractor.
 * 形如 'BTC >= $X at T' 类 price-threshold 市场. CoinGecko 客观结构化源.
 *
 * URL 格式: https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd
 * 响应: {"bitcoin":{"usd":107000.5}}
 *
 * Bettor 条件 (1) 比赛/事件未 final: 此处 price 是即时实测, 总是 final (= 任意时刻读都是当时价).
 *   故只要 API 返合法 JSON + 含 price → 出 evidence. fetch fail → null = ABSTAIN (= 命门不猜).
 * Bettor 条件 (3) 忠实抽取: price 原样喂 LLM, 不做语义推理 (= 不猜 ">=X" 判 YES/NO, 让 LLM 看).
 */
export function extractCoinGeckoPrice(rawText) {
  let data;
  try { data = JSON.parse(rawText); } catch { return null; }
  if (!data || typeof data !== 'object') return null;

  // simple/price form: {"bitcoin":{"usd":42345.67}}
  const parts = [];
  for (const coinId of Object.keys(data)) {
    const prices = data[coinId];
    if (!prices || typeof prices !== 'object') continue;
    for (const [currency, price] of Object.entries(prices)) {
      if (typeof price === 'number' && Number.isFinite(price)) {
        parts.push(`${coinId.toUpperCase()} = ${price} ${currency.toUpperCase()}`);
      }
    }
  }
  // coins/markets form (= array): [{"id":"bitcoin","current_price":107000.5,"symbol":"btc"}]
  if (parts.length === 0 && Array.isArray(data)) {
    for (const row of data) {
      if (row && typeof row === 'object' && typeof row.current_price === 'number' && Number.isFinite(row.current_price)) {
        const id = String(row.id || row.symbol || '?').toUpperCase();
        parts.push(`${id} = ${row.current_price} USD`);
      }
    }
  }
  if (parts.length === 0) return null;
  const evidence = `CoinGecko price (real-time): ${parts.join(', ')}.`;
  return evidence.length > 500 ? evidence.slice(0, 497) + '...' : evidence;
}

// J2-tn 门C 红队 fix (Bettor r512 / NWT r14 🔴CRIT): hostRe 是【host-anchored】正则 (匹 URL
// 解析后的 hostname, 末尾锚定), 不是对整 URL 字符串子串匹配. 旧 domainRe 子串匹配 = 源伪造/SSRF
// 洞 (evil.com/site.api.espn.com / 127.0.0.1/site.api.espn.com 都过) → 攻击者控判决证据 → settle 错.
// hostRe 模式 /^([a-z0-9-]+\.)*espn\.com$/ : 匹 espn.com + 真子域, 拒 espn.com.evil.com / evil.com/...espn...
export const KNOWN_EXTRACTORS = [
  {
    hostRe: /^([a-z0-9-]+\.)*espn\.com$/i,
    extractor: extractEspnEvidence,
    label: 'ESPN sports summary',
    kind: 'espn',
  },
  {
    hostRe: /^([a-z0-9-]+\.)*coingecko\.com$/i,
    extractor: extractCoinGeckoPrice,
    label: 'CoinGecko price',
    kind: 'coingecko',
  },
  // Future: BBC, Reuters, AP, other domain-specific extractors.
];

// SSRF 防护: 禁私网/loopback/link-local host (攻击者用内网 IP + 白名单子串绕过 fetch 打内网服务).
function _isPrivateOrLocalHost(host) {
  if (!host) return true;
  const h = host.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true; // IPv6 loopback/ULA/link-local
  // IPv4 private / loopback / link-local / unspecified
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/**
 * Find extractor entry by URL. Single API for prevet + voter.
 * J2-tn 门C fix: host-anchored + https-only + SSRF block (不再子串匹配).
 * @param {string} url
 * @returns {{hostRe, extractor, label, kind} | null}
 */
export function findExtractor(url) {
  if (!url) return null;
  let host;
  try {
    const u = new URL(String(url));
    // 只允许 https (防 MITM + 禁 http SSRF/明文). 解析失败 / 非 https → null (= voter ABSTAIN, 不判).
    if (u.protocol !== 'https:') return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (_isPrivateOrLocalHost(host)) return null; // SSRF: 拒内网/loopback
  for (const ent of KNOWN_EXTRACTORS) {
    if (ent.hostRe.test(host)) return ent; // host-anchored, 非整 URL 子串
  }
  return null;
}

/**
 * Dispatcher: route by URL → call source-specific extractor.
 * Falls back to null if no match (= voter must abstain).
 *
 * @param {string} url - source URL
 * @param {string} rawText - HTTP response text
 * @returns {string|null} - clean evidence or null (= 结果未出 / 抽取失败, voter 应 abstain)
 */
export function extractEvidence(url, rawText) {
  if (!url || !rawText) return null;
  const ent = findExtractor(url);
  if (!ent) return null;
  return ent.extractor(rawText);
}

/**
 * J2-tn r422 (Bettor r442 关2 漏抓): voter 接受的 outcome_market_source enum 列表.
 * 必 mirror bettor-prediction-voter.js L687-702:
 *   - 'polymarket' → polymarket handler
 *   - 'kanet_native' OR startsWith('kanet_') → kanet_native handler
 *   - else → unsupported
 * prevet 必同时校验 enum 接受 + URL 抽取, 防 espn-enum+ESPN-URL 错配 (= URL judgeable 但 voter
 * 拒 enum → ABSTAIN → refund).
 */
export function isVoterSupportedSource(source) {
  if (!source || typeof source !== 'string') return false;
  if (source === 'polymarket') return true;
  if (source === 'kanet_native') return true;
  if (source.startsWith('kanet_')) return true;
  if (source === 'coingecko') return true;  // r427 Bettor r462: 跨域 ramp 第 1 个金融源
  return false;
}

/**
 * J2-tn r421 (Bettor r441 关1 钉1+钉2 + r422 r442 关2 漏抓): maker-facing prevet diagnose.
 *
 * Returns structured verdict for build-time gate. Bettor 钉2: 'not_final_yet' is GREEN
 * (= 可判待终态, 市场为未来事件正常). RED = 该源 fundamentally 判不了.
 *
 * Verdicts:
 *   - 'judgeable_now'      — extract returned non-null clean text (= 事件已 final, AI 可直判)
 *   - 'judgeable_pending'  — extract returned null + JSON shape OK (= 等终态, 结构对)
 *   - 'no_extractor'       — source 不在 registry (= 该域无 extractor, 换源 OR UMA)
 *   - 'canonical_unreachable' — URL 不可达 / 网络错
 *   - 'shape_mismatch'     — URL OK 但 JSON 不能解析 OR 结构不对 (= 拼错 URL / 私有 endpoint)
 *   - 'unsupported_source_enum' — outcome_market_source enum 不在 voter handler 列表 (r422)
 *
 * @param {string} url
 * @param {string} source - outcome_market_source enum (= voter 路由 key)
 * @returns {Promise<{ok, verdict, label?, kind?, preview?, advice}>}
 */
export async function diagnoseSource(url, source) {
  // r422 (Bettor r442): 先校验 enum, 防 espn-enum+ESPN-URL 错配 (= URL 抽得到但 voter 拒 enum).
  if (source !== undefined && !isVoterSupportedSource(source)) {
    return {
      ok: false,
      verdict: 'unsupported_source_enum',
      advice: `outcome_market_source='${source}' 不在 voter handler 列表 (= polymarket / kanet_*). 换 'kanet_v07' (= 同 vaaks PASS 源).`,
    };
  }

  // r423 (Bettor r443 关2 漏抓): polymarket 是 voter 非-extractor 判路 (= derivePolymarketVote
  // 读 gamma API), 不走 KNOWN_EXTRACTORS. 必单独认 GREEN 不走 ESPN 路径.
  const urlLower = String(url || '').toLowerCase();
  if (source === 'polymarket' || urlLower.includes('polymarket.com')) {
    return {
      ok: true,
      verdict: 'judgeable_polymarket',
      label: 'Polymarket gamma',
      kind: 'polymarket',
      advice: '✓ Polymarket 源 (= voter derivePolymarketVote 读 gamma API). 不需 ESPN extractor.',
    };
  }

  if (!url) {
    return { ok: false, verdict: 'no_canonical', advice: '必填 data_source_canonical (= 机器可解析 URL)' };
  }
  const ent = findExtractor(url);
  if (!ent) {
    const knownList = KNOWN_EXTRACTORS.map(e => e.label).join(' / ');
    return {
      ok: false,
      verdict: 'no_extractor',
      advice: `该源无 KANet extractor (= AI 判不了). 已支持: ${knownList} + Polymarket gamma. 主观题走 UMA 底座.`,
    };
  }

  let rawText;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      return {
        ok: false,
        verdict: 'canonical_unreachable',
        label: ent.label,
        kind: ent.kind,
        advice: `canonical URL HTTP ${r.status} — 检查 URL 拼写 / 等源 publish`,
      };
    }
    rawText = await r.text();
  } catch (e) {
    return {
      ok: false,
      verdict: 'canonical_unreachable',
      label: ent.label,
      kind: ent.kind,
      advice: `fetch 失败 (${String(e.message || e).slice(0,80)}) — 检查 URL / 等源`,
    };
  }

  // Shape sanity: try JSON.parse, must succeed (= structure exists).
  let parsed;
  try { parsed = JSON.parse(rawText); }
  catch {
    return {
      ok: false,
      verdict: 'shape_mismatch',
      label: ent.label,
      kind: ent.kind,
      advice: '响应不是 JSON — 检查 URL 是否 API endpoint (= 不是网页)',
    };
  }
  // ESPN-specific shape sanity (= 防 maker 拼错 endpoint 给个无 header.competitions 的页).
  if (ent.kind === 'espn' && !parsed?.header?.competitions?.[0]) {
    return {
      ok: false,
      verdict: 'shape_mismatch',
      label: ent.label,
      kind: ent.kind,
      advice: 'ESPN summary URL 结构不对 (= header.competitions 缺). 用 site.api.espn.com/.../summary?event=<id>',
    };
  }

  const evidence = ent.extractor(rawText);
  if (evidence) {
    return {
      ok: true,
      verdict: 'judgeable_now',
      label: ent.label,
      kind: ent.kind,
      preview: evidence.slice(0, 200),
      advice: '✓ 源已可判 (= AI 可直读 final 结果).',
    };
  }
  // Bettor r441 钉2: 结构 OK + 未 final → GREEN 'judgeable_pending'.
  return {
    ok: true,
    verdict: 'judgeable_pending',
    label: ent.label,
    kind: ent.kind,
    advice: '✓ 源结构正确 (= 事件未 final, 待终态 AI 可判).',
  };
}
