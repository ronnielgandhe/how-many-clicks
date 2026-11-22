import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { registerHooks } from 'node:module';

export const SITE = process.env.SITE_DIR || join(dirname(fileURLToPath(import.meta.url)), '../../../../rg-portfolio');
const BUILD = join(dirname(fileURLToPath(import.meta.url)), '../build');

// The game page's pathfinder.ts runs untouched; only its `./wiki` import is pointed at a graph-backed stub,
// and the stub forwards to whatever Wiki the current run passed in (globalThis.__wiki).
mkdirSync(BUILD, { recursive: true });
writeFileSync(join(BUILD, 'wikiStub.ts'), `
export class WikiError extends Error {}
const w = () => (globalThis as any).__wiki;
export const resolveTitle = async (q: string, signal?: AbortSignal) => w().resolve(q, signal);
export const getPageLinks = async (t: string, signal?: AbortSignal) => w().links(t, signal);
`);
const STUB = pathToFileURL(join(BUILD, 'wikiStub.ts')).href;
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === './wiki' && ctx.parentURL?.endsWith('/clicks/pathfinder.ts')) return { url: STUB, shortCircuit: true };
    return next(spec, ctx);
  },
});
export const useWiki = (w) => { globalThis.__wiki = w; };

export const strategies = await import(join(SITE, 'src/tools/clicks/strategies/index.ts'));
export const modelLib = await import(join(SITE, 'src/tools/clicks/strategies/model.ts'));
export const pathfinder = await import(join(SITE, 'src/tools/clicks/pathfinder.ts'));

export const MODEL_IDS = ['tiny', 'base', 'imitate', 'human'];

const readPair = (name) => {
  const meta = JSON.parse(readFileSync(join(SITE, `public/clicks-model/${name}.json`), 'utf8'));
  const bin = readFileSync(join(SITE, `public/clicks-model/${name}.bin`));
  return [meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)];
};

export function loadSiteModel() {
  const out = {};
  for (const id of MODEL_IDS) {
    out[id] = modelLib.buildModel(...readPair(id));
    modelLib.setModel(id, out[id]);
  }
  modelLib.setSemantic(modelLib.buildSemantic(...readPair('semantic')));
  return out;
}
