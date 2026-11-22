import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from './site.mjs';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOP = 'next-click accuracy on unseen targets (top-scored link is on a shortest path)';
const read = (f) => (existsSync(join(LAB, f)) ? JSON.parse(readFileSync(join(LAB, f), 'utf8')) : null);
const pick = (s) => ({ success: s.success, clicksMean: s.clicksMean, optimalMean: s.optimalMean, clicksOverOptimal: s.clicksOverOptimal,
  pagesOpenedMean: s.pagesOpenedMean, pagesOpenedMedian: s.pagesOpenedMedian, optimalRate: s.optimalRate, n: s.n });

export function publish({ preliminary }) {
  const bench = read('results/bench-test.json');
  const live = read('results/live.json');
  const train = read('results/train.json');
  const tune = read('results/tune.json');
  const godId = tune?.chosen?.god;
  const god = train && train.family.find((f) => f.id === godId);
  const diffs = ['easy', 'medium', 'hard'];
  const out = {
    preliminary: preliminary || !train || train.quick || !tune,
    defaultStrategy: 'guided',
    generated: new Date().toISOString().slice(0, 10),
    dataset: {
      name: 'Wikispeedia navigation paths (Stanford SNAP)',
      url: 'https://snap.stanford.edu/data/wikispeedia.html',
      license: 'SNAP research dataset, cite West & Leskovec (WWW 2012) and West, Pineau & Precup (IJCAI 2009); article content is Wikipedia, CC BY-SA',
      citations: [
        'Robert West and Jure Leskovec. Human Wayfinding in Information Networks. WWW 2012.',
        'Robert West, Joelle Pineau and Doina Precup. Wikispeedia: An Online Game for Inferring Semantic Distances between Concepts. IJCAI 2009.',
      ],
      articles: 4604, links: 119882, humanPaths: 51318,
      pairs: bench.pairs, pairCounts: bench.pairCounts, seed: bench.seed, date: bench.date,
      pairRule: 'start and target both from the 15% of articles held out of model training; difficulty = true shortest path (easy 2, medium 3, hard 4+); about half of each bucket are pairs real people played',
    },
    difficulties: diffs,
    humans: Object.fromEntries([...diffs, 'all'].map((d) => [d, { medianClicks: bench.humans[d].medianClicks, clicksMean: bench.humans[d].clicksMean,
      optimalMean: bench.humans[d].optimalMean, clicksOverOptimal: bench.humans[d].clicksOverOptimal, pagesMedian: bench.humans[d].pagesMedian,
      success: bench.humans[d].success, n: bench.humans[d].n, games: bench.humans[d].games }])),
    strategies: bench.strategies.map((s) => ({
      id: s.id, name: s.name, budget: s.budget, variant: !!s.variant, overall: pick(s.overall),
      byDifficulty: Object.fromEntries(diffs.map((d) => [d, pick(s.byDifficulty[d])])),
      vsHumans: s.vsHumans, msMean: s.overall.msMean,
    })),
    live: live && {
      date: live.date, partial: !!live.partial, pairs: live.pairs.length, pairList: live.pairs.map((p) => [p.start, p.target]),
      note: live.note || 'live en.wikipedia.org, links capped at 1,000 per page like the game; no ground truth, so bestKnown = shortest path any strategy found',
      strategies: live.strategies.map((s) => ({ id: s.id, success: s.success, clicksMean: s.clicksMean, pagesOpenedMean: s.pagesOpenedMean, overBestKnown: s.overBestKnown })),
    },
    model: god && {
      id: god.id, name: god.name, params: god.params, sizeBytes: god.sizeBytes, trainSeconds: god.trainSeconds, totalSeconds: train.total_secs,
      trainPairs: train.data.pairs.train, valPairs: train.data.pairs.val, testPairs: train.data.pairs.test,
      humanClicks: train.data.human_clicks, articles: train.data.split_articles, trainedOn: god.trainedOn,
      testMetric: { name: HOP, value: god.test.hop_acc },
      metrics: { val: god.val, test: god.test },
      baselines: { ...train.baselines_val_hop_acc, model: god.val.hop_acc },
      semantic: { testHopAcc: train.semantic.test_hop_acc, trainSeconds: train.semantic.train_secs, sizeBytes: train.semantic.sizeBytes },
      architecture: train.architecture,
      lossCurve: god.curve.map((c) => ({ epoch: Math.round((c.step * train.architecture.batch / train.data.pairs.train) * 100) / 100, step: c.step, train: c.train_loss, val: c.val_mae, valHop: c.val_hop })),
      lossCurveNote: 'train = training loss (ema), val = mean absolute error in clicks on pairs of unseen articles, valHop = next-click accuracy on unseen targets',
      ablations: train.ablations.filter((a) => a.variant !== 'full model').map((a) => ({
        name: a.variant, metricDelta: Math.round((a.val_hop_acc - train.ablations[0].val_hop_acc) * 1000) / 1000, hopAcc: a.val_hop_acc, mae: a.val_mae })),
      ablationMetric: 'change in next-click accuracy on the validation split vs the full base model at the same step count',
      tuned: tune && tune.chosen,
    },
    models: train && train.family.map((f) => ({
      id: f.id, name: f.name, size: f.size, params: f.params, sizeBytes: f.sizeBytes, trainSeconds: f.trainSeconds, trainedOn: f.trainedOn,
      testMetric: { name: HOP, value: f.test.hop_acc }, humanAgreement: f.test.human_agree, humanAgreementRandom: f.test.human_agree_random,
      valHopAcc: f.val.hop_acc, testMae: f.test.mae, note: f.note, shipped: !!god && f.id === god.id, shippedIn: [tune?.chosen?.guided?.id === f.id && 'guided', tune?.chosen?.model?.id === f.id && 'model'].filter(Boolean),
      strategies: { greedy: `model-${f.id}`, bothEnds: `guided-${f.id}` },
    })),
  };
  writeFileSync(join(SITE, 'src/data/clicks/benchmark.json'), JSON.stringify(out, null, 1));
  console.log('wrote benchmark.json preliminary=' + out.preliminary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) publish({ preliminary: process.argv.includes('--preliminary') });
