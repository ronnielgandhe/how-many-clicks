"""Train the model family, numpy only, one process, two BLAS threads.

  tiny       small distance predictor (4k buckets x 16 dims)
  base       distance predictor (16k buckets x 32 dims)
  imitate    same size as base, trained ONLY to copy the link real players clicked (human paths)
  human      base, then fine-tuned on distances + human clicks together
  + the semantic embedding (link prediction) and feature ablations on the base size

Every model is exported to public/clicks-model/<id>.{json,bin}. Which one ships as "god" is picked
afterwards by bench/tune.mjs on validation races, never on the test races.

  python train.py            full run, writes results/train.json
  python train.py --quick    short smoke run
"""
import json
import os
import sys
import time

os.environ.setdefault('OPENBLAS_NUM_THREADS', '2')
os.environ.setdefault('OMP_NUM_THREADS', '2')
import numpy as np

import tok

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 7
QUICK = '--quick' in sys.argv
STEPS = 600 if QUICK else 4000
FT_STEPS = 300 if QUICK else 1500
ABL_STEPS = 300 if QUICK else 1500
BATCH = 1024
RANK_BATCH = 512
DROP, WD = 0.3, 0.05
SIZES = {'tiny': dict(buckets=1 << 12, dim=16, hid=16, mlp=32), 'base': dict(buckets=1 << 14, dim=32, hid=32, mlp=64)}
SEM_BUCKETS, SEM_DIM = 1 << 13, 24
OUT = os.path.normpath(os.environ.get('CLICKS_MODEL_OUT', os.path.join(HERE, '..', '..', '..', 'rg-portfolio', 'public', 'clicks-model')))

D = np.load(os.path.join(HERE, 'data/ws.npz'))
TITLES = [str(t) for t in D['titles']]
DIST, EDGES, SPLIT, CLICKS = D['dist'], D['edges'], D['split'], D['clicks']
N = len(TITLES)
ADJ = [[] for _ in range(N)]
for a, b in EDGES:
    ADJ[a].append(b)
ADJ = [np.array(x, dtype=np.int64) for x in ADJ]


class Pool:
    """Mean of token embeddings for every article, with a reduceat backward."""

    def __init__(self, buckets, **kw):
        ids, starts, inv = [], [], []
        for t in TITLES:
            x = tok.token_ids(t, buckets, **kw)
            starts.append(len(ids))
            ids.extend(x)
            inv.append(1.0 / len(x))
        self.ids = np.array(ids, dtype=np.int64)
        self.starts = np.array(starts, dtype=np.int64)
        self.inv = np.array(inv, dtype=np.float32)
        self.owner = np.repeat(np.arange(N), np.diff(np.append(self.starts, len(ids))))
        self.order = np.argsort(self.ids, kind='stable')
        self.uniq, self.ustarts = np.unique(self.ids[self.order], return_index=True)

    def forward(self, E):
        return np.add.reduceat(E[self.ids], self.starts, axis=0) * self.inv[:, None]

    def backward(self, gP, E):
        contrib = (gP * self.inv[:, None])[self.owner]
        g = np.zeros_like(E)
        g[self.uniq] = np.add.reduceat(contrib[self.order], self.ustarts, axis=0)
        return g


def sample_pairs(rng, n, who):
    pool = np.where(SPLIT == who)[0]
    mask = np.zeros(N, bool)
    mask[pool] = True
    indeg = EDGES[mask[EDGES[:, 1]], 1]
    us, vs = [], []
    while len(us) < n:
        k = n * 2
        u = np.where(rng.random(k) < 0.5, rng.choice(pool, k), rng.choice(indeg, k))
        v = rng.choice(pool, k)
        ok = (u != v) & (DIST[u, v] != 255)
        us.extend(u[ok])
        vs.extend(v[ok])
    us, vs = np.array(us[:n]), np.array(vs[:n])
    return us, vs, DIST[us, vs].astype(np.float32), tok.feature_matrix(TITLES, us, vs)


def hop_cases(rng, n, who):
    targets = np.where(SPLIT == who)[0]
    out = []
    while len(out) < n:
        v, p = int(rng.choice(targets)), int(rng.integers(N))
        d = DIST[p, v]
        if p == v or d == 255 or d < 2 or len(ADJ[p]) < 2:
            continue
        good = DIST[ADJ[p], v] == d - 1
        if not good.all():
            out.append((v, ADJ[p], good))
    return out


def human_clicks(who):
    """Real player clicks (page, clicked link, target) whose TARGET is in the given article split."""
    c = CLICKS[(SPLIT[CLICKS[:, 2]] == who) & np.array([len(ADJ[p]) > 1 for p in CLICKS[:, 0]])]
    return c


class Model:
    def __init__(self, rng, size='base', use_words=True, use_grams=True, use_feats=True, use_emb=True):
        self.size = size
        self.dims = SIZES[size]
        B, d, h, m = self.dims['buckets'], self.dims['dim'], self.dims['hid'], self.dims['mlp']
        self.cfg = dict(use_words=use_words, use_grams=use_grams, use_feats=use_feats, use_emb=use_emb)
        self.rng = rng
        self.pool = Pool(B, use_words=use_words, use_grams=use_grams) if use_emb else None
        zin = (3 * h if use_emb else 0) + (tok.N_FEATS if use_feats else 0)
        r = lambda *s, sc: (rng.standard_normal(s) * sc).astype(np.float32)
        self.p = {'W1': r(zin, m, sc=(2 / zin) ** 0.5), 'b1': np.zeros(m, np.float32), 'w2': r(m, sc=m ** -0.5), 'b2': np.array([3.2], np.float32)}
        if use_emb:
            self.p.update({'E': r(B, d, sc=0.1), 'Ws': r(d, h, sc=d ** -0.5), 'bs': np.zeros(h, np.float32),
                           'Wt': r(d, h, sc=d ** -0.5), 'bt': np.zeros(h, np.float32)})
        self.reset_opt()

    def reset_opt(self):
        self.m = {k: np.zeros_like(v) for k, v in self.p.items()}
        self.v = {k: np.zeros_like(v) for k, v in self.p.items()}
        self.t = 0

    def params(self):
        return int(sum(v.size for v in self.p.values()))

    def forward(self, u, v, F, P=None, train=False):
        p, c, parts, H = self.p, {}, [], self.dims['hid']
        if self.cfg['use_emb']:
            P = self.pool.forward(p['E']) if P is None else P
            eu, ev = P[u], P[v]
            if train and DROP > 0:
                mu = (self.rng.random(eu.shape) >= DROP).astype(np.float32) / (1 - DROP)
                mv = (self.rng.random(ev.shape) >= DROP).astype(np.float32) / (1 - DROP)
                eu, ev = eu * mu, ev * mv
                c.update(mu=mu, mv=mv)
            a = np.tanh(eu @ p['Ws'] + p['bs'])
            b = np.tanh(ev @ p['Wt'] + p['bt'])
            parts += [a, b, a * b]
            c.update(P=P, u=u, v=v, eu=eu, ev=ev, a=a, b=b)
        if self.cfg['use_feats']:
            parts.append(F)
        z = np.concatenate(parts, axis=1)
        hp = z @ p['W1'] + p['b1']
        h = np.maximum(hp, 0)
        c.update(z=z, hp=hp, h=h)
        return h @ p['w2'] + p['b2'][0], c

    def backward(self, c, gy):
        p, g, H = self.p, {}, self.dims['hid']
        g['w2'] = c['h'].T @ gy
        g['b2'] = np.array([gy.sum()], np.float32)
        ghp = np.outer(gy, p['w2']) * (c['hp'] > 0)
        g['W1'] = c['z'].T @ ghp
        g['b1'] = ghp.sum(0)
        if self.cfg['use_emb']:
            gz = ghp @ p['W1'].T
            a, b = c['a'], c['b']
            ga = gz[:, :H] + gz[:, 2 * H:3 * H] * b
            gb = gz[:, H:2 * H] + gz[:, 2 * H:3 * H] * a
            gap, gbp = ga * (1 - a * a), gb * (1 - b * b)
            g['Ws'], g['bs'] = c['eu'].T @ gap, gap.sum(0)
            g['Wt'], g['bt'] = c['ev'].T @ gbp, gbp.sum(0)
            geu, gev = gap @ p['Ws'].T, gbp @ p['Wt'].T
            if 'mu' in c:
                geu, gev = geu * c['mu'], gev * c['mv']
            gP = np.zeros_like(c['P'])
            np.add.at(gP, c['u'], geu)
            np.add.at(gP, c['v'], gev)
            g['E'] = self.pool.backward(gP, p['E'])
        return g

    def apply(self, g, lr):
        self.t += 1
        for k, w in self.p.items():
            self.m[k] = 0.9 * self.m[k] + 0.1 * g[k]
            self.v[k] = 0.999 * self.v[k] + 0.001 * g[k] * g[k]
            mh = self.m[k] / (1 - 0.9 ** self.t)
            vh = self.v[k] / (1 - 0.999 ** self.t)
            w -= (lr * mh / (np.sqrt(vh) + 1e-8)).astype(np.float32)
            if k == 'E':
                w *= np.float32(1 - lr * WD)

    def reg_grads(self, u, v, d, F):
        y, c = self.forward(u, v, F, train=True)
        err = y - d
        loss = float(np.where(np.abs(err) < 1, 0.5 * err ** 2, np.abs(err) - 0.5).mean())
        return loss, self.backward(c, (np.clip(err, -1, 1) / len(d)).astype(np.float32))

    def rank_grads(self, pc, vv, nn):
        """Pairwise: the link the player clicked should be predicted closer than a random other link on that page."""
        cc, pcache = self.forward(pc, vv, tok.feature_matrix(TITLES, pc, vv), train=True)
        cn, ncache = self.forward(nn, vv, tok.feature_matrix(TITLES, nn, vv), train=True)
        diff = cc - cn
        loss = float(np.logaddexp(0, diff).mean())
        gd = (1 / (1 + np.exp(-diff)) / len(diff)).astype(np.float32)
        g1, g2 = self.backward(pcache, gd), self.backward(ncache, -gd)
        return loss, {k: g1[k] + g2[k] for k in g1}

    def predict(self, u, v, F):
        P = self.pool.forward(self.p['E']) if self.cfg['use_emb'] else None
        return np.concatenate([self.forward(u[i:i + 8192], v[i:i + 8192], F[i:i + 8192], P)[0] for i in range(0, len(u), 8192)])

    def score_fn(self):
        P = self.pool.forward(self.p['E']) if self.cfg['use_emb'] else None

        def fn(nb, vv):
            return self.forward(nb, vv, tok.feature_matrix(TITLES, nb, vv), P)[0]
        return fn


def hop_accuracy(fn, cases):
    hits, base = 0.0, 0.0
    for v, nb, good in cases:
        pred = fn(nb, np.full(len(nb), v))
        hits += good[np.flatnonzero(pred == pred.min())].mean()
        base += good.mean()
    return hits / len(cases), base / len(cases)


def human_agreement(fn, steps, rng, n=1500):
    """Top-1 agreement with the link a real player clicked, among that page's links."""
    idx = rng.choice(len(steps), min(n, len(steps)), replace=False)
    hit, base = 0.0, 0.0
    for p, c, v in steps[idx]:
        nb = ADJ[p]
        pred = fn(nb, np.full(len(nb), v))
        best = nb[np.flatnonzero(pred == pred.min())]
        hit += (best == c).mean()
        base += 1 / len(nb)
    return hit / len(idx), base / len(idx)


def lr_at(s, steps, peak=3e-3, warm=200):
    return peak * min(1.0, s / warm) * (0.5 * (1 + np.cos(np.pi * s / steps)) * 0.9 + 0.1)


def fit(m, steps, data, ev, mode='reg', peak=3e-3, warm=200, log_every=250, name=''):
    """mode: reg (distances), rank (human clicks only), mix (both, summed)."""
    rng = np.random.default_rng(SEED + 100)
    u, v, d, F = data['train']
    hc = data['human_train']
    curve, ema, t0 = [], None, time.time()
    for s in range(1, steps + 1):
        lr = lr_at(s, steps, peak, warm)
        loss, g = 0.0, None
        if mode in ('reg', 'mix'):
            i = rng.integers(0, len(d), BATCH)
            l1, g = m.reg_grads(u[i], v[i], d[i], F[i])
            loss += l1
        if mode in ('rank', 'mix'):
            j = hc[rng.integers(0, len(hc), RANK_BATCH)]
            neg = np.array([nb[rng.integers(len(nb))] for nb in (ADJ[p] for p in j[:, 0])])
            keep = neg != j[:, 1]
            l2, g2 = m.rank_grads(j[keep, 1], j[keep, 2], neg[keep])
            loss += l2
            g = g2 if g is None else {k: g[k] + g2[k] for k in g}
        m.apply(g, lr)
        ema = loss if ema is None else 0.98 * ema + 0.02 * loss
        if s % log_every == 0 or s == steps:
            vu, vv, vd, vF = data['val']
            k = slice(0, 10000)
            mae = float(np.abs(m.predict(vu[k], vv[k], vF[k]) - vd[k]).mean())
            hop = hop_accuracy(m.score_fn(), ev['hop_val_small'])[0]
            curve.append({'step': s, 'train_loss': round(ema, 4), 'val_mae': round(mae, 4), 'val_hop': round(hop, 4), 'secs': round(time.time() - t0, 1)})
            print(f'  {name} step {s} loss {ema:.4f} val_mae {mae:.4f} val_hop {hop:.4f} {time.time() - t0:.0f}s', flush=True)
    return curve, round(time.time() - t0, 1)


def evaluate(m, data, ev):
    out = {}
    for split in ('val', 'test'):
        u, v, d, F = data[split]
        y = m.predict(u, v, F)
        err = y - d
        fn = m.score_fn()
        hop, rnd = hop_accuracy(fn, ev['hop_' + split])
        agree, agree_rnd = human_agreement(fn, data['human_' + split], np.random.default_rng(SEED + 5))
        out[split] = {'mae': round(float(np.abs(err).mean()), 4), 'mae_predict_3': round(float(np.abs(d - 3).mean()), 4),
                      'pearson': round(float(np.corrcoef(y, d)[0, 1]), 4), 'hop_acc': round(hop, 4), 'hop_random': round(rnd, 4),
                      'human_agree': round(agree, 4), 'human_agree_random': round(agree_rnd, 4)}
    return out


def quantize_rows(E):
    scale = np.abs(E).max(1) / 127.0
    scale[scale == 0] = 1.0
    return np.clip(np.round(E / scale[:, None]), -127, 127).astype(np.int8), scale.astype(np.float32)


def write_tensors(name, tensors, meta):
    info, blobs, off = {}, [], 0
    for k, arr in tensors:
        arr = np.ascontiguousarray(arr)
        pad = (-off) % 4
        if pad:
            blobs.append(b'\0' * pad)
            off += pad
        info[k] = {'offset': off, 'dtype': str(arr.dtype), 'shape': list(arr.shape)}
        blobs.append(arr.tobytes())
        off += arr.nbytes
    with open(os.path.join(OUT, name + '.bin'), 'wb') as f:
        for b in blobs:
            f.write(b)
    with open(os.path.join(OUT, name + '.json'), 'w') as f:
        json.dump(dict(meta, tensors=info, bytes=off), f, indent=1)
    return off


def export_model(name, m, extra):
    qE, sE = quantize_rows(m.p['E'])
    tensors = [('E_q', qE), ('E_scale', sE)] + [(k, m.p[k].astype(np.float32)) for k in ('Ws', 'bs', 'Wt', 'bt', 'W1', 'b1', 'w2', 'b2')]
    meta = dict(m.dims, feats=tok.N_FEATS, hash='fnv1a32', tokens='w:<word> + g:<char trigram of <word>>', id=name, **extra)
    nbytes = write_tensors(name, tensors, meta)
    m.p['E'] = qE.astype(np.float32) * sE[:, None]
    return nbytes


class Semantic:
    """Hashed title tokens -> 24 dims, trained only to tell linked article pairs from random pairs."""

    def __init__(self, rng):
        self.pool = Pool(SEM_BUCKETS)
        self.S = (rng.standard_normal((SEM_BUCKETS, SEM_DIM)) * 0.1).astype(np.float32)
        self.c = np.float32(0.0)
        self.mS, self.vS, self.t = np.zeros_like(self.S), np.zeros_like(self.S), 0

    def train(self, steps, rng):
        pos = EDGES[(SPLIT[EDGES[:, 0]] == 0) & (SPLIT[EDGES[:, 1]] == 0)]
        pool = np.where(SPLIT == 0)[0]
        t0 = time.time()
        for s in range(1, steps + 1):
            k = BATCH // 2
            pi = pos[rng.integers(0, len(pos), k)]
            u = np.concatenate([pi[:, 0], rng.choice(pool, k)])
            v = np.concatenate([pi[:, 1], rng.choice(pool, k)])
            y = np.concatenate([np.ones(k), np.zeros(k)]).astype(np.float32)
            P = self.pool.forward(self.S)
            su, sv = P[u], P[v]
            pr = 1 / (1 + np.exp(-((su * sv).sum(1) + self.c)))
            g = ((pr - y) / len(y)).astype(np.float32)
            gP = np.zeros_like(P)
            np.add.at(gP, u, g[:, None] * sv)
            np.add.at(gP, v, g[:, None] * su)
            gS = self.pool.backward(gP, self.S)
            self.c -= np.float32(0.01 * g.sum())
            self.t += 1
            self.mS = 0.9 * self.mS + 0.1 * gS
            self.vS = 0.999 * self.vS + 0.001 * gS * gS
            self.S -= (3e-3 * (self.mS / (1 - 0.9 ** self.t)) / (np.sqrt(self.vS / (1 - 0.999 ** self.t)) + 1e-8)).astype(np.float32)
        return round(time.time() - t0, 1)

    def score_fn(self):
        P = self.pool.forward(self.S)
        Pn = P / (np.linalg.norm(P, axis=1, keepdims=True) + 1e-8)
        return lambda nb, vv: -(Pn[nb] * Pn[vv]).sum(1)


def main():
    t_all = time.time()
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(SEED)
    t0 = time.time()
    data = {
        'train': sample_pairs(rng, 200_000 if QUICK else 1_200_000, 0),
        'val': sample_pairs(rng, 30_000, 1),
        'test': sample_pairs(rng, 30_000, 2),
        'human_train': human_clicks(0), 'human_val': human_clicks(1), 'human_test': human_clicks(2),
    }
    ev = {'hop_val': hop_cases(rng, 1500, 1), 'hop_test': hop_cases(rng, 1500, 2)}
    ev['hop_val_small'] = ev['hop_val'][:400]
    prep_secs = round(time.time() - t0, 1)
    print(f'data ready in {prep_secs}s, human clicks train/val/test {len(data["human_train"])}/{len(data["human_val"])}/{len(data["human_test"])}', flush=True)

    family = []

    def record(mid, name, m, curve, secs, note, trained_on):
        nbytes = export_model(mid, m, {'name': name})
        res = evaluate(m, data, ev)
        family.append({'id': mid, 'name': name, 'size': m.size, 'params': m.params(), 'sizeBytes': nbytes, 'trainSeconds': secs,
                       'trainedOn': trained_on, 'note': note, 'curve': curve, **res})
        print(mid, json.dumps(res), flush=True)
        return m

    m = Model(np.random.default_rng(SEED), size='tiny')
    curve, secs = fit(m, STEPS, data, ev, name='tiny')
    record('tiny', 'tiny', m, curve, secs, 'distance predictor, 4,096 buckets x 16 dims', '1.2M (link, target) shortest-path pairs')

    base = Model(np.random.default_rng(SEED), size='base')
    curve, secs = fit(base, STEPS, data, ev, name='base')
    import copy
    base_fp = copy.deepcopy(base.p)
    record('base', 'base', base, curve, secs, 'distance predictor, 16,384 buckets x 32 dims', '1.2M (link, target) shortest-path pairs')

    m = Model(np.random.default_rng(SEED), size='base')
    curve, secs = fit(m, STEPS, data, ev, mode='rank', name='imitate')
    record('imitate', 'imitation', m, curve, secs, 'base size, trained only to copy the link real players clicked', f'{len(data["human_train"]):,} real player clicks')

    m = Model(np.random.default_rng(SEED), size='base')
    m.p = copy.deepcopy(base_fp)
    m.reset_opt()
    curve, secs = fit(m, FT_STEPS, data, ev, mode='mix', peak=1e-3, warm=100, name='human')
    base_secs = next(f['trainSeconds'] for f in family if f['id'] == 'base')
    record('human', 'base + human clicks', m, curve, round(secs + base_secs, 1), 'base, then fine-tuned on distances and real player clicks together',
           f'1.2M shortest-path pairs, then {len(data["human_train"]):,} player clicks')

    ablations = []
    for label, cfg in [('full model', {}), ('no char trigrams (whole words only)', {'use_grams': False}), ('no whole words (trigrams only)', {'use_words': False}),
                       ('no hand features (embeddings only)', {'use_feats': False}), ('hand features only (no embeddings)', {'use_emb': False})]:
        a = Model(np.random.default_rng(SEED), size='base', **cfg)
        _, s = fit(a, ABL_STEPS, data, ev, log_every=ABL_STEPS, name=label)
        hop = hop_accuracy(a.score_fn(), ev['hop_val'])[0]
        mae = float(np.abs(a.predict(*data['val'][:2], data['val'][3]) - data['val'][2]).mean())
        ablations.append({'variant': label, 'steps': ABL_STEPS, 'secs': s, 'val_hop_acc': round(hop, 4), 'val_mae': round(mae, 4)})

    word_overlap = hop_accuracy(lambda nb, vv: -tok.feature_matrix(TITLES, nb, vv)[:, 0], ev['hop_val'])[0]
    sem = Semantic(np.random.default_rng(SEED + 1))
    sem_secs = sem.train(300 if QUICK else 3000, np.random.default_rng(SEED + 2))
    qS, sS = quantize_rows(sem.S)
    sem_bytes = write_tensors('semantic', [('S_q', qS), ('S_scale', sS)], {'sem_buckets': SEM_BUCKETS, 'sem_dim': SEM_DIM, 'hash': 'fnv1a32'})
    sem.S = qS.astype(np.float32) * sS[:, None]
    sem_res = {s: round(hop_accuracy(sem.score_fn(), ev['hop_' + s])[0], 4) for s in ('val', 'test')}

    report = {
        'date': time.strftime('%Y-%m-%d'), 'seed': SEED, 'quick': QUICK,
        'machine': f'laptop cpu, numpy {np.__version__}, 2 blas threads, single process',
        'data': {
            'articles': N, 'links': int(len(EDGES)),
            'split_articles': {k: int((SPLIT == i).sum()) for i, k in enumerate(('train', 'val', 'test'))},
            'pairs': {k: int(len(data[k][0])) for k in ('train', 'val', 'test')},
            'human_clicks': {k: int(len(data['human_' + k])) for k in ('train', 'val', 'test')},
            'hop_cases': {k: len(ev['hop_' + k]) for k in ('val', 'test')}, 'prep_secs': prep_secs,
        },
        'architecture': {'tokens': 'whole words + char trigrams, fnv1a hashed', 'sizes': SIZES, 'tower': 'tanh', 'head': '[link, target, link*target, 6 hand features] -> relu -> clicks',
                         'hand_features': ['word jaccard', 'trigram jaccard', 'link word count', 'target inside link', 'link has a number', 'exact match'],
                         'loss': {'distance': 'huber on clicks', 'imitation': 'pairwise logistic: clicked link closer than a random other link on the page'},
                         'optimizer': 'adam, cosine lr', 'batch': BATCH, 'rank_batch': RANK_BATCH, 'steps': STEPS, 'fine_tune_steps': FT_STEPS, 'dropout': DROP, 'weight_decay': WD},
        'family': family,
        'ablations': ablations,
        'baselines_val_hop_acc': {'random link': family[1]['val']['hop_random'], 'word overlap': round(word_overlap, 4), 'semantic embedding': sem_res['val']},
        'semantic': {'buckets': SEM_BUCKETS, 'dim': SEM_DIM, 'bias': float(sem.c), 'sizeBytes': sem_bytes, 'train_secs': sem_secs, 'val_hop_acc': sem_res['val'], 'test_hop_acc': sem_res['test']},
        'total_secs': round(time.time() - t_all, 1),
    }
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    with open(os.path.join(HERE, 'results', 'train.json'), 'w') as f:
        json.dump(report, f, indent=1)
    for fm in family:
        print(fm['id'], fm['params'], fm['sizeBytes'], fm['trainSeconds'], fm['val']['hop_acc'], fm['test']['hop_acc'], fm['test']['human_agree'])
    print('total', report['total_secs'])


if __name__ == '__main__':
    main()
