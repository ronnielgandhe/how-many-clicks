import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strategies, modelLib, pathfinder, useWiki, MODEL_IDS } from '../bench/site.mjs';
import { graphWiki } from '../bench/graphWiki.mjs';

const { STRATEGIES, strategyById } = strategies;
const EVENT_TYPES = new Set(['status', 'resolved', 'visiting', 'links_found', 'scored', 'considering', 'clicking', 'skipped', 'found', 'not_found', 'error']);

const EDGES = {
  Paris: ['France', 'Volcano Bay', 'Eiffel Tower'],
  France: ['Iceland', 'Europe', 'Paris'],
  'Eiffel Tower': ['Paris', 'Iron'],
  Iron: ['Metal'],
  Metal: ['Iron'],
  'Volcano Bay': ['Volcano Bay Rides'],
  'Volcano Bay Rides': ['Volcano Bay Florida'],
  'Volcano Bay Florida': ['Volcano'],
  Iceland: ['Volcano', 'Europe'],
  Europe: ['France', 'Iceland'],
  Volcano: ['Lava'],
  Lava: ['Volcano'],
  Island: [],
};
const TITLES = Object.keys(EDGES);
const ADJ = TITLES.map((t) => EDGES[t].map((x) => TITLES.indexOf(x)));
const toy = () => graphWiki(TITLES, ADJ);

function bfs(adj, s, t) {
  const d = new Map([[s, 0]]);
  const q = [s];
  while (q.length) {
    const u = q.shift();
    if (u === t) return d.get(u);
    for (const v of adj[u]) if (!d.has(v)) { d.set(v, d.get(u) + 1); q.push(v); }
  }
  return Infinity;
}

const oracle = (titles, adj) => {
  const idx = (t) => titles.indexOf(t);
  const dist = (a, b) => Math.min(9, bfs(adj, idx(a), idx(b)));
  return {
    meta: {},
    distance: (links, target) => Float32Array.from(links, (l) => dist(l, target)),
    distanceFrom: (source, targets) => Float32Array.from(targets, (t) => dist(source, t)),
  };
};
const useOracle = (titles, adj) => {
  for (const id of MODEL_IDS) modelLib.setModel(id, oracle(titles, adj));
  modelLib.setSemantic({ related: (links) => new Float32Array(links.length) });
};

async function race(id, from, to, wiki, extra = {}) {
  useWiki(wiki);
  const events = [];
  const res = await strategyById(id).run(from, to, (e) => events.push(e), { signal: new AbortController().signal, pace: () => 0, wiki, seed: 3, ...extra });
  return { res, events };
}

function validPath(wiki, path) {
  for (let i = 1; i < path.length; i++) if (!wiki.hasEdge(path[i - 1], path[i])) return false;
  return true;
}

test('registry: my models first, unique ids, every entry explained', () => {
  assert.deepEqual(STRATEGIES.slice(0, 2).map((s) => s.id), ['guided', 'model']);
});

test('registry has unique ids and every entry has a run function and explanation', () => {
  assert.equal(new Set(STRATEGIES.map((s) => s.id)).size, STRATEGIES.length);
  for (const s of STRATEGIES) {
    assert.equal(typeof s.run, 'function');
    assert.ok(s.explain.length > 80, s.id);
    assert.ok(!/—/.test(s.explain + s.blurb), `${s.id} has an em dash`);
  }
});

test('every strategy finds a valid path and only emits event types the race UI knows', async () => {
  useOracle(TITLES, ADJ);
  for (const s of [...STRATEGIES, ...strategies.VARIANTS]) {
    const wiki = toy();
    const { res, events } = await race(s.id, 'Paris', 'Volcano', wiki);
    assert.ok(res.path, `${s.id} found nothing`);
    assert.equal(res.path[0], 'Paris');
    assert.equal(res.path.at(-1), 'Volcano');
    assert.ok(validPath(wiki, res.path), `${s.id} returned a broken path ${res.path}`);
    for (const e of events) assert.ok(EVENT_TYPES.has(e.type), `${s.id} emitted ${e.type}`);
    const last = events.at(-1);
    assert.equal(last.type, 'found');
    assert.equal(last.clicks, res.path.length - 1);
    assert.equal(events.find((e) => e.type === 'resolved').target, 'Volcano');
  }
});

test('bidirectional finds the true shortest path where greedy keyword gets lured', async () => {
  const kw = await race('keyword', 'Paris', 'Volcano', toy());
  const bd = await race('bidi', 'Paris', 'Volcano', toy());
  assert.equal(bd.res.path.length - 1, 3);
  assert.deepEqual(bd.res.path, ['Paris', 'France', 'Iceland', 'Volcano']);
  assert.ok(kw.res.path.length - 1 > 3, 'keyword should take the Volcano Bay bait');
  assert.ok(bd.events.some((e) => e.side === 'backward'), 'bidirectional reports its backward frontier');
});

test('guided bidirectional with a perfect distance oracle is optimal on random graphs', async () => {
  let rnd = 9;
  const r = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let g = 0; g < 25; g++) {
    const n = 40;
    const titles = Array.from({ length: n }, (_, i) => `Node ${i}`);
    const adj = titles.map((_, i) => [...new Set(Array.from({ length: 3 }, () => Math.floor(r() * n)))].filter((j) => j !== i));
    const s = Math.floor(r() * n), t = Math.floor(r() * n);
    const opt = bfs(adj, s, t);
    if (s === t || opt === Infinity) continue;
    useOracle(titles, adj);
    const gd = await race('guided', titles[s], titles[t], graphWiki(titles, adj));
    const bd = await race('bidi', titles[s], titles[t], graphWiki(titles, adj));
    assert.equal(gd.res.path.length - 1, opt, `guided graph ${g}`);
    assert.ok(bd.res.path.length - 1 <= opt + 1, `bidi graph ${g}`);
    assert.ok(validPath(graphWiki(titles, adj), bd.res.path));
  }
});

test('unreachable target ends in not_found, not a crash', async () => {
  for (const s of STRATEGIES) {
    const { res, events } = await race(s.id, 'Paris', 'Island', toy());
    assert.equal(res.path, null, s.id);
    assert.equal(events.at(-1).type, 'not_found', s.id);
  }
});

test('abort stops a run with an AbortError', async () => {
  const ctl = new AbortController();
  useWiki(toy());
  const p = strategyById('god').run('Paris', 'Volcano', () => ctl.abort(), { signal: ctl.signal, pace: () => 1, wiki: toy() });
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('keyword and god mode ARE the game page findPath, same results as its builtin strategies', async () => {
  for (const [id, builtin] of [['keyword', 'beam'], ['god', 'beam-god']]) {
    for (const [a, b] of [['Paris', 'Volcano'], ['Eiffel Tower', 'Lava'], ['Paris', 'Island']]) {
      const mine = await race(id, a, b, toy());
      useWiki(toy());
      const theirs = [];
      const res = await pathfinder.BUILTIN_STRATEGIES.find((s) => s.id === builtin).run(a, b, (e) => theirs.push(e), { signal: new AbortController().signal, pace: () => 0 });
      assert.deepEqual(mine.res, res, `${id} ${a}>${b}`);
      assert.deepEqual(mine.events, theirs, `${id} ${a}>${b} events`);
    }
  }
});

test('model inference matches the python tokenizer hash', () => {
  assert.equal(modelLib.fnv('w:volcano'), 1394319790);
  assert.deepEqual(modelLib.tokenIds('Côte d’Ivoire_(country)', 16384), [8865, 13952, 13790, 2582, 7306, 8750, 6910, 14803, 6014, 9679, 6660, 3494, 5502, 9246, 15953, 7306, 9153, 15734, 4937, 6676, 12445, 12989]);
  assert.deepEqual(modelLib.words('Côte d’Ivoire_(country)'), ['cote', 'd', 'ivoire', 'country']);
  assert.deepEqual(modelLib.trigrams(['ab']), ['<ab', 'ab>']);
});
