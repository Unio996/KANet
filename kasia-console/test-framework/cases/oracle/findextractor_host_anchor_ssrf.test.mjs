// 门C 红队 regression (Bettor r512 / NWT r14 🔴CRIT) — findExtractor host-anchor + SSRF guard.
//
// scope: 判决引擎攻击面. 旧 findExtractor domainRe 对整 URL 子串匹配 →
//   evil.com/site.api.espn.com / 127.0.0.1/site.api.espn.com 都命中 ESPN 路由 →
//   deriveVote fetch 攻击者控页 → 伪证据 → settle 错 (源伪造 + SSRF). 开测硬 BLOCKER.
// fix: findExtractor 解析 URL → https-only + 私网/loopback host 阻断 + hostname 末尾锚定匹配.
// guard: 任一 spoof/SSRF URL 再命中 extractor → hard FAIL (永不退化到子串匹配).

export default {
  id: 'oracle_findextractor_host_anchor_ssrf',
  description: '门C 红队 — findExtractor host-anchored + https-only + SSRF block (拒源伪造/内网)',
  domain: 'oracle',
  tags: ['regression', 'p0', 'security', 'red-team', 'findextractor', 'ssrf', 'open-testnet'],
  skip_in_batch: false,

  async run() {
    const failures = [];
    const { findExtractor } = await import('../../../src/lib/oracle-evidence-extractors.mjs');

    // MUST match (legit known-extractor https hosts)
    const legit = [
      'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401815661',
      'https://cdn.espn.com/x',
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    ];
    for (const u of legit) {
      if (!findExtractor(u)) failures.push(`legit rejected (regression): ${u}`);
    }

    // MUST reject (spoof / SSRF / non-https) — NWT r14 attack vectors
    const attacks = [
      'https://evil.com/site.api.espn.com',          // substring path spoof
      'https://evil.com/?ref=site.api.espn.com',     // query spoof
      'https://site.api.espn.com.evil.com/x',        // subdomain forgery
      'http://127.0.0.1:9999/site.api.espn.com',     // SSRF loopback
      'http://192.168.1.50/cdn.espn.com',            // SSRF private
      'https://10.0.0.1/espn.com',                   // SSRF 10.x
      'https://172.16.0.1/coingecko.com',            // SSRF 172.16/12
      'http://site.api.espn.com/x',                  // non-https (MITM/cleartext)
      'https://localhost/espn.com',                  // localhost
      'https://espncom.evil.com/x',                  // lookalike (no dot boundary)
    ];
    for (const u of attacks) {
      if (findExtractor(u)) failures.push(`SPOOF/SSRF NOT rejected (CRITICAL): ${u}`);
    }

    return failures.length ? { ok: false, error: failures.join('; ') } : { ok: true };
  },
};
