// 真实时 game loop HTTP 服务
//
// 跑法: npm run server:live
// 浏览器: http://localhost:4500
//
// 行为:
//   - 每个浏览器 session 独立维护 character + scene state
//   - 玩家行动 → 实时 LLM 调用 → 引擎丢骰子 → 返回 narrate
//   - 不预生成, 一切动态
//
// 故意不用 Express/Hono, 用 Node 内置 http 模块, 0 新依赖

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { OpenAICompatibleProvider } from '../llm/openai-compatible.js';
import { LlmAdapter, type LlmAction } from '../llm/adapter.js';
import { InMemoryNarrativeState } from '../engine/in-memory-narrative-state.js';
import { rollCheck } from '../engine/skill-check.js';
import { rollSanityCheck } from '../engine/sanity.js';
import { rollInsanity } from '../engine/insanity-tables.js';
import { applyDamage } from '../engine/damage.js';
import { rollDice } from '../engine/dice.js';
import { DefaultRng, type Rng } from '../engine/rng.js';
import { loadScenarioFromJson } from '../engine/scenario-validator.js';
import { loadCharacter, listCharacters } from '../character/save-load.js';
import { skillTotal, recomputeDerivedStats } from '../types/character.js';
import { buildSceneContext } from '../llm/prompts.js';
import type { Character } from '../types/character.js';
import type { Scenario, Scene } from '../types/scenario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ─── Session 管理 ─────────────────────────────────────

interface Session {
  id: string;
  scenarioId: string;
  scenario: Scenario;
  character: Character;
  narrative: InMemoryNarrativeState;
  adapter: LlmAdapter;
  rng: Rng;
  sanityLossAccum: number;
  indefTriggered: boolean;
  createdAt: number;
}

const sessions = new Map<string, Session>();

// 每小时清一次 6h+ 老 session
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
}, 60 * 60 * 1000);

// ─── 加载剧本 + 默认 character ─────────────────────────

async function loadScenarioById(scenarioId: string): Promise<Scenario | null> {
  const path = join(PROJECT_ROOT, `src/scenarios/${scenarioId}.json`);
  try {
    const json = await readFile(path, 'utf-8');
    const r = loadScenarioFromJson(json);
    return r.ok ? r.scenario : null;
  } catch { return null; }
}

async function defaultCharacter(): Promise<Character> {
  try {
    const list = await listCharacters();
    if (list.length > 0) return await loadCharacter(list[0]!.id);
  } catch { /* */ }
  // 兜底硬编一个
  const c: Character = {
    id: 'default', name: '林夏', occupation: '记者', age: 28,
    attributes: { STR: 60, DEX: 60, INT: 80, CON: 60, POW: 60, APP: 60, SIZ: 60, EDU: 80 },
    maxHp: 0, maxMp: 0, maxSanity: 0, currentHp: 0, currentMp: 0, currentSanity: 0,
    luck: 50, movement: 0, dodge: 0, brawl: 0,
    skills: new Map(), inventory: [], conditions: [],
  };
  recomputeDerivedStats(c);
  c.currentHp = c.maxHp; c.currentMp = c.maxMp; c.currentSanity = c.maxSanity;
  return c;
}

// ─── LLM 状态变化处理 helpers ──────────────────────────

function skillTargetFromChar(char: Character, skill: string): number {
  const sk = char.skills.get(skill);
  if (sk) return skillTotal(sk);
  const fallback: Record<string, number> = {
    spot_hidden: 40, listen: 40, library_use: 40, psychology: 40,
    locksmith: 20, persuade: 40, dodge: 30, brawl: 50, fighting: 25,
  };
  return fallback[skill] ?? 40;
}

interface ApplySanityResult { badge: string; loss: number; insanityFired?: string }

function applySanityLossSession(session: Session, loss: number, reason: string): ApplySanityResult {
  if (loss <= 0) return { badge: '', loss: 0 };
  session.character.currentSanity = Math.max(0, session.character.currentSanity - loss);
  session.sanityLossAccum += loss;
  let badge = `心智 -${loss} → ${session.character.currentSanity}/${session.character.maxSanity}`;
  let insanityFired: string | undefined;
  const threshold = Math.floor(session.character.maxSanity / 5);
  if (!session.indefTriggered && session.sanityLossAccum >= threshold) {
    session.indefTriggered = true;
    const insanity = rollInsanity(session.rng);
    const tag = insanity.kind === 'phobia' ? '恐惧症' : '狂躁症';
    insanityFired = `${tag}《${insanity.entry.nameZh}》— ${insanity.entry.description}`;
    badge += ` · 长期失常: ${insanityFired}`;
    session.character.conditions.push({
      type: 'indef_insanity', source: reason, appliedAt: Date.now(),
      insanityDetail: {
        kind: insanity.kind, id: insanity.entry.id,
        nameZh: insanity.entry.nameZh, nameEn: insanity.entry.nameEn,
        description: insanity.entry.description,
      },
    });
  }
  const result: ApplySanityResult = { badge: `[${badge}]`, loss };
  if (insanityFired) result.insanityFired = insanityFired;
  return result;
}

// ─── API 处理 ──────────────────────────────────────────

interface ApiResponse {
  ok: boolean;
  sessionId?: string;
  characterSummary?: { name: string; occupation: string; hp: string; sanity: string; conditions: string[] };
  scene?: { id: string; name: string; narrate: string; suggestedActions: Array<{ idx: number; label: string; hasCheck: boolean; hasSanityCost: boolean }>; exits: Array<{ idx: number; condition: string; toScene: string }> };
  result?: { narrate: string; badges: string[]; nextSceneId?: string };
  error?: string;
}

async function apiStartSession(scenarioId: string): Promise<ApiResponse> {
  const scenario = await loadScenarioById(scenarioId);
  if (!scenario) return { ok: false, error: `unknown scenario: ${scenarioId}` };
  const character = await defaultCharacter();
  const baseUrl = process.env['LLM_BASE_URL'];
  const apiKey = process.env['LLM_API_KEY'];
  const model = process.env['LLM_MODEL'] ?? 'gpt-5.4-mini';
  if (!baseUrl || !apiKey) return { ok: false, error: 'server 缺 LLM_BASE_URL / LLM_API_KEY env' };
  const provider = new OpenAICompatibleProvider({ baseUrl, apiKey, model, timeoutMs: 60_000 });
  const session: Session = {
    id: randomUUID(),
    scenarioId, scenario, character,
    narrative: new InMemoryNarrativeState({ startSceneId: scenario.startSceneId }),
    adapter: new LlmAdapter({ provider }),
    rng: new DefaultRng(),
    sanityLossAccum: 0,
    indefTriggered: false,
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);
  return { ok: true, sessionId: session.id, characterSummary: charSummary(session) };
}

function charSummary(session: Session): NonNullable<ApiResponse['characterSummary']> {
  const c = session.character;
  return {
    name: c.name, occupation: c.occupation,
    hp: `${c.currentHp}/${c.maxHp}`,
    sanity: `${c.currentSanity}/${c.maxSanity}`,
    conditions: c.conditions.map((cd) => {
      if (cd.type === 'indef_insanity' && cd.insanityDetail) {
        const tag = cd.insanityDetail.kind === 'phobia' ? '恐惧症' : '狂躁症';
        return `${tag}: ${cd.insanityDetail.nameZh}`;
      }
      return cd.type;
    }),
  };
}

async function apiEnterScene(sessionId: string, sceneId: string): Promise<ApiResponse> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: 'session 已过期' };
  const scene = session.scenario.scenes.find((s) => s.id === sceneId);
  if (!scene) return { ok: false, error: `scene 不存在: ${sceneId}` };
  session.narrative.jumpToScene(sceneId);

  // 1) LLM 主叙事
  const action = await session.adapter.enterScene({
    scenario: { id: session.scenario.id, title: session.scenario.title, setting: session.scenario.setting },
    scene: { id: scene.id, name: scene.name, description: scene.description, hints: scene.hints ?? [] },
    character: session.character,
    narrative: session.narrative,
  });
  let narrate = action.text;

  // 2) 触发 scene.sanityTriggers
  const badges: string[] = [];
  for (const trigger of (scene.sanityTriggers ?? [])) {
    const r = rollSanityCheck({
      currentSanity: session.character.currentSanity,
      lossOnSuccess: trigger.lossOnSuccess,
      lossOnFailureRoll: trigger.lossOnFailureRoll,
      reason: trigger.trigger,
    }, session.rng);
    const sanResult = applySanityLossSession(session, r.actualLoss, trigger.trigger);
    if (sanResult.badge) badges.push(sanResult.badge);
  }
  if (badges.length) narrate += '\n\n' + badges.join(' ');

  // 3) LLM 建议行动 (in-scene)
  const sceneContext = buildSceneContext({
    scenario: { id: session.scenario.id, title: session.scenario.title, setting: session.scenario.setting },
    scene: { id: scene.id, name: scene.name, description: scene.description, hints: scene.hints ?? [] },
    character: session.character,
    narrative: session.narrative,
  });
  let suggestedActions: NonNullable<ApiResponse['scene']>['suggestedActions'] = [];
  try {
    const suggested = await session.adapter.suggestActions({ sceneContext, count: 4 });
    suggestedActions = suggested.map((a, i) => ({
      idx: i,
      label: a.label,
      hasCheck: a.kind === 'check',
      hasSanityCost: !!a.sanityCost,
    }));
    // 把 suggested 缓存到 session, action 选时直接用
    (session as Session & { _lastSuggested?: typeof suggested })._lastSuggested = suggested;
  } catch { /* */ }

  const exits = (scene.exits ?? []).map((e, i) => ({ idx: i, condition: e.condition, toScene: e.toScene }));
  return {
    ok: true,
    sessionId, characterSummary: charSummary(session),
    scene: { id: scene.id, name: scene.name, narrate, suggestedActions, exits },
  };
}

async function apiResolveAction(sessionId: string, actionIdx: number): Promise<ApiResponse> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: 'session 已过期' };
  const cached = (session as Session & { _lastSuggested?: import('../llm/adapter.js').SuggestedAction[] })._lastSuggested;
  if (!cached || !cached[actionIdx]) return { ok: false, error: '行动 idx 无效或 session 已 stale' };
  const a = cached[actionIdx]!;

  const badges: string[] = [];
  let narrate: string;
  let checkSucceeded = true;
  if (a.kind === 'check') {
    const target = skillTargetFromChar(session.character, a.check.skill);
    const r = rollCheck({ target, difficulty: a.check.difficulty }, session.rng);
    checkSucceeded = r.succeeded;
    const skillName = session.character.skills.get(a.check.skill)?.name ?? a.check.skill;
    badges.push(`[${skillName} ${r.roll}/${r.effectiveTarget} ${r.outcome}]`);
    narrate = r.succeeded ? a.successNarrate : a.failNarrate;
  } else {
    narrate = a.resultNarrate;
  }

  if (a.sanityCost) {
    const sanResult = rollSanityCheck({
      currentSanity: session.character.currentSanity,
      lossOnSuccess: a.sanityCost.onSuccess,
      lossOnFailureRoll: a.sanityCost.onFailure,
      reason: a.label,
    }, session.rng);
    const r = applySanityLossSession(session, sanResult.actualLoss, a.label);
    if (r.badge) badges.push(r.badge);
  }

  if (a.damageCost) {
    const dmgSpec = checkSucceeded ? a.damageCost.onSuccess : a.damageCost.onFailure;
    const amount = typeof dmgSpec === 'number' ? dmgSpec : rollDice(dmgSpec, session.rng);
    if (amount > 0) {
      const dr = applyDamage(session.character, { amount, source: a.label, physical: a.damageCost.physical ?? true });
      let dmgBadge = `[HP -${dr.actualDamage} → ${session.character.currentHp}/${session.character.maxHp}]`;
      if (dr.triggeredConditions.includes('major_wound')) dmgBadge += ' 重伤';
      if (dr.triggeredConditions.includes('unconscious')) dmgBadge += ' 昏迷';
      badges.push(dmgBadge);
    }
  }

  return {
    ok: true, sessionId, characterSummary: charSummary(session),
    result: { narrate, badges },
  };
}

async function apiTransitionScene(sessionId: string, exitIdx: number): Promise<ApiResponse> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: 'session 已过期' };
  const sceneId = session.narrative.getCurrentScene();
  const scene = session.scenario.scenes.find((s) => s.id === sceneId);
  if (!scene) return { ok: false, error: `scene 不存在` };
  const exit = scene.exits?.[exitIdx];
  if (!exit) return { ok: false, error: '出口 idx 无效' };

  // LLM 写过渡叙事
  let narrate = '';
  try {
    const action = await session.adapter.narrateTransition({
      fromScene: sceneId,
      toScene: exit.toScene,
      choiceText: exit.condition,
    });
    narrate = action.text;
  } catch { /* */ }

  return {
    ok: true, sessionId, characterSummary: charSummary(session),
    result: { narrate, badges: [], nextSceneId: exit.toScene },
  };
}

// ─── 请求路由 + 静态文件 ──────────────────────────────

const STATIC_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>ai-coc-keeper · 真实时模式</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 30px auto; padding: 0 20px; background: #1a1a1a; color: #ddd; line-height: 1.7; }
  h1 { color: #c2a878; border-bottom: 1px solid #444; padding-bottom: 8px; }
  .status { background: #2a2a2a; padding: 12px; border-radius: 6px; margin: 16px 0; font-size: 13px; }
  .status .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .narrate { background: #232323; padding: 16px; border-left: 3px solid #8b6f3d; margin: 16px 0; white-space: pre-wrap; }
  .badge { display: inline-block; padding: 2px 8px; background: #3a2a1a; color: #d4a060; border-radius: 4px; font-size: 12px; margin: 2px 4px 2px 0; }
  .badge.insanity { background: #4a1a1a; color: #ff8888; }
  button { background: #c2a878; color: #1a1a1a; border: none; padding: 10px 16px; border-radius: 4px; cursor: pointer; margin: 4px; font-size: 14px; }
  button:hover { background: #d4ba8a; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .actions, .exits { margin: 12px 0; }
  .exits button { background: #6a4a2a; color: #fff; }
  .loading { color: #888; font-style: italic; }
  .error { color: #ff6666; background: #2a1a1a; padding: 10px; border-radius: 4px; }
  .conditions { color: #ff8888; }
</style>
</head>
<body>
<h1>ai-coc-keeper · 真实时模式</h1>

<div id="boot">
  <button onclick="startGame()">开始 ·《失踪的馆长》</button>
</div>

<div id="status" class="status" style="display:none">
  <div class="row"><b id="char-name"></b><span id="char-occ"></span></div>
  <div class="row">HP <span id="char-hp"></span></div>
  <div class="row">心智 <span id="char-sanity"></span></div>
  <div class="row conditions" id="char-conditions" style="display:none"></div>
</div>

<div id="scene-name" style="font-weight: bold; color: #c2a878; margin: 16px 0 8px;"></div>
<div id="narrate" class="narrate" style="display:none"></div>
<div id="actions" class="actions"></div>
<div id="exits" class="exits"></div>
<div id="loading" class="loading" style="display:none">⏳ AI 思考中...</div>
<div id="error" class="error" style="display:none"></div>

<script>
let sessionId = null;

async function api(path, body) {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('error').style.display = 'none';
  try {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'unknown');
    return data;
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

function updateStatus(s) {
  if (!s) return;
  document.getElementById('status').style.display = 'block';
  document.getElementById('char-name').textContent = s.name;
  document.getElementById('char-occ').textContent = s.occupation;
  document.getElementById('char-hp').textContent = s.hp;
  document.getElementById('char-sanity').textContent = s.sanity;
  const condDiv = document.getElementById('char-conditions');
  if (s.conditions.length > 0) {
    condDiv.textContent = '失常 ' + s.conditions.join(', ');
    condDiv.style.display = 'block';
  } else {
    condDiv.style.display = 'none';
  }
}

async function startGame() {
  try {
    document.getElementById('boot').style.display = 'none';
    const data = await api('/api/session', { scenarioId: 'library-demo' });
    sessionId = data.sessionId;
    updateStatus(data.characterSummary);
    await enterScene('scene_entrance');
  } catch (e) { showError(e.message); }
}

async function enterScene(sceneId) {
  try {
    const data = await api('/api/scene/enter', { sessionId, sceneId });
    updateStatus(data.characterSummary);
    document.getElementById('scene-name').textContent = data.scene.name;
    document.getElementById('narrate').textContent = data.scene.narrate;
    document.getElementById('narrate').style.display = 'block';
    renderActions(data.scene.suggestedActions);
    renderExits(data.scene.exits);
  } catch (e) { showError(e.message); }
}

function renderActions(actions) {
  const div = document.getElementById('actions');
  div.innerHTML = '';
  for (const a of actions) {
    const btn = document.createElement('button');
    let label = a.label;
    if (a.hasCheck) label += ' 🎲';
    if (a.hasSanityCost) label += ' 😱';
    btn.textContent = label;
    btn.onclick = () => doAction(a.idx);
    div.appendChild(btn);
  }
}

function renderExits(exits) {
  const div = document.getElementById('exits');
  div.innerHTML = '';
  for (const e of exits) {
    const btn = document.createElement('button');
    btn.textContent = '🚪 ' + e.condition;
    btn.onclick = () => doExit(e.idx);
    div.appendChild(btn);
  }
}

async function doAction(idx) {
  try {
    const data = await api('/api/scene/action', { sessionId, actionIdx: idx });
    updateStatus(data.characterSummary);
    const narrEl = document.getElementById('narrate');
    let txt = narrEl.textContent + '\\n\\n' + data.result.narrate;
    if (data.result.badges.length) txt += '\\n\\n' + data.result.badges.join(' ');
    narrEl.textContent = txt;
    // 不重置 actions: 玩家可继续探索 (V0: actions 都用一次后失效, 不再 enable)
  } catch (e) { showError(e.message); }
}

async function doExit(idx) {
  try {
    const data = await api('/api/scene/transition', { sessionId, exitIdx: idx });
    updateStatus(data.characterSummary);
    if (data.result.narrate) {
      const narrEl = document.getElementById('narrate');
      narrEl.textContent += '\\n\\n' + data.result.narrate;
    }
    // 跳到下个 scene
    if (data.result.nextSceneId) {
      setTimeout(() => enterScene(data.result.nextSceneId), 1000);
    }
  } catch (e) { showError(e.message); }
}

function showError(msg) {
  const div = document.getElementById('error');
  div.textContent = '❌ ' + msg;
  div.style.display = 'block';
}
</script>
</body>
</html>`;

// ─── HTTP server ──────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname;
  try {
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(STATIC_HTML);
      return;
    }
    if (path === '/api/session' && req.method === 'POST') {
      const body = await readBody(req) as { scenarioId?: string };
      const result = await apiStartSession(body.scenarioId ?? 'library-demo');
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
    if (path === '/api/scene/enter' && req.method === 'POST') {
      const body = await readBody(req) as { sessionId?: string; sceneId?: string };
      const result = await apiEnterScene(body.sessionId ?? '', body.sceneId ?? '');
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
    if (path === '/api/scene/action' && req.method === 'POST') {
      const body = await readBody(req) as { sessionId?: string; actionIdx?: number };
      const result = await apiResolveAction(body.sessionId ?? '', body.actionIdx ?? -1);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
    if (path === '/api/scene/transition' && req.method === 'POST') {
      const body = await readBody(req) as { sessionId?: string; exitIdx?: number };
      const result = await apiTransitionScene(body.sessionId ?? '', body.exitIdx ?? -1);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error('handler error:', e);
    sendJson(res, 500, { ok: false, error: (e as Error).message });
  }
});

const PORT = parseInt(process.env['LIVE_PORT'] ?? '4500', 10);
server.listen(PORT, () => {
  console.log(`🎮 ai-coc-keeper 真实时 server: http://localhost:${PORT}`);
  console.log(`   Sessions: in-memory, 6h TTL`);
  console.log(`   Scenarios: src/scenarios/*.json (现有 library-demo)`);
});
