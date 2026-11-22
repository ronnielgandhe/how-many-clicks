import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strategies, loadSiteModel, SITE, useWiki } from './site.mjs';
import { graphWiki } from './graphWiki.mjs';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SPLIT = arg('--split', 'test');
const LIMIT = Number(arg('--limit', '0'));
const ONLY = arg('--only', '');
const DIFFS = ['easy', 'medium', 'hard'];

const graph = JSON.parse(readFileSync(join(LAB, 'data/graph.json'), 'utf8'));
const pairsFile = JSON.parse(readFileSync(join(LAB, 'data/pairs.json'), 'utf8'));
let pairs = pairsFile[SPLIT];
if (LIMIT) pairs = DIFFS.flatMap((d) => pairs.filter((p) => p.difficulty === d).slice(0, LIMIT));

export function hashSeed(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export async function runOne(run, budget, p) {
  const wiki = graphWiki(graph.titles, graph.adj);
  useWiki(wiki);
  const t0 = performance.now();
  const res = await run(p.start, p.target, () => {}, { signal: new AbortController().signal, pace: () => 0, wiki, seed: hashSeed(p.start + '>' + p.target) });
  const ms = performance.now() - t0;
  let valid = !!res.path;
  if (res.path) for (let i = 1; i < res.path.length; i++) if (!wiki.hasEdge(res.path[i - 1], res.path[i])) valid = false;
  if (res.path && (res.path[0] !== p.start || res.path.at(-1) !== p.target)) valid = false;
  if (res.path && !valid) throw new Error(`invalid path ${res.path.join(' > ')}`);
  return { ok: !!res.path, clicks: res.path ? res.path.length - 1 : null, pages: res.totalExplored, optimal: p.optimal, difficulty: p.difficulty, human: p.human, ms, path: res.path };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = (x) => (x === null ? null : Math.round(x * 1000) / 1000);

export function stats(rows) {
  const solved = rows.filter((r) => r.ok);
  return {
    n: rows.length,
    success: r3(solved.length / rows.length),
    clicksMean: r3(mean(solved.map((r) => r.clicks))),
    optimalMean: r3(mean(solved.map((r) => r.optimal))),
    clicksOverOptimal: r3(mean(solved.map((r) => r.clicks - r.optimal))),
    optimalRate: r3(solved.filter((r) => r.clicks === r.optimal).length / rows.length),
    pagesOpenedMean: r3(mean(rows.map((r) => r.pages))),
    pagesOpenedMedian: median(rows.map((r) => r.pages)),
    msMean: r3(mean(rows.map((r) => r.ms))),
  };
}

function vsHumans(rows) {
  const h = rows.filter((r) => r.ok && r.human && r.human.median_clicks !== null);
  return {
    pairs: h.length,
    botClicksMean: r3(mean(h.map((r) => r.clicks))),
    humanMedianClicksMean: r3(mean(h.map((r) => r.human.median_clicks))),
    botShorterOrEqual: r3(h.filter((r) => r.clicks <= r.human.median_clicks).length / (h.length || 1)),
  };
}

export function humanStats(ps) {
  const out = {};
  for (const d of [...DIFFS, 'all']) {
    const h = ps.filter((p) => p.human && (d === 'all' || p.difficulty === d));
    const fin = h.reduce((a, p) => a + p.human.finished, 0), unf = h.reduce((a, p) => a + p.human.unfinished, 0);
    out[d] = {
      medianClicks: median(h.map((p) => p.human.median_clicks)),
      clicksMean: r3(mean(h.map((p) => p.human.median_clicks))),
      optimalMean: r3(mean(h.map((p) => p.optimal))),
      clicksOverOptimal: r3(mean(h.map((p) => p.human.median_clicks - p.optimal))),
      pagesMedian: median(h.map((p) => p.human.median_pages)),
      success: r3(fin / ((fin + unf) || 1)),
      n: h.length, games: fin + unf,
    };
  }
  return out;
}

async function main() {
  loadSiteModel();
  const list = [...strategies.STRATEGIES, ...(process.argv.includes('--no-variants') ? [] : strategies.VARIANTS)].filter((s) => !ONLY || ONLY.split(',').includes(s.id));
  const results = [];
  for (const s of list) {
    const rows = [];
    for (const p of pairs) rows.push(await runOne(s.run, s.budget, p));
    const byDifficulty = Object.fromEntries(DIFFS.map((d) => [d, stats(rows.filter((r) => r.difficulty === d))]));
    const entry = { id: s.id, name: s.name, budget: s.budget, variant: strategies.VARIANTS.includes(s), overall: stats(rows), byDifficulty, vsHumans: vsHumans(rows), examples: rows.filter((r) => r.ok).slice(0, 3).map((r) => r.path) };
    results.push(entry);
    console.log(s.id.padEnd(9), JSON.stringify(entry.overall));
  }
  const out = { split: SPLIT, limit: LIMIT || null, seed: pairsFile.seed, date: new Date().toISOString().slice(0, 10), pairs: pairs.length,
    pairCounts: Object.fromEntries(DIFFS.map((d) => [d, pairs.filter((p) => p.difficulty === d).length])), humans: humanStats(pairs), strategies: results };
  writeFileSync(join(LAB, `results/bench-${SPLIT}.json`), JSON.stringify(out, null, 1));
  if (SPLIT === 'test' && !ONLY) {
    const { publish } = await import('./publish.mjs');
    publish({ preliminary: !!LIMIT });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
