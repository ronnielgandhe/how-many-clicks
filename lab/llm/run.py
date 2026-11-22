import argparse
import datetime
import json
import os
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

from game import CAP_USD, HERE, MODELS, RAW, Caller, load_env, pilot_pairs, play, sample_pairs

LEDGER = os.path.join(HERE, 'spend.json')
SAFETY = 0.75
lock = threading.Lock()


def now():
    return datetime.datetime.now().isoformat(timespec='seconds')


def spent_on_disk():
    total = 0.0
    if not os.path.isdir(RAW):
        return 0.0
    for m in os.listdir(RAW):
        for f in os.listdir(os.path.join(RAW, m)):
            if f.endswith('.json'):
                total += json.load(open(os.path.join(RAW, m, f)))['costUsd']
    return total


def ledger():
    if os.path.exists(LEDGER):
        return json.load(open(LEDGER))
    return {'capUsd': CAP_USD, 'totalUsd': 0.0, 'batches': []}


def ledger_total(L):
    return sum(b.get('actualUsd') or 0 for b in L['batches'])


def save_ledger(L):
    L['totalUsd'] = round(ledger_total(L), 4)
    L['note'] = 'totalUsd = sum of batch actuals (tokens x published price), including discarded pilot runs and ad hoc smoke calls'
    json.dump(L, open(LEDGER, 'w'), indent=1)


def done_games(key):
    d = os.path.join(RAW, key)
    return {f[:-5] for f in os.listdir(d)} if os.path.isdir(d) else set()


def per_game_estimate(key, diff):
    d = os.path.join(RAW, key)
    if not os.path.isdir(d):
        return None
    rows = [json.load(open(os.path.join(d, f))) for f in os.listdir(d)]
    same = [r['costUsd'] for r in rows if r['difficulty'] == diff] or [r['costUsd'] for r in rows]
    if not same:
        return None
    return max(sum(same) / len(same), max(same) * 0.75)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--models', required=True)
    ap.add_argument('--pilot', action='store_true')
    ap.add_argument('--estimate-only', action='store_true')
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()
    titles, adj, idx, pairs = load_env()
    sample = sample_pairs(pairs)
    todo_pairs = pilot_pairs(sample) if a.pilot else sample
    keys = a.models.split(',')

    jobs, est = [], {}
    for k in keys:
        have = done_games(k)
        todo = [p for p in todo_pairs if p['id'] not in have]
        e = 0.0
        for p in todo:
            g = per_game_estimate(k, p['difficulty'])
            e += g if g is not None else 0.05
        est[k] = (len(todo), round(e, 4))
        jobs += [(k, p) for p in todo]
    disk0 = spent_on_disk()
    base = ledger_total(ledger())
    total_est = sum(v[1] for v in est.values())
    print(json.dumps({'spentSoFar': round(base, 4), 'estimate': est, 'estimateTotal': round(total_est, 4), 'cap': CAP_USD}, indent=1))
    if a.estimate_only or not jobs:
        return
    if base + total_est > CAP_USD - SAFETY:
        print('ESTIMATE EXCEEDS CAP, not starting this batch')
        return

    L = ledger()
    batch = {'kind': 'pilot' if a.pilot else 'main', 'models': keys, 'games': len(jobs), 'estimateUsd': round(total_est, 4),
             'spentBeforeUsd': round(base, 4), 'started': now(), 'actualUsd': 0.0}
    L['batches'].append(batch)
    save_ledger(L)

    callers = {k: Caller(k) for k in keys}
    inflight = {'reserve': 0.0}
    state = {'stop': False}

    def run(job):
        k, p = job
        g = per_game_estimate(k, p['difficulty']) or 0.05
        with lock:
            if state['stop'] or base + spent_on_disk() - disk0 + inflight['reserve'] + g > CAP_USD - SAFETY:
                state['stop'] = True
                return f'skip {k} {p["id"]} (cap)'
            inflight['reserve'] += g
        try:
            res = play(callers[k], p, titles, adj, idx)
            os.makedirs(os.path.join(RAW, k), exist_ok=True)
            with lock:
                json.dump(res, open(os.path.join(RAW, k, p['id'] + '.json'), 'w'), indent=1)
            return f'{k:28s} {p["id"]:9s} {p["difficulty"]:6s} {res["outcome"]:6s} clicks={res["clicks"]:2d} opt={p["optimal"]} ${res["costUsd"]:.4f}'
        except Exception as e:
            return f'ERROR {k} {p["id"]}: {type(e).__name__}: {str(e)[:300]}\n{traceback.format_exc()[-600:]}'
        finally:
            with lock:
                inflight['reserve'] -= g

    with ThreadPoolExecutor(max_workers=min(4, a.workers)) as ex:
        for line in ex.map(run, jobs):
            print(line, flush=True)

    L = ledger()
    L['batches'][-1].update(finished=now(), actualUsd=round(spent_on_disk() - disk0, 4), stoppedAtCap=state['stop'],
                            settings={k: c.settings() for k, c in callers.items()})
    save_ledger(L)
    print(json.dumps({'batchActual': L['batches'][-1]['actualUsd'], 'totalUsd': L['totalUsd']}))


if __name__ == '__main__':
    main()
