import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, loadSiteModel, MODEL_IDS } from './site.mjs';
import { runOne, stats } from './run.mjs';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..');
const pairs = JSON.parse(readFileSync(join(LAB, 'data/pairs.json'), 'utf8')).tune;
const { learnedRun, guidedRun } = await import(join(SITE, 'src/tools/clicks/strategies/learned.ts'));
loadSiteModel();

const objective = (s) => Math.round((s.success * 100 - (s.clicksOverOptimal ?? 9) * 10 - s.pagesOpenedMean * 0.2) * 100) / 100;
async function evalRun(run) { const rows = []; for (const p of pairs) rows.push(await runOne(run, 200, p)); return stats(rows); }
const best = (a) => a.reduce((x, y) => (y.objective > x.objective ? y : x));

const family = [];
for (const id of MODEL_IDS) {
  const g = await evalRun(guidedRun(id, 10)), m = await evalRun(learnedRun(id, 8, 10));
  family.push({ id, guided: g, greedy: m, guidedObjective: objective(g), greedyObjective: objective(m) });
  console.log(id, objective(g), objective(m));
}
const pickBy = (k) => family.reduce((x, y) => (y[k] > x[k] ? y : x)).id;
const greedyId = pickBy('greedyObjective'), guidedId = pickBy('guidedObjective');

const grid = { model: [], guided: [] };
for (const beam of [8, 20]) for (const depthCost of [0, 5, 10, 20]) {
  const s = await evalRun(learnedRun(greedyId, beam, depthCost));
  grid.model.push({ beam, depthCost, ...s, objective: objective(s) });
}
for (const depthCost of [0, 5, 10, 20, 40]) {
  const s = await evalRun(guidedRun(guidedId, depthCost));
  grid.guided.push({ depthCost, ...s, objective: objective(s) });
}
const m = best(grid.model), g = best(grid.guided);
const chosen = { god: guidedId, model: { id: greedyId, beam: m.beam, depthCost: m.depthCost }, guided: { id: guidedId, depthCost: g.depthCost } };
writeFileSync(join(LAB, 'results/tune.json'), JSON.stringify({ pairs: pairs.length, objective: 'success*100 - extraClicks*10 - pages*0.2', family, grid, chosen }, null, 1));
writeFileSync(join(SITE, 'src/tools/clicks/strategies/tuned.ts'), `export const TUNED = {\n  model: { id: '${greedyId}', beam: ${m.beam}, depthCost: ${m.depthCost} },\n  guided: { id: '${guidedId}', depthCost: ${g.depthCost} },\n};\n`);
console.log('chosen', JSON.stringify(chosen));
