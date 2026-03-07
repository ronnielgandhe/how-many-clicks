import { getPageLinks, resolveTitle } from './wikipedia';

const STOP_WORDS = new Set([
  'the', 'of', 'and', 'in', 'a', 'an', 'to', 'for', 'is', 'on', 'at', 'by',
  'with', 'from', 'as', 'or', 'its', 'list', 'also', 'was', 'are', 'be', 'has',
  'been', 'were', 'it', 'this', 'that', 'not', 'but', 'they', 'have', 'had',
]);

function normalize(title) {
  return title.toLowerCase().replace(/_/g, ' ').trim();
}

function extractWords(text) {
  return normalize(text)
    .split(/[\s\-_,():.!?]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

// Build a map of related terms for the target
function buildRelatedTerms(targetWords) {
  const related = new Map(); // word -> bonus score

  const RELATIONSHIPS = {
    bank: ['finance', 'financial', 'banking', 'money', 'currency', 'economy', 'economic', 'central', 'monetary'],
    england: ['english', 'british', 'britain', 'london', 'uk', 'kingdom', 'united', 'anglo'],
    united: ['kingdom', 'states', 'nations'],
    kingdom: ['united', 'england', 'britain', 'british', 'monarchy', 'royal'],
    america: ['american', 'united', 'states', 'usa', 'us'],
    states: ['united', 'america', 'american', 'federal'],
    japan: ['japanese', 'tokyo'],
    china: ['chinese', 'beijing'],
    france: ['french', 'paris'],
    germany: ['german', 'berlin'],
    london: ['england', 'english', 'british', 'britain', 'thames', 'uk', 'united'],
    science: ['scientific', 'scientist', 'research'],
    music: ['musical', 'musician', 'song', 'album'],
    war: ['military', 'army', 'battle', 'soldier'],
    film: ['movie', 'cinema', 'actor', 'director'],
    computer: ['computing', 'software', 'technology', 'digital'],
    city: ['urban', 'metropolitan', 'town'],
    history: ['historical', 'ancient', 'medieval'],
    politics: ['political', 'government', 'parliament', 'minister'],
    sport: ['sports', 'athletic', 'player', 'team'],
    europe: ['european', 'eu'],
    africa: ['african'],
    asia: ['asian'],
  };

  for (const tw of targetWords) {
    related.set(tw, 25);
    if (RELATIONSHIPS[tw]) {
      for (const r of RELATIONSHIPS[tw]) {
        related.set(r, 15);
      }
    }
    // Also check if any relationship key is a substring match
    for (const [key, vals] of Object.entries(RELATIONSHIPS)) {
      if (key.includes(tw) || tw.includes(key)) {
        related.set(key, 12);
        for (const v of vals) related.set(v, 10);
      }
    }
  }

  return related;
}

// Common hub articles that bridge between domains on Wikipedia
const HUB_ARTICLES = new Set([
  'united states', 'united kingdom', 'england', 'london', 'france', 'germany',
  'japan', 'china', 'india', 'canada', 'australia', 'russia', 'italy', 'spain',
  'brazil', 'new york city', 'california', 'europe', 'asia', 'africa',
  'world war ii', 'world war i', 'english language', 'latin', 'greek',
  'film', 'television', 'music', 'internet', 'science', 'mathematics',
  'philosophy', 'history', 'geography', 'economics', 'politics',
  'christianity', 'islam', 'university', 'population', 'government',
]);

function scoreSimilarity(linkTitle, targetTitle, relatedTerms, pathSoFar) {
  const link = normalize(linkTitle);
  const target = normalize(targetTitle);

  if (link === target) return 10000;

  const linkWords = extractWords(linkTitle);
  const targetWords = extractWords(targetTitle);

  let score = 0;

  // === DIRECT CONTAINMENT ===
  if (link.includes(target)) score += 200;
  if (target.includes(link) && link.length > 3) score += 100;

  // === TARGET WORD MATCHES (most important) ===
  let wordMatches = 0;
  for (const tw of targetWords) {
    for (const lw of linkWords) {
      if (lw === tw) {
        score += 30;
        wordMatches++;
        break;
      } else if (tw.length > 3 && lw.length > 3 && (lw.includes(tw) || tw.includes(lw))) {
        score += 10;
        break;
      }
    }
  }
  if (wordMatches >= 2) score += 40;

  // === RELATED TERMS MATCHES ===
  for (const lw of linkWords) {
    const bonus = relatedTerms.get(lw);
    if (bonus) score += bonus;
  }

  // === HUB ARTICLE BONUS ===
  // Known hub articles are great for bridging between distant topics
  if (HUB_ARTICLES.has(link)) {
    score += 15;
  }

  // === GENERALITY BONUS (only as tiebreaker when already relevant) ===
  const wordCount = linkWords.length;
  if (score > 0) {
    // Prefer shorter/broader titles among relevant results
    if (wordCount <= 2) score += 3;
    if (wordCount === 1) score += 2;
  }
  // Always penalize very long niche article titles
  if (wordCount > 5) score -= 5;
  if (wordCount > 8) score -= 12;

  // === DIVERSITY PENALTY (anti-cluster) ===
  if (pathSoFar && pathSoFar.length > 1) {
    const pathWords = new Set();
    for (const p of pathSoFar) {
      for (const w of extractWords(p)) {
        pathWords.add(w);
      }
    }
    // Remove target/related words so we don't penalize useful matches
    for (const tw of targetWords) pathWords.delete(tw);
    for (const [rw] of relatedTerms) pathWords.delete(rw);

    let pathOverlap = 0;
    for (const lw of linkWords) {
      if (pathWords.has(lw)) pathOverlap++;
    }
    // Very strong penalty for staying in the same cluster
    if (pathOverlap > 0) score -= pathOverlap * 8;
  }

  return score;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const THINKING = {
  visit: (page) => {
    const m = [
      `Let me check out "${page}"...`,
      `Exploring "${page}" now...`,
      `Diving into "${page}"...`,
      `What's on "${page}"?`,
      `Opening "${page}"...`,
    ];
    return m[Math.floor(Math.random() * m.length)];
  },
  links: (n) => {
    if (n > 300) return `Whoa, ${n} links! That's a LOT of doors to check...`;
    if (n > 100) return `${n} links to sift through. Scanning for the best ones...`;
    return `${n} links here. Let me find the good ones...`;
  },
  hot: (t) => {
    const m = [
      `"${t}" - this looks REALLY promising!`,
      `Ooh, "${t}" could be our ticket!`,
      `"${t}" - I like where this is going!`,
      `"${t}" smells like progress!`,
    ];
    return m[Math.floor(Math.random() * m.length)];
  },
  warm: (t) => {
    const m = [
      `"${t}" - maybe...`,
      `"${t}" - could work, could be a dead end...`,
      `Hmm, "${t}" is interesting...`,
    ];
    return m[Math.floor(Math.random() * m.length)];
  },
  cold: (t) => {
    const m = [
      `"${t}" - nah, too far off`,
      `"${t}" - doesn't feel right`,
      `Skipping "${t}"...`,
    ];
    return m[Math.floor(Math.random() * m.length)];
  },
  click: (t) => {
    const m = [
      `Clicking "${t}"! Let's go!`,
      `"${t}" it is! *click*`,
      `Going with "${t}"!`,
      `"${t}" - let's see where this leads!`,
    ];
    return m[Math.floor(Math.random() * m.length)];
  },
  stuck: () => {
    const m = [
      "Hmm, nothing great here. Let me try a different angle...",
      "Dead end vibes. Backtracking to find a better route...",
      "This cluster isn't leading anywhere. Time to branch out!",
      "Let me think differently about this...",
    ];
    return m[Math.floor(Math.random() * m.length)];
  },
};

export async function findPath(startQuery, targetQuery, mode, onStep) {
  let startTitle, targetTitle;
  try {
    onStep({ type: 'status', message: `Looking up "${startQuery}" on Wikipedia...` });
    startTitle = await resolveTitle(startQuery);
    onStep({ type: 'status', message: `Looking up "${targetQuery}" on Wikipedia...` });
    targetTitle = await resolveTitle(targetQuery);
  } catch (err) {
    onStep({ type: 'error', message: err.message });
    return null;
  }

  onStep({
    type: 'resolved',
    start: startTitle,
    target: targetTitle,
    message: `Mission: "${startTitle}" -> "${targetTitle}". Let's do this!`,
  });

  if (normalize(startTitle) === normalize(targetTitle)) {
    onStep({
      type: 'found',
      path: [startTitle],
      clicks: 0,
      totalExplored: 0,
      message: "Wait... they're the same article! 0 clicks!",
    });
    return { path: [startTitle], totalExplored: 0 };
  }

  // Pre-compute related terms for target
  const targetWords = extractWords(targetTitle);
  const relatedTerms = buildRelatedTerms(targetWords);

  const beamWidth = mode === 'god' ? 20 : 8;
  const thinkDelay = mode === 'god' ? 60 : 200;
  const clickDelay = mode === 'god' ? 100 : 400;
  const maxExplored = mode === 'god' ? 200 : 100; // pages to explore before giving up

  const visited = new Set([normalize(startTitle)]);
  let candidates = [{ title: startTitle, path: [startTitle], score: 0 }];
  let totalExplored = 0;
  let stuckCount = 0;

  while (candidates.length > 0 && totalExplored < maxExplored) {
    totalExplored++;
    const current = candidates.shift();

    onStep({
      type: 'visiting',
      page: current.title,
      path: current.path,
      step: totalExplored,
      totalExplored,
      message: THINKING.visit(current.title),
    });

    await sleep(thinkDelay);

    let links;
    try {
      links = await getPageLinks(current.title);
    } catch {
      onStep({
        type: 'status',
        message: `Couldn't load "${current.title}". Trying another route...`,
      });
      continue;
    }

    onStep({
      type: 'links_found',
      page: current.title,
      count: links.length,
      totalExplored,
      message: THINKING.links(links.length),
    });

    await sleep(thinkDelay);

    // Check if target is directly linked
    const normalizedTarget = normalize(targetTitle);
    const directLink = links.find((l) => normalize(l) === normalizedTarget);
    if (directLink) {
      const finalPath = [...current.path, targetTitle];
      totalExplored++;
      onStep({
        type: 'found',
        path: finalPath,
        clicks: finalPath.length - 1,
        totalExplored,
        message: `FOUND IT! "${targetTitle}" is right here! ${finalPath.length - 1} clicks!`,
      });
      return { path: finalPath, totalExplored };
    }

    // Score all unvisited links
    const scoredLinks = links
      .filter((l) => !visited.has(normalize(l)))
      .map((l) => ({
        title: l,
        score: scoreSimilarity(l, targetTitle, relatedTerms, current.path),
        path: [...current.path, l],
      }))
      .sort((a, b) => b.score - a.score);

    // Detect if we're stuck (all top scores are low)
    const topScore = scoredLinks.length > 0 ? scoredLinks[0].score : 0;
    if (topScore < 3) {
      stuckCount++;
      if (stuckCount > 2) {
        onStep({
          type: 'status',
          totalExplored,
          message: THINKING.stuck(),
        });
        // When stuck, try to find a "hub" article: shortest title (most general)
        const generalLinks = [...scoredLinks]
          .sort((a, b) => {
            const aLen = extractWords(a.title).length;
            const bLen = extractWords(b.title).length;
            return aLen - bLen; // prefer shorter titles
          })
          .slice(0, 3);

        // Inject general links as top candidates
        for (const gl of generalLinks) {
          gl.score += 10; // boost them
        }
        scoredLinks.splice(0, 0, ...generalLinks);
        scoredLinks.sort((a, b) => b.score - a.score);
        stuckCount = 0;
      }
    } else {
      stuckCount = 0;
    }

    // Show top candidates with thinking
    const showCount = Math.min(4, scoredLinks.length);
    for (let i = 0; i < showCount; i++) {
      const c = scoredLinks[i];
      let thinkMsg;
      if (c.score >= 15) {
        thinkMsg = THINKING.hot(c.title);
      } else if (c.score >= 5) {
        thinkMsg = THINKING.warm(c.title);
      } else {
        thinkMsg = THINKING.cold(c.title);
      }
      onStep({
        type: 'considering',
        link: c.title,
        score: c.score,
        totalExplored,
        message: thinkMsg,
      });
      await sleep(thinkDelay);
    }

    // Add best candidates to queue
    const selected = scoredLinks.slice(0, beamWidth);
    for (const link of selected) {
      visited.add(normalize(link.title));
      candidates.push(link);
    }

    // Sort candidates, keep manageable size
    candidates.sort((a, b) => b.score - a.score);
    candidates = candidates.slice(0, beamWidth * 5);

    if (selected.length > 0) {
      onStep({
        type: 'clicking',
        link: selected[0].title,
        path: selected[0].path,
        totalExplored,
        message: THINKING.click(selected[0].title),
      });
      await sleep(clickDelay);
    }
  }

  // Last resort: couldn't find path after max explored
  onStep({
    type: 'not_found',
    totalExplored,
    message: `Explored ${totalExplored} pages but couldn't connect them. These topics live in different Wikipedia galaxies!`,
  });
  return null;
}
