#!/usr/bin/env node
// ============================================================
// MCP Watchtower Scanner — health checks for MCP servers
// Zero dependencies. Node 18+.
//
// Usage:
//   node scanner.mjs [--limit 55] [--out data]
//   GITHUB_TOKEN=ghp_xxx node scanner.mjs --limit 500   (5000 req/h)
//
// Without a token GitHub allows ~60 requests/hour, so the
// default batch is 55. Results merge into data/servers.json
// across runs, so repeated runs grow coverage.
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const LIMIT = parseInt(arg('limit', '55'), 10);
const OUTDIR = join(ROOT, arg('out', 'data'));
const TOKEN = process.env.GITHUB_TOKEN || '';

const HEADERS = {
  'User-Agent': 'mcp-watchtower-scanner',
  'Accept': 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
};

const SOURCE_LISTS = [
  // The canonical community list of MCP servers
  'https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md',
  // Official reference servers list
  'https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md'
];

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

function extractRepos(md) {
  const re = /github\.com\/([\w.-]+)\/([\w.-]+)/g;
  const found = new Set();
  let m;
  while ((m = re.exec(md))) {
    const owner = m[1], repo = m[2].replace(/[).,]+$/, '');
    if (['topics', 'sponsors', 'features', 'orgs', 'search', 'trending'].includes(owner)) continue;
    if (!repo || repo === 'blob' || repo === 'tree') continue;
    found.add(`${owner}/${repo}`);
  }
  return [...found];
}

// Health score 0-100.
// Recency of last push is the dominant signal (the audit data showed
// "142 days since last commit" as the median dead-server profile).
function healthScore(info) {
  if (info.archived) return { score: 3, why: 'archived' };
  const days = (Date.now() - new Date(info.pushed_at).getTime()) / 86400000;
  let recency; // 0-70
  if (days <= 14) recency = 70;
  else if (days <= 30) recency = 62;
  else if (days <= 60) recency = 50;
  else if (days <= 90) recency = 38;
  else if (days <= 180) recency = 22;
  else if (days <= 365) recency = 10;
  else recency = 2;

  // Community confidence 0-15 (log-ish on stars)
  const s = info.stargazers_count || 0;
  const stars = s >= 1000 ? 15 : s >= 300 ? 12 : s >= 100 ? 9 : s >= 30 ? 6 : s >= 5 ? 3 : 1;

  // Maintenance hygiene 0-15
  let hygiene = 0;
  if (info.has_issues) hygiene += 3;
  if (info.license) hygiene += 4;
  if (info.description) hygiene += 2;
  if (!info.fork) hygiene += 3;
  if ((info.open_issues_count || 0) < 30) hygiene += 3;

  return { score: Math.min(100, Math.round(recency + stars + hygiene)), why: `pushed ${Math.round(days)}d ago` };
}

const verdict = s => (s >= 70 ? 'ALIVE' : s >= 40 ? 'FADING' : 'DEAD');

function badgeSVG(repo, score) {
  const v = verdict(score);
  const color = v === 'ALIVE' ? '#2ea44f' : v === 'FADING' ? '#d4a72c' : '#cf222e';
  const label = 'MCP health';
  const value = `${score} · ${v.toLowerCase()}`;
  const lw = 78, vw = 14 + value.length * 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${label}: ${value}">
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<rect rx="3" width="${lw + vw}" height="20" fill="#555"/>
<rect rx="3" x="${lw}" width="${vw}" height="20" fill="${color}"/>
<rect rx="3" width="${lw + vw}" height="20" fill="url(#s)"/>
<g fill="#fff" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${label}</text>
<text x="${lw + vw / 2}" y="14">${value}</text>
</g></svg>`;
}

async function main() {
  mkdirSync(OUTDIR, { recursive: true });
  mkdirSync(join(OUTDIR, 'badges'), { recursive: true });

  // 1. Collect repo list
  console.log('[1/3] fetching MCP server lists...');
  let repos = [];
  for (const url of SOURCE_LISTS) {
    try {
      repos.push(...extractRepos(await fetchText(url)));
    } catch (e) { console.error('  list failed:', e.message); }
  }
  // Local fallback/cache (download manually if raw.githubusercontent is flaky)
  const localList = join(OUTDIR, 'awesome-list.md');
  if (existsSync(localList)) {
    repos.push(...extractRepos(readFileSync(localList, 'utf8')));
    console.log('  + local awesome-list.md');
  }
  repos = [...new Set(repos)];
  console.log(`  found ${repos.length} unique repos`);
  writeFileSync(join(OUTDIR, 'repo-list.json'), JSON.stringify(repos, null, 2));

  // 2. Load previous results, scan the next LIMIT unscanned repos
  const dbPath = join(OUTDIR, 'servers.json');
  const db = existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, 'utf8')) : {};
  const todo = repos.filter(r => !db[r]).slice(0, LIMIT);
  console.log(`[2/3] scanning ${todo.length} repos (${Object.keys(db).length} already in db, token: ${TOKEN ? 'yes' : 'no — 60 req/h cap'})`);

  let done = 0, rateLimited = false;
  for (const full of todo) {
    try {
      const r = await fetch(`https://api.github.com/repos/${full}`, { headers: HEADERS });
      if (r.status === 403 || r.status === 429) { rateLimited = true; console.error('  RATE LIMITED — stopping, run again later'); break; }
      if (r.status === 404) { db[full] = { full, gone: true, scanned: new Date().toISOString() }; continue; }
      if (!r.ok) { console.error(`  ${full}: HTTP ${r.status}`); continue; }
      const info = await r.json();
      const { score, why } = healthScore(info);
      db[full] = {
        full,
        stars: info.stargazers_count,
        pushed_at: info.pushed_at,
        archived: !!info.archived,
        fork: !!info.fork,
        license: info.license?.spdx_id || null,
        open_issues: info.open_issues_count,
        desc: (info.description || '').slice(0, 140),
        score, why, verdict: verdict(score),
        scanned: new Date().toISOString()
      };
      writeFileSync(join(OUTDIR, 'badges', full.replace('/', '__') + '.svg'), badgeSVG(full, score));
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${todo.length}...`);
    } catch (e) { console.error(`  ${full}: ${e.message}`); }
  }
  writeFileSync(dbPath, JSON.stringify(db, null, 2));

  // 3. Summary + inject into site
  const all = Object.values(db).filter(x => !x.gone);
  const stats = {
    scanned: all.length,
    listed: repos.length,
    alive: all.filter(x => x.verdict === 'ALIVE').length,
    fading: all.filter(x => x.verdict === 'FADING').length,
    dead: all.filter(x => x.verdict === 'DEAD').length,
    gone: Object.values(db).filter(x => x.gone).length,
    scanDate: new Date().toISOString().slice(0, 10),
    rateLimited
  };
  console.log(`[3/3] done:`, JSON.stringify(stats));

  const sitePath = join(ROOT, 'site', 'index.html');
  if (existsSync(sitePath)) {
    const payload = `window.WT_DATA = ${JSON.stringify({ stats, servers: all.sort((a, b) => b.score - a.score || b.stars - a.stars) }, null, 1)};`;
    let html = readFileSync(sitePath, 'utf8');
    html = html.replace(/\/\*==WT_DATA_START==\*\/[\s\S]*?\/\*==WT_DATA_END==\*\//, `/*==WT_DATA_START==*/\n${payload}\n/*==WT_DATA_END==*/`);
    writeFileSync(sitePath, html);
    console.log('  site/index.html updated');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
