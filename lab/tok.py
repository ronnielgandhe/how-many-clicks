"""Title tokenizer + pair features. Must match src/tools/clicks/strategies/model.ts byte for byte."""
import re
import unicodedata

import numpy as np

SPLIT = re.compile(r'[^a-z0-9]+')
MARKS = re.compile('[̀-ͯ]')
N_FEATS = 6


def words(title):
    t = MARKS.sub('', unicodedata.normalize('NFKD', title.replace('_', ' '))).lower()
    return [w for w in SPLIT.split(t) if w]


def trigrams(ws):
    out = []
    for w in ws:
        p = '<' + w + '>'
        out.extend(p[i:i + 3] for i in range(len(p) - 2))
    return out


def fnv(s):
    h = 0x811C9DC5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def tokens(title, use_words=True, use_grams=True):
    ws = words(title)
    out = []
    if use_words:
        out += ['w:' + w for w in ws]
    if use_grams:
        out += ['g:' + g for g in trigrams(ws)]
    return out or ['w:']


def token_ids(title, buckets, **kw):
    return [fnv(t) & (buckets - 1) for t in tokens(title, **kw)]


def jacc(a, b):
    a, b = set(a), set(b)
    return len(a & b) / len(a | b) if a and b else 0.0


def pair_features(u, v):
    wu, wv = words(u), words(v)
    nu, nv = ' '.join(wu), ' '.join(wv)
    return [
        jacc(wu, wv),
        jacc(trigrams(wu), trigrams(wv)),
        min(len(wu), 10) / 5.0,
        1.0 if nv and nv in nu else 0.0,
        1.0 if any(w.isdigit() for w in wu) else 0.0,
        1.0 if nu == nv else 0.0,
    ]


def feature_matrix(titles, us, vs):
    return np.array([pair_features(titles[u], titles[v]) for u, v in zip(us, vs)], dtype=np.float32)
