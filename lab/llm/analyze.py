import argparse
import glob
import json
import os
import random
import statistics

from game import DIFFS, HERE, MAX_STEPS, MODELS, PER_DIFF, EXT_PER_DIFF, PRICE_SOURCES, PRICED_ON, PROMPT_VERSION, RAW, SEED, load_env, sample_pairs

SITE_OUT = os.path.expanduser('~/Desktop/rg-portfolio/src/data/clicks/llm.json')
BENCH = os.path.expanduser('~/Desktop/rg-portfolio/src/data/clicks/benchmark.json')
ORDER = list(MODELS)


def r(x, n=4):
    return None if x is None else round(x, n)


def boot(vals, fn, b=2000, seed=SEED):
    if not vals:
        return [None, None]
    rnd = random.Random(seed)
    xs = sorted(fn([rnd.choice(vals) for _ in vals]) for _ in range(b))
    return [r(xs[int(0.025 * b)], 3), r(xs[int(0.975 * b) - 1], 3)]


def mean(a):
    return sum(a) / len(a) if a else None


def stats(rows):
    if not rows:
        return None
    solved = [g for g in rows if g['outcome'] == 'solved']
    calls = [a for g in rows for s in g['steps'] for a in s['attempts']]
    over = [g['clicks'] - g['optimal'] for g in solved]
    cost = sum(g['costUsd'] for g in rows)
    return {
        'n': len(rows),
        'success': r(len(solved) / len(rows), 3),
        'successCI': boot([1 if g['outcome'] == 'solved' else 0 for g in rows], mean),
        'clicksMean': r(mean([g['clicks'] for g in solved]), 3),
        'clicksOverOptimal': r(mean(over), 3),
        'clicksOverOptimalCI': boot(over, mean),
        'stepsMean': r(mean([g['stepsTaken'] for g in rows]), 3),
        'invalidMoveRate': r(sum(1 for a in calls if not a['valid']) / len(calls), 4),
        'tokensInMean': r(mean([g['tokensIn'] for g in rows]), 1),
        'tokensOutMean': r(mean([g['tokensOut'] for g in rows]), 1),
        'costPerGameUsd': r(cost / len(rows), 5),
        'costPerSolvedUsd': r(cost / len(solved), 5) if solved else None,
        'latencyMsPerStep': r(statistics.median([a['ms'] for a in calls]), 0),
        'loopRate': r(sum(1 for g in rows if g['revisits']) / len(rows), 3),
        'failReasons': {k: sum(1 for g in rows if g['failReason'] == k) for k in ('step_limit', 'invalid_move', 'dead_end') if any(g['failReason'] == k for g in rows)},
        'totalCostUsd': r(cost, 4),
    }


def load_games(ids):
    out = {}
    for k in ORDER:
        rows = [json.load(open(f)) for f in glob.glob(os.path.join(RAW, k, '*.json'))]
        rows = [g for g in rows if g['pair'] in ids]
        if rows:
            out[k] = rows
    return out


def replay(g):
    return {
        'model': g['model'], 'start': g['start'], 'target': g['target'], 'optimal': g['optimal'], 'difficulty': g['difficulty'],
        'outcome': g['outcome'], 'failReason': g['failReason'], 'path': g['path'], 'costUsd': g['costUsd'],
        'steps': [{'page': s['page'], 'offered': s['offered'], 'chosen': s.get('chosen'),
                   **({'invalid': [a['raw'] for a in s['attempts'] if not a['valid']]} if any(not a['valid'] for a in s['attempts']) else {})}
                  for s in g['steps']],
    }


def references(sample):
    if not os.path.exists(BENCH):
        return None
    b = json.load(open(BENCH))
    pick = lambda s: {k: s.get(k) for k in ('n', 'success', 'clicksMean', 'clicksOverOptimal', 'pagesOpenedMean')}
    return {
        'scope': f"reference on full set: {b['dataset']['pairs']} test pairs ({', '.join(f'{k} {v}' for k, v in b['dataset']['pairCounts'].items())}); "
                 f"our {len(sample)} LLM pairs are a seeded stratified subset of those same pairs. Per-pair reference results are not saved, so these numbers are NOT recomputed on the subset.",
        'benchmarkPreliminary': b.get('preliminary'),
        'benchmarkGenerated': b.get('generated'),
        'note': 'classical strategies and the trained model are search procedures with a page budget (pages opened, with backtracking); LLMs here walk one click at a time with no backtracking and 15 clicks max. costPerGameUsd for these is 0 API dollars: they run locally in the browser.',
        'strategies': [{'id': s['id'], 'name': s['name'], 'pageBudget': s['budget'], 'msMean': s.get('msMean'), 'overall': pick(s['overall']),
                        'byDifficulty': {d: pick(v) for d, v in s['byDifficulty'].items()}} for s in b['strategies']],
        'humans': b.get('humans'),
        'trainedModel': {k: b['model'].get(k) for k in ('params', 'sizeBytes', 'trainSeconds', 'testMetric')} if b.get('model') else None,
    }


def human_on_subset(sample):
    out = {}
    for d in (*DIFFS, 'all'):
        ps = [p for p in sample if p['human'] and p['human']['median_clicks'] is not None and (d == 'all' or p['difficulty'] == d)]
        fin = sum(p['human']['finished'] for p in ps)
        unf = sum(p['human']['unfinished'] for p in ps)
        out[d] = {'pairsPlayed': len(ps), 'games': fin + unf, 'success': r(fin / (fin + unf), 3) if ps else None,
                  'medianClicksMean': r(mean([p['human']['median_clicks'] for p in ps]), 3),
                  'clicksOverOptimal': r(mean([p['human']['median_clicks'] - p['optimal'] for p in ps]), 3)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--final', action='store_true')
    ap.add_argument('--replays', default='')
    a = ap.parse_args()
    _, _, _, pairs = load_env()
    sample = sample_pairs(pairs)
    ids = {p['id'] for p in sample}
    games = load_games(ids)
    ledger = json.load(open(os.path.join(HERE, 'spend.json')))
    models = []
    for k, rows in games.items():
        m = MODELS[k]
        settings = rows[0]['settings']
        models.append({
            'id': k, 'apiModel': m['model'], 'name': m['name'], 'provider': m['provider'],
            'priceInPerM': m['pin'], 'priceOutPerM': m['pout'], 'pricedOn': PRICED_ON, 'priceSource': PRICE_SOURCES[m['provider']],
            'settings': settings, 'pairsPlayed': len(rows),
            'overall': stats(rows), 'byDifficulty': {d: stats([g for g in rows if g['difficulty'] == d]) for d in DIFFS},
        })
    chosen = []
    if a.replays:
        for spec in a.replays.split(','):
            k, pid = spec.split(':')
            chosen += [g for g in games.get(k, []) if g['pair'] == pid]
    out = {
        'preliminary': not a.final,
        'date': PRICED_ON,
        'dataset': {'name': 'Wikispeedia navigation paths and link graph (Stanford SNAP), 4,604 articles', 'url': 'https://snap.stanford.edu/data/wikispeedia.html',
                    'license': 'SNAP research dataset; cite West & Leskovec (WWW 2012) and West, Pineau & Precup (IJCAI 2009). Article content is Wikipedia, CC BY-SA.'},
        'protocol': {'pairs': len({g['pair'] for rows in games.values() for g in rows}), 'perDifficulty': {d: len({g['pair'] for rows in games.values() for g in rows if g['difficulty'] == d}) for d in DIFFS},
                     'plannedPairs': len(sample), 'plannedPerDifficulty': PER_DIFF + EXT_PER_DIFF, 'pairSource': 'seeded stratified sample of the lab test pairs (data/pairs.json "test", 150 per difficulty): 20 per difficulty with seed 20261122, then 10 more per difficulty from the remainder with seed 20261123 (extension added after the first 60 because budget allowed; protocol unchanged)',
                     'difficulty': 'shortest path length: easy <= 2, medium 3, hard 4+ (same as the lab benchmark)',
                     'maxSteps': MAX_STEPS, 'sees': 'link titles only', 'temperature': 0,
                     'temperatureNote': 'temperature 0 sent where the API accepts it; models whose settings show temperature null do not accept it (Claude 5.5 via current SDK, OpenAI reasoning models)',
                     'promptVersion': PROMPT_VERSION, 'invalidMove': 're-ask once, then the game fails', 'backtracking': 'none; revisits allowed and counted',
                     'state': 'stateless per step: target, current page, path so far, full outgoing link list (no 50-link cap, no distance-based filtering)'},
        'priorWork': [
            {'name': 'LLM-WikiRace (Ziomek et al., arXiv 2602.16902, 2026)', 'url': 'https://arxiv.org/abs/2602.16902',
             'note': '549k-page Wikipedia graph, models see link titles only, 30-step cap, up to 50 links per page pre-filtered by distance to target; best model wins about 29% of hard games (paths of 7-8); looping is the main failure. Code: github.com/JuliuszZiomek/LLM-WikiRace-Benchmark'},
            {'name': 'WikiRacing Language Models (Hugging Face Space, HuggingFaceTB/wikiracing-llms)', 'url': 'https://huggingface.co/spaces/HuggingFaceTB/wikiracing-llms',
             'note': 'play against open models on Wikipedia links, plus a parallel evaluation harness for running many model agents'},
            {'name': 'Margiotta, Croce and Basili, Evaluating Large Language Models on Wikipedia Graph Navigation: Insights from the WikiGame (CLiC-it 2025, CEUR-WS Vol-4112)', 'url': 'https://ceur-ws.org/Vol-4112/62_main_long.pdf',
             'note': 'about 4,000 human WikiGame start-goal sessions used to test whether LLMs navigate the link graph beyond memorized facts'},
        ],
        'models': models,
        'humansOnSubset': human_on_subset(sample),
        'references': references(sample),
        'replays': [replay(g) for g in chosen],
        'spendUsd': ledger['totalUsd'],
    }
    os.makedirs(os.path.dirname(SITE_OUT), exist_ok=True)
    json.dump(out, open(SITE_OUT, 'w'), indent=1, ensure_ascii=False)
    json.dump(out, open(os.path.join(HERE, 'results.json'), 'w'), indent=1, ensure_ascii=False)
    for m in models:
        o = m['overall']
        print(f"{m['id']:28s} n={o['n']:3d} succ={o['success']:.3f} {o['successCI']} over={o['clicksOverOptimal']} inv={o['invalidMoveRate']} loop={o['loopRate']} $/game={o['costPerGameUsd']} $/solved={o['costPerSolvedUsd']} ms={o['latencyMsPerStep']}")
    print('spend', ledger['totalUsd'])


if __name__ == '__main__':
    main()
