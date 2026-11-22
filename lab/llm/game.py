import json
import os
import random
import threading
import time

import anthropic
import openai

LAB = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
SEED = 20261122
PER_DIFF = 20
EXT_PER_DIFF = 10
MAX_STEPS = 15
PROMPT_VERSION = 'v1'
CAP_USD = 20.0
PRICED_ON = '2026-11-22'
DIFFS = ('easy', 'medium', 'hard')

SYSTEM = (
    "You are playing the Wikipedia link game. You start on one Wikipedia article and must reach the target article "
    "by clicking links. Each turn you see the current article's title and the titles of the links on it, nothing else. "
    "Choose exactly one link from the list by calling the click_link tool with the link title copied exactly. "
    "You win when you arrive on the target article. Try to use as few clicks as possible."
)

TOOL_DESC = "Click one link on the current page. The title must be copied exactly from the list of links."

MODELS = {
    'claude-haiku-5-5': dict(provider='anthropic', name='Claude Haiku 5.5', model='claude-haiku-5-5', pin=0.10, pout=0.50),
    'claude-sonnet-5-5': dict(provider='anthropic', name='Claude Sonnet 5.5', model='claude-sonnet-5-5', pin=2.0, pout=10.0),
    'claude-opus-5-5': dict(provider='anthropic', name='Claude Opus 5.5', model='claude-opus-5-5', pin=4.0, pout=20.0),
    'claude-sonnet-5-5-thinking': dict(provider='anthropic', name='Claude Sonnet 5.5 (thinking, xhigh)', model='claude-sonnet-5-5', pin=2.0, pout=10.0, thinking='xhigh'),
    'gpt-6-luna': dict(provider='openai', name='GPT-6 Luna', model='gpt-6-luna', pin=0.10, pout=0.50, efforts=['none', 'low']),
    'gpt-6.2-sol': dict(provider='openai', name='GPT-6.2 Sol', model='gpt-6.2-sol', pin=2.0, pout=10.0, efforts=['low']),
    'gpt-6.2-astra': dict(provider='openai', name='GPT-6.2 Astra', model='gpt-6.2-astra', pin=8.0, pout=40.0, efforts=['low']),
    'gpt-6.2-sol-high': dict(provider='openai', name='GPT-6.2 Sol (high reasoning)', model='gpt-6.2-sol', pin=2.0, pout=10.0, efforts=['high']),
    'gemini-3.5-flash-lite': dict(provider='google', name='Gemini 3.5 Flash-Lite', model='gemini-3.5-flash-lite', pin=0.30, pout=2.50, efforts=['minimal', 'low']),
    'gemini-3.8-flash': dict(provider='google', name='Gemini 3.8 Flash', model='gemini-3.8-flash', pin=0.75, pout=3.75, efforts=['low']),
    'gemini-4-carbon': dict(provider='google', name='Gemini 4 Carbon', model='gemini-4-carbon', pin=2.0, pout=10.0, efforts=['low']),
}

PRICE_SOURCES = {
    'anthropic': 'https://platform.claude.com/docs/en/about-claude/pricing',
    'openai': 'https://developers.openai.com/api/docs/pricing',
    'google': 'https://aistudio.google.com/docs/pricing',
}


def load_env():
    g = json.load(open(os.path.join(LAB, 'data/graph.json')))
    titles, adj = g['titles'], g['adj']
    idx = {t: i for i, t in enumerate(titles)}
    pairs = json.load(open(os.path.join(LAB, 'data/pairs.json')))
    return titles, adj, idx, pairs


def sample_pairs(pairs):
    rnd = random.Random(SEED)
    out = []
    for d in DIFFS:
        pool = [(i, p) for i, p in enumerate(pairs['test']) if p['difficulty'] == d]
        for i, p in sorted(rnd.sample(pool, PER_DIFF), key=lambda x: x[0]):
            out.append({'id': f'test-{i}', **p})
    rnd = random.Random(SEED + 1)
    taken = {p['id'] for p in out}
    for d in DIFFS:
        pool = [(i, p) for i, p in enumerate(pairs['test']) if p['difficulty'] == d and f'test-{i}' not in taken]
        for i, p in sorted(rnd.sample(pool, EXT_PER_DIFF), key=lambda x: x[0]):
            out.append({'id': f'test-{i}', 'extension': True, **p})
    return out


def pilot_pairs(sample):
    by = {d: [p for p in sample if p['difficulty'] == d] for d in DIFFS}
    return by['easy'][:2] + by['medium'][:2] + by['hard'][:1]


def user_msg(target, current, path, links, note=None):
    lines = [
        f"Target article: {target}",
        f"Current article: {current}",
        f"Path so far: {' > '.join(path)}",
        f"Links on this page ({len(links)}):",
        *[f"- {t}" for t in links],
    ]
    if note:
        lines += ['', note]
    return '\n'.join(lines)


_clients = {}
_lock = threading.Lock()


def client(provider):
    with _lock:
        if provider not in _clients:
            if provider == 'anthropic':
                _clients[provider] = anthropic.Anthropic(max_retries=6)
            elif provider == 'openai':
                _clients[provider] = openai.OpenAI(max_retries=6)
            else:
                _clients[provider] = openai.OpenAI(
                    api_key=os.environ['GOOGLE_API_KEY'],
                    base_url='https://generativelanguage.googleapis.com/v1beta/openai/',
                    max_retries=6,
                )
        return _clients[provider]


class Caller:
    def __init__(self, key):
        self.key = key
        self.m = MODELS[key]
        self.temperature = None if self.m['provider'] == 'anthropic' else 0
        self.effort = (self.m.get('efforts') or [None])[0]
        self.settings_lock = threading.Lock()

    def settings(self):
        return {'temperature': self.temperature, 'reasoning_effort': self.effort, 'thinking': self.m.get('thinking') or False}

    def ask(self, text):
        for _ in range(4):
            try:
                return self._ask(text)
            except (anthropic.BadRequestError, openai.BadRequestError) as e:
                msg = str(e).lower()
                with self.settings_lock:
                    if 'temperature' in msg and self.temperature is not None:
                        self.temperature = None
                        continue
                    efforts = self.m.get('efforts') or []
                    if ('reasoning' in msg or 'effort' in msg or 'thinking' in msg) and self.effort in efforts and efforts.index(self.effort) + 1 < len(efforts):
                        self.effort = efforts[efforts.index(self.effort) + 1]
                        continue
                raise
        raise RuntimeError('settings fallback exhausted')

    def _ask(self, text):
        t0 = time.perf_counter()
        if self.m['provider'] == 'anthropic':
            tool = {'name': 'click_link', 'description': TOOL_DESC,
                    'input_schema': {'type': 'object', 'properties': {'link': {'type': 'string'}}, 'required': ['link']}}
            kw = dict(model=self.m['model'], system=SYSTEM, tools=[tool], messages=[{'role': 'user', 'content': text}])
            if self.m.get('thinking'):
                kw.update(max_tokens=16000, thinking={'type': 'adaptive'}, output_config={'effort': self.m['thinking']}, tool_choice={'type': 'auto'})
            else:
                kw.update(max_tokens=1024, tool_choice={'type': 'auto'})
                if self.temperature is not None:
                    kw['temperature'] = self.temperature
            r = client('anthropic').messages.create(**kw)
            ms = (time.perf_counter() - t0) * 1000
            answer = next((b.input.get('link') for b in r.content if b.type == 'tool_use'), None)
            u = r.usage
            tin = u.input_tokens + (u.cache_creation_input_tokens or 0) + (u.cache_read_input_tokens or 0)
            return answer, tin, u.output_tokens, ms
        if self.m['provider'] == 'openai':
            tool = {'type': 'function', 'name': 'click_link', 'description': TOOL_DESC,
                    'parameters': {'type': 'object', 'properties': {'link': {'type': 'string'}}, 'required': ['link'], 'additionalProperties': False}}
            kw = dict(model=self.m['model'], instructions=SYSTEM, input=text, tools=[tool],
                      tool_choice={'type': 'function', 'name': 'click_link'}, store=False)
            if self.effort:
                kw['reasoning'] = {'effort': self.effort}
            if self.temperature is not None:
                kw['temperature'] = self.temperature
            r = client('openai').responses.create(**kw)
            ms = (time.perf_counter() - t0) * 1000
            answer = None
            for item in r.output:
                if item.type == 'function_call':
                    try:
                        answer = json.loads(item.arguments).get('link')
                    except (json.JSONDecodeError, AttributeError):
                        answer = item.arguments
                    break
            return answer, r.usage.input_tokens, r.usage.output_tokens, ms
        tool = {'type': 'function', 'function': {'name': 'click_link', 'description': TOOL_DESC,
                'parameters': {'type': 'object', 'properties': {'link': {'type': 'string'}}, 'required': ['link'], 'additionalProperties': False}}}
        kw = dict(model=self.m['model'], messages=[{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': text}],
                  tools=[tool], tool_choice={'type': 'function', 'function': {'name': 'click_link'}})
        if self.effort:
            kw['reasoning_effort'] = self.effort
        if self.temperature is not None:
            kw['temperature'] = self.temperature
        r = client(self.m['provider']).chat.completions.create(**kw)
        ms = (time.perf_counter() - t0) * 1000
        answer = None
        calls = r.choices[0].message.tool_calls or []
        if calls:
            try:
                answer = json.loads(calls[0].function.arguments).get('link')
            except (json.JSONDecodeError, AttributeError):
                answer = calls[0].function.arguments
        u = r.usage
        tout = (u.total_tokens or 0) - (u.prompt_tokens or 0) or u.completion_tokens
        return answer, u.prompt_tokens, tout, ms


def match(answer, links):
    if not isinstance(answer, str):
        return None
    a = answer.strip().strip('"').strip("'").strip()
    if a in links:
        return a
    low = {t.lower(): t for t in links}
    return low.get(a.lower())


def play(caller, pair, titles, adj, idx):
    start, target = pair['start'], pair['target']
    cur, path, steps = start, [start], []
    outcome, tin_sum, tout_sum, cost = 'failed', 0, 0, 0.0
    reason = 'step_limit'
    pin, pout = caller.m['pin'] / 1e6, caller.m['pout'] / 1e6
    while len(steps) < MAX_STEPS:
        links = [titles[j] for j in adj[idx[cur]]]
        if not links:
            reason = 'dead_end'
            break
        note, step = None, None
        for attempt in range(2):
            answer, tin, tout, ms = caller.ask(user_msg(target, cur, path, links, note))
            tin_sum += tin
            tout_sum += tout
            cost += tin * pin + tout * pout
            chosen = match(answer, links)
            rec = {'raw': answer, 'valid': chosen is not None, 'tokensIn': tin, 'tokensOut': tout, 'ms': round(ms)}
            if step is None:
                step = {'page': cur, 'offered': len(links), 'attempts': []}
            step['attempts'].append(rec)
            if chosen:
                break
            note = f'"{answer}" is not one of the links on this page. Pick exactly one title from the list above.'
        steps.append(step)
        if not chosen:
            reason = 'invalid_move'
            break
        step['chosen'] = chosen
        step['revisit'] = chosen in path
        path.append(chosen)
        cur = chosen
        if cur == target:
            outcome, reason = 'solved', None
            break
    return {
        'pair': pair['id'], 'start': start, 'target': target, 'optimal': pair['optimal'], 'difficulty': pair['difficulty'],
        'human': pair['human'], 'model': caller.key, 'settings': caller.settings(), 'promptVersion': PROMPT_VERSION,
        'outcome': outcome, 'failReason': reason, 'path': path, 'clicks': len(path) - 1, 'stepsTaken': len(steps),
        'revisits': sum(1 for s in steps if s.get('revisit')),
        'invalidAttempts': sum(1 for s in steps for a in s['attempts'] if not a['valid']),
        'calls': sum(len(s['attempts']) for s in steps),
        'tokensIn': tin_sum, 'tokensOut': tout_sum, 'costUsd': round(cost, 6), 'steps': steps,
    }
