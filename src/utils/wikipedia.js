const API_BASE = 'https://en.wikipedia.org/w/api.php';
const REST_BASE = 'https://en.wikipedia.org/api/rest_v1';

export async function searchArticles(query) {
  if (!query || query.length < 2) return [];
  const params = new URLSearchParams({
    action: 'opensearch',
    search: query,
    limit: '5',
    format: 'json',
    origin: '*',
  });
  const res = await fetch(`${API_BASE}?${params}`);
  const data = await res.json();
  return data[1] || [];
}

export async function resolveTitle(query) {
  const params = new URLSearchParams({
    action: 'query',
    titles: query,
    redirects: '1',
    format: 'json',
    origin: '*',
  });
  const res = await fetch(`${API_BASE}?${params}`);
  const data = await res.json();
  const pages = data.query.pages;
  const pageId = Object.keys(pages)[0];
  if (pageId === '-1') {
    // Try search instead
    const results = await searchArticles(query);
    if (results.length === 0) throw new Error(`No Wikipedia article found for "${query}"`);
    return results[0];
  }
  return pages[pageId].title;
}

export async function getPageLinks(title) {
  const allLinks = [];
  let plcontinue = null;

  // Fetch up to 2 batches (1000 links max) to keep it fast
  for (let i = 0; i < 2; i++) {
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'links',
      pllimit: 'max',
      plnamespace: '0',
      format: 'json',
      origin: '*',
    });
    if (plcontinue) params.set('plcontinue', plcontinue);

    const res = await fetch(`${API_BASE}?${params}`);
    const data = await res.json();

    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];
    if (pages[pageId].links) {
      allLinks.push(...pages[pageId].links.map((l) => l.title));
    }

    plcontinue = data.continue?.plcontinue;
    if (!plcontinue) break;
  }

  return allLinks;
}

export async function getPageSummary(title) {
  try {
    const res = await fetch(
      `${REST_BASE}/page/summary/${encodeURIComponent(title)}`
    );
    if (!res.ok) return { title, extract: '', thumbnail: null, description: '' };
    const data = await res.json();
    return {
      title: data.title,
      extract: data.extract || '',
      thumbnail: data.thumbnail?.source || null,
      description: data.description || '',
      url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch {
    return { title, extract: '', thumbnail: null, description: '', url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
  }
}
