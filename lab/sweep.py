"""Quick regularisation sweep on the VAL split only (never test). Picks dropout / weight decay / steps."""
import json, sys, numpy as np
import train as T
rng = np.random.default_rng(T.SEED)
data = {'train': T.sample_pairs(rng, 1_200_000, 0), 'val': T.sample_pairs(rng, 20_000, 1)}
cases = T.hop_cases(rng, 800, 1)
out = []
for drop, wd, steps in [(0.0, 0.0, 1500), (0.3, 0.0, 1500), (0.3, 0.05, 1500), (0.5, 0.05, 1500), (0.3, 0.2, 1500), (0.3, 0.05, 4000)]:
    T.DROP, T.WD = drop, wd
    m, c, s = T.train(f'd{drop}w{wd}s{steps}', steps, data, cases, log_every=steps, drop=drop, wd=wd)
    acc, rnd = T.hop_accuracy(T.model_hop_fn(m), cases)
    r = {'drop': drop, 'wd': wd, 'steps': steps, 'val_mae': c[-1]['val_mae'], 'hop_acc': round(acc, 4), 'secs': s}
    print(r, flush=True); out.append(r)
const = float(np.abs(data['val'][2] - np.median(data['train'][2])).mean())
print('constant-median val mae', round(const, 4))
json.dump({'runs': out, 'constant_median_val_mae': round(const, 4)}, open('results/sweep.json', 'w'), indent=1)
