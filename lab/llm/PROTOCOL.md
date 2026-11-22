# LLM benchmark protocol (prompt v1, frozen 2026-11-22 before the main runs)

## Question

How do current LLMs play How Many Clicks (get from article A to article B by clicking links), what does each solve cost in API dollars, and how do they compare with the lab's classical strategies and the small trained model on the same pair set?

## Prior work

- LLM-WikiRace (Ziomek, Bankes, Wolf, Ramesh, Tang, Bogunovic; arXiv 2602.16902, 2026). 549,232-page Wikipedia graph (largest SCC, June 2025 snapshot). Models see the current title, target, visited history and up to 50 numbered links (titles only, no article text); pages with more than 50 links are cut to the 50 closest to the target by true distance, shown in random order. 30-step cap. Easy/medium/hard = shortest path 3-4 / 5-6 / 7-8. Best model about 29% on hard (Gemini 3.1; Gemini 3 about 23%). Main failure is looping. Code: https://github.com/JuliuszZiomek/LLM-WikiRace-Benchmark
- WikiRacing Language Models, Hugging Face Space HuggingFaceTB/wikiracing-llms (play against open models, parallel eval harness).
- Margiotta, Croce, Basili. Evaluating Large Language Models on Wikipedia Graph Navigation: Insights from the WikiGame. CLiC-it 2025, CEUR-WS Vol-4112.

This run is not a new benchmark idea. What it adds: the same Wikispeedia pairs the lab uses for classical search and the home-trained model, and measured dollars per game and per solve.

## How this differs from LLM-WikiRace

- Graph: Wikispeedia (4,604 articles, 119,882 links, 2007 Wikipedia for Schools subset), not 549k pages. Paths are short: easy = 2 clicks (3 pairs of 1), medium = 3, hard = 4+ (mostly 4).
- Full link list every step (median 19, max 294 links). No 50-link cap and no distance-based pre-filtering, so the model gets no hidden hint about which links are close.
- Answer by tool call with the link title, not a number. Invalid answer: re-ask once, then the game fails.
- Stateless per step: each call carries target, current page, path so far and the link list; no chat history.
- 15-step cap (see below), not 30.

## Environment

- Data: `../data/graph.json` (titles + forward adjacency, built by `../prep.py` from the SNAP Wikispeedia dump). Offline, no live Wikipedia.
- Each step the model sees exactly: target title, current title, path so far (titles joined by ` > `), and the outgoing link titles of the current page in graph order (alphabetical). No article text.
- It must call `click_link(link: string)`. The answer must match a listed title exactly (surrounding whitespace/quotes stripped; case-insensitive exact match accepted). Anything else is an invalid move: the same step is re-asked once with a note that the answer was not on the page; a second invalid answer fails the game (`failReason: invalid_move`).
- No backtracking action (the model can click a link back to a previous page if one exists). Revisits are allowed and counted.
- Win: arriving on the target. The environment never auto-clicks the target.
- Step limit: 15 clicks for every difficulty. Justification: the lab's classical strategies get 100-200 opened pages, so a tight cap (2x human median = 6/8/12) would penalise the LLM walker for a budget choice rather than skill; 15 is 3.75x-7.5x the optimal path here, similar in ratio to LLM-WikiRace's 30 for 4-8 click paths, and leaves room to observe loops and recovery. Clicks over optimal is reported on solved games so the cap does not inflate path length.

## Prompt (verbatim, same for every model)

System:

```
You are playing the Wikipedia link game. You start on one Wikipedia article and must reach the target article by clicking links. Each turn you see the current article's title and the titles of the links on it, nothing else. Choose exactly one link from the list by calling the click_link tool with the link title copied exactly. You win when you arrive on the target article. Try to use as few clicks as possible.
```

Tool `click_link`, description: `Click one link on the current page. The title must be copied exactly from the list of links.` Parameter `link` (string).

User message per step (example):

```
Target article: Cancer
Current article: Alcohol
Path so far: Alcohol
Links on this page (3):
- Beer
- Cancer
- Wine
```

Re-ask note appended after an invalid answer: `"<answer>" is not one of the links on this page. Pick exactly one title from the list above.`

## Pairs

- Source: the lab's test pairs (`../data/pairs.json` key `test`, 150 per difficulty, start and target both from held-out articles), the same 450 pairs behind `benchmark.json`.
- Sample: seeded stratified subset, `random.Random(20261122)`, 20 per difficulty, 60 pairs. Same 60 for every model (`game.sample_pairs`).
- Pilot: the first 2 easy, 2 medium, 1 hard of that sample, for every model, before any main run. Pilot games are part of the 60 and are not re-run.
- Difficulty = true shortest path: easy <= 2, medium 3, hard 4+ (lab definition).

## Models and settings

Model ids checked against each provider's live model list on 2026-11-22; prices from the live pricing pages that day (USD per 1M tokens, standard tier, no caching, no batch).

| key | provider | API model | in | out | settings |
|---|---|---|---|---|---|
| claude-haiku-5-5 | Anthropic | claude-haiku-5-5 | 0.10 | 0.50 | no thinking |
| claude-sonnet-5-5 | Anthropic | claude-sonnet-5-5 | 2.00 | 10.00 | no thinking |
| claude-opus-5-5 | Anthropic | claude-opus-5-5 | 4.00 | 20.00 | no thinking |
| claude-sonnet-5-5-thinking | Anthropic | claude-sonnet-5-5 | 2.00 | 10.00 | adaptive thinking, effort xhigh |
| gpt-6-luna | OpenAI | gpt-6-luna | 0.10 | 0.50 | reasoning effort none |
| gpt-6.2-sol | OpenAI | gpt-6.2-sol | 2.00 | 10.00 | reasoning effort low (lowest allowed) |
| gpt-6.2-astra | OpenAI | gpt-6.2-astra | 8.00 | 40.00 | reasoning effort low (lowest allowed) |
| gpt-6.2-sol-high | OpenAI | gpt-6.2-sol | 2.00 | 10.00 | reasoning effort high |
| gemini-3.5-flash-lite | Google | gemini-3.5-flash-lite | 0.30 | 2.50 | thinking minimal |
| gemini-3.8-flash | Google | gemini-3.8-flash | 0.75 | 3.75 | thinking low (lowest allowed) |
| gemini-4-carbon | Google | gemini-4-carbon | 2.00 | 10.00 | thinking low (lowest allowed) |

Default rung = the least reasoning each model allows. Reasoning-on variants of the mid tier (Sonnet xhigh, Sol high) test the planning-gap claim. Temperature 0 is sent where accepted: Gemini and Luna accept it; Claude 5.5 (the current SDK no longer takes the parameter) and OpenAI reasoning models (Sol, Astra) do not, so they run at provider default. Tool choice is forced to `click_link` for OpenAI and Gemini; Claude 5.5 rejects forced tool choice, so Claude runs with `tool_choice: auto` and a missing tool call counts as an invalid answer.

SDKs: `anthropic` (Messages API), `openai` (Responses API for OpenAI; Chat Completions against Google's OpenAI-compatible endpoint for Gemini). Max 4 concurrent requests.

## Metrics (per model, overall and per difficulty)

success rate (bootstrap 95% CI, 2000 resamples, seed 20261122); clicks on solved games; clicks over optimal on solved games (bootstrap CI); steps taken; invalid-move rate (invalid answers / all calls); mean input and output tokens per game (output includes reasoning/thinking tokens); cost per game = tokens x published price; cost per solved game = total cost / games solved; median latency per call; loop rate (games with any revisit). n is 20 per difficulty, so per-difficulty CIs are wide and stated as such.

## References

Classical strategies, the trained model and human medians are read from `~/Desktop/rg-portfolio/src/data/clicks/benchmark.json`, not recomputed. Per-pair reference results are not saved there, so they are reported as "reference on full set (450 pairs)". Human stats are additionally computed on our 60-pair subset from `pairs.json` (Wikispeedia finished/unfinished paths). The classical strategies and trained model are budgeted search (pages opened, with backtracking); the LLMs walk one click at a time. Their API cost is zero; they run on the reader's machine.

## Budget

Hard cap 20 USD across providers. `spend.json` logs every batch (estimate from pilot cost per game by difficulty, actual from token counts x price). The runner refuses a batch whose estimate exceeds the remaining budget minus 0.75 USD and stops dispatching games when spend plus in-flight reserve would cross it.

## Files

`game.py` environment + model callers, `run.py` batches and ledger, `analyze.py` stats, `raw/<model>/<pair>.json` full traces (pages, links offered count, raw answer, chosen link, tokens, latency per call), `spend.json` ledger, `results.json` copy of the site output. Keys come only from the environment at run time (`env.sh`); nothing in this folder holds a key.

## Amendment 1 (2026-11-22, after the 60-pair run, before the extension)

The 60-pair run cost 7.13 USD (7.75 USD total with pilots and probes), leaving room under the cap. To tighten the CIs without changing anything else, 10 more pairs per difficulty are added: drawn with `random.Random(20261123)` from the test pairs not already chosen, same difficulty buckets, same prompt v1, same models and settings. Final set: 90 pairs, 30 per difficulty. Pre-run estimate for the extension: 9.82 USD (conservative: max of mean and 0.75 x max pilot/main cost per game by difficulty). The decision to extend was made after seeing the 60-pair results; nothing about the protocol or analysis was changed because of them.
