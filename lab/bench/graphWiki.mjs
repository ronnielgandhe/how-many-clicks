export function graphWiki(titles, adj) {
  const idx = new Map(titles.map((t, i) => [t.toLowerCase(), i]));
  const rev = titles.map(() => []);
  adj.forEach((out, a) => out.forEach((b) => rev[b].push(a)));
  const find = (t) => {
    const i = idx.get(t.toLowerCase());
    if (i === undefined) throw Object.assign(new Error(`no article ${t}`), { name: 'WikiMissing' });
    return i;
  };
  const stats = { links: 0, backlinks: 0 };
  return {
    stats,
    resolve: async (q) => ({ title: titles[find(q)], disambiguation: false }),
    links: async (t) => { stats.links++; return adj[find(t)].map((i) => titles[i]); },
    backlinks: async (t) => { stats.backlinks++; return rev[find(t)].map((i) => titles[i]); },
    hasEdge: (a, b) => adj[find(a)].includes(find(b)),
  };
}
