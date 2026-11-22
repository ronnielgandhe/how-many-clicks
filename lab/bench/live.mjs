import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strategies, loadSiteModel, SITE, useWiki } from './site.mjs';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..');
const { liveWiki } = await import(join(SITE, 'src/tools/clicks/strategies/live.ts'));
const CACHE = join(LAB, 'data/live-cache.json');
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const GAP = 1500;
let last = 0, calls = 0;
const throttle = async () => { const w = last + GAP - Date.now(); if (w > 0) await new Promise((r) => setTimeout(r, w)); last = Date.now(); };
const cached = (kind) => async (title, signal) => {
  const k = `${kind}:${title}`;
  if (!(k in cache)) { await throttle(); calls++; cache[k] = await liveWiki[kind](title, signal); if (calls % 50 === 0) writeFileSync(CACHE, JSON.stringify(cache)); }
  return cache[k];
};
const wiki = { resolve: cached('resolve'), links: cached('links'), backlinks: cached('backlinks') };

export const LIVE_PAIRS = [['Pizza', 'Albert Einstein'], ['Mount Everest', 'Jazz'], ['Bitcoin', 'Ancient Egypt'], ['Eiffel Tower', 'Penguin']];
const LIVE_IDS = (process.env.LIVE_IDS || 'guided,model,bidi,god,keyword').split(',');

loadSiteModel();
useWiki(wiki);
const rows = {};
for (const s of strategies.STRATEGIES.filter((x) => LIVE_IDS.includes(x.id))) {
  rows[s.id] = [];
  for (const [a, b] of LIVE_PAIRS) {
    let err = null;
    const res = await s.run(a, b, (e) => { if (e.type === 'error') err = e.message; }, { signal: new AbortController().signal, pace: () => 0, wiki, seed: 11 });
    if (err && /rate limit/.test(err)) { writeFileSync(CACHE, JSON.stringify(cache)); console.error('rate limited, stopping'); process.exit(2); }
    rows[s.id].push({ start: a, target: b, path: res.path, pages: res.totalExplored, error: err });
    console.log(s.id.padEnd(9), a, '>', b, res.path ? res.path.length - 1 : 'x', res.totalExplored, 'calls', calls);
  }
  writeFileSync(CACHE, JSON.stringify(cache));
}
const best = LIVE_PAIRS.map((_, i) => Math.min(...Object.values(rows).map((r) => (r[i].path ? r[i].path.length - 1 : Infinity))));
const mean = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 1000) / 1000 : null);
const out = {
  date: new Date().toISOString().slice(0, 10), apiCalls: calls, throttleMs: GAP,
  pairs: LIVE_PAIRS.map(([start, target], i) => ({ start, target, bestKnown: best[i] })),
  strategies: Object.entries(rows).map(([id, r]) => ({
    id,
    success: Math.round((r.filter((x) => x.path).length / r.length) * 1000) / 1000,
    clicksMean: mean(r.filter((x) => x.path).map((x) => x.path.length - 1)),
    overBestKnown: mean(r.map((x, i) => [x, i]).filter(([x]) => x.path).map(([x, i]) => x.path.length - 1 - best[i])),
    pagesOpenedMean: mean(r.map((x) => x.pages)),
    runs: r,
  })),
};
writeFileSync(join(LAB, 'results/live.json'), JSON.stringify(out, null, 1));
const { publish } = await import('./publish.mjs');
publish({ preliminary: false });
