# HOW MANY CLICKS? 🖱️

**The Wikipedia Connection Game** — how many links does it take to get from one Wikipedia article to another?

Saw a TikTok about the Wikipedia game and thought... what if I made a machine try it first, then challenged you to beat it?

## The Game

1. Pick any two Wikipedia articles (e.g., **Batman** → **Bank of England**)
2. Watch the AI think in real-time as it clicks through Wikipedia links trying to connect them
3. See the journey visualized with article snapshots
4. Try to beat the machine yourself by clicking through the links manually

## Features

- **Real-time AI thinking** — watch the algorithm reason through which links to follow, with quirky commentary
- **Two modes** — 🧠 Normal (casual exploration) and ⚡ God Mode (wider beam search, faster)
- **Dual click tracking** — **Prime Clicks** (shortest path found) vs **Total Clicks** (all pages explored, including backtracking)
- **Wikipedia autocomplete** — search suggestions as you type
- **Journey snapshots** — see thumbnails and descriptions for every article along the path
- **Play it yourself** — after the machine finds a path, try to beat it by navigating the links yourself
- **Smart pathfinding** — uses target word matching, related term expansion, hub article detection, and anti-cluster diversity penalties

> *"maybe the fun was the things we saw on the way"*
> — a very wise click-counter

## How It Works

The pathfinder uses a beam search algorithm that:
- Scores Wikipedia links based on word overlap with the target article
- Expands related terms (e.g., "England" → "British", "London", "Kingdom")
- Recognizes hub articles (countries, major cities) that bridge different topic domains
- Penalizes staying in the same topic cluster to force diverse exploration
- Never gives up — keeps searching until it finds a path

## Tech Stack

- React + Vite
- Wikipedia MediaWiki API (no backend needed — runs entirely in the browser)
- Pure CSS animations (confetti, typing indicators, card transitions)

## Run It

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` and start connecting!

## Fun Paths to Try

- 🦇 Batman → 🏦 Bank of England
- 🍕 Pizza → 🚀 NASA
- 🎸 Taylor Swift → ⚛️ Quantum mechanics
- 🐕 Dog → 🗼 Eiffel Tower
- 🎮 Minecraft → 🏛️ Ancient Rome

---

Built for fun after seeing the Wikipedia game on TikTok. No AI APIs needed — just pure algorithmic vibes and the Wikipedia API.
