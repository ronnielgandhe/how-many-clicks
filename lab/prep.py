"""Parse the Wikispeedia dump into compact arrays, split articles, and pick benchmark pairs.

Outputs:
  data/ws.npz       titles, dist matrix (uint8, 255 = unreachable), edges, article split
  data/graph.json   titles + forward adjacency, read by the node benchmark
  data/pairs.json   seeded benchmark pairs (tune split + test split) with optimal + human stats
"""
import json
import os
import random
import statistics
from collections import defaultdict
from urllib.parse import unquote

import numpy as np

SEED = 20261122
RAW = os.path.join(os.path.dirname(__file__), 'data/raw/wikispeedia_paths-and-graph')
OUT = os.path.join(os.path.dirname(__file__), 'data')


def rows(name):
    with open(os.path.join(RAW, name), encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if line and not line.startswith('#'):
                yield line.split('\t')


def clean(t):
    return unquote(t).replace('_', ' ')


def main():
    titles = [clean(r[0]) for r in rows('articles.tsv')]
    idx = {t: i for i, t in enumerate(titles)}
    n = len(titles)

    edges = sorted({(idx[clean(a)], idx[clean(b)]) for a, b in rows('links.tsv')})
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)

    dist = np.full((n, n), 255, dtype=np.uint8)
    with open(os.path.join(RAW, 'shortest-path-distance-matrix.txt')) as f:
        r = 0
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            dist[r] = [255 if c == '_' else int(c) for c in line]
            r += 1
    assert r == n

    human = defaultdict(list)
    adjset = [set(a) for a in adj]
    clicks = []
    for r in rows('paths_finished.tsv'):
        steps = [clean(s) if s != '<' else '<' for s in r[3].split(';')]
        stack = []
        for s in steps:
            if s == '<':
                stack.pop()
            else:
                if stack and s in idx and stack[-1] in idx and idx[s] in adjset[idx[stack[-1]]]:
                    clicks.append((idx[stack[-1]], idx[s], idx[steps[-1]] if steps[-1] in idx else -1))
                stack.append(s)
        if stack[0] not in idx or stack[-1] not in idx:
            continue
        human[(idx[stack[0]], idx[stack[-1]])].append({
            'clicks': len(stack) - 1,
            'raw': len(steps) - 1,
            'pages': sum(1 for s in steps if s != '<'),
            'secs': int(r[2]),
        })
    unfinished = defaultdict(int)
    for r in rows('paths_unfinished.tsv'):
        s, t = clean(r[3].split(';')[0]), clean(r[4])
        if s in idx and t in idx:
            unfinished[(idx[s], idx[t])] += 1

    rnd = random.Random(SEED)
    order = list(range(n))
    rnd.shuffle(order)
    split = np.zeros(n, dtype=np.uint8)
    a, b = int(n * 0.7), int(n * 0.85)
    split[order[a:b]] = 1
    split[order[b:]] = 2

    def difficulty(d):
        return 'easy' if d <= 2 else 'medium' if d == 3 else 'hard'

    def pick(target_split, per_bucket, rnd):
        """Pairs whose start AND target were held out of training. Pairs humans played go first."""
        played, other = defaultdict(list), defaultdict(list)
        nodes = [i for i in range(n) if split[i] == target_split and adj[i]]
        for (s, t), hs in human.items():
            if split[s] == target_split and split[t] == target_split and s != t and dist[s, t] != 255:
                played[difficulty(int(dist[s, t]))].append((s, t))
        tries = 0
        while any(len(other[k]) < per_bucket * 4 for k in ('easy', 'medium', 'hard')) and tries < 400000:
            tries += 1
            s, t = rnd.choice(nodes), rnd.choice(nodes)
            d = int(dist[s, t])
            if s == t or d == 255 or d < 2:
                continue
            other[difficulty(d)].append((s, t))
        out = []
        for k in ('easy', 'medium', 'hard'):
            hp = sorted(set(played[k]))
            rnd.shuffle(hp)
            chosen = hp[: per_bucket // 2]
            seen = set(chosen)
            for p in other[k]:
                if len(chosen) >= per_bucket:
                    break
                if p not in seen and p[::-1] not in seen:
                    seen.add(p)
                    chosen.append(p)
            for s, t in chosen:
                hs = human.get((s, t), [])
                out.append({
                    'start': titles[s], 'target': titles[t], 'optimal': int(dist[s, t]), 'difficulty': k,
                    'human': {
                        'finished': len(hs), 'unfinished': unfinished.get((s, t), 0),
                        'median_clicks': statistics.median([h['clicks'] for h in hs]) if hs else None,
                        'median_pages': statistics.median([h['pages'] for h in hs]) if hs else None,
                    } if hs else None,
                })
        return out

    pairs = {
        'seed': SEED,
        'tune': pick(1, 40, random.Random(SEED + 1)),
        'test': pick(2, 150, random.Random(SEED + 2)),
    }

    np.savez_compressed(os.path.join(OUT, 'ws.npz'), titles=np.array(titles), dist=dist, edges=np.array(edges, dtype=np.int32), split=split, clicks=np.array([c for c in clicks if c[2] >= 0 and c[1] != c[2]], dtype=np.int32))
    with open(os.path.join(OUT, 'graph.json'), 'w') as f:
        json.dump({'titles': titles, 'adj': adj, 'split': split.tolist()}, f)
    with open(os.path.join(OUT, 'pairs.json'), 'w') as f:
        json.dump(pairs, f, indent=1)

    reach = dist[dist != 255]
    hp_all = [h for hs in human.values() for h in hs]
    print(json.dumps({
        'articles': n, 'links': len(edges), 'human_finished': len(hp_all), 'human_pairs': len(human),
        'split': {'train': int((split == 0).sum()), 'val': int((split == 1).sum()), 'test': int((split == 2).sum())},
        'reachable_pairs': int(reach.size - n), 'mean_dist': round(float(reach[reach > 0].mean()), 3),
        'dist_hist': {int(k): int(v) for k, v in zip(*np.unique(reach, return_counts=True))},
        'tune_pairs': len(pairs['tune']), 'test_pairs': len(pairs['test']),
        'test_with_humans': sum(1 for p in pairs['test'] if p['human']),
        'human_median_clicks_all': statistics.median([h['clicks'] for h in hp_all]),
    }, indent=1))


if __name__ == '__main__':
    main()
