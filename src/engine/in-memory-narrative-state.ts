// V0 NarrativeState 实现 —— 纯内存状态机
//
// 目标：能跑、能 save/load、单测覆盖核心 transitions。
// V1 把这个文件整体废弃，换成 ink runtime 包装；调用方 0 改动。

import type {
  NarrativeState,
  NarrativeSnapshot,
  ChoiceLog,
  NpcRelation,
  FlagValue,
} from '../types/narrative.js';

export interface InMemoryNarrativeStateInit {
  /** 起点场景 */
  startSceneId: string;
}

export class InMemoryNarrativeState implements NarrativeState {
  private currentSceneId: string;
  private visitedScenes: Set<string>;
  private choiceHistory: ChoiceLog[];
  private flags: Map<string, FlagValue>;
  private npcRelations: Map<string, NpcRelation>;

  constructor(init: InMemoryNarrativeStateInit) {
    this.currentSceneId = init.startSceneId;
    this.visitedScenes = new Set([init.startSceneId]);
    this.choiceHistory = [];
    this.flags = new Map();
    this.npcRelations = new Map();
  }

  // ── 读 ──────────────────────────────────────────

  getCurrentScene(): string {
    return this.currentSceneId;
  }

  hasVisited(sceneId: string): boolean {
    return this.visitedScenes.has(sceneId);
  }

  getChoiceHistory(): ReadonlyArray<ChoiceLog> {
    return this.choiceHistory;
  }

  getFlag(key: string): FlagValue | undefined {
    return this.flags.get(key);
  }

  getNpcRelation(npcId: string): NpcRelation | undefined {
    return this.npcRelations.get(npcId);
  }

  // ── 写 ──────────────────────────────────────────

  jumpToScene(sceneId: string): void {
    if (!sceneId) {
      throw new Error('jumpToScene: sceneId 不能为空');
    }
    this.currentSceneId = sceneId;
    this.visitedScenes.add(sceneId);
  }

  logChoice(choiceId: string, text: string): void {
    this.choiceHistory.push({
      sceneId: this.currentSceneId,
      choiceId,
      text,
      ts: Date.now(),
    });
  }

  setFlag(key: string, value: FlagValue): void {
    this.flags.set(key, value);
  }

  deleteFlag(key: string): void {
    this.flags.delete(key);
  }

  updateNpc(npcId: string, patch: Partial<NpcRelation>): void {
    const existing = this.npcRelations.get(npcId);
    if (existing) {
      // 增量 patch：notes 合并而非覆盖（默认行为）
      const merged: NpcRelation = {
        ...existing,
        ...patch,
        notes:
          patch.notes !== undefined
            ? [...existing.notes, ...patch.notes]
            : existing.notes,
      };
      this.npcRelations.set(npcId, merged);
    } else {
      // 新建：要求至少 npcId 提供
      const initial: NpcRelation = {
        npcId,
        attitude: patch.attitude ?? 0,
        notes: patch.notes ?? [],
      };
      this.npcRelations.set(npcId, initial);
    }
  }

  // ── 序列化 ──────────────────────────────────────

  snapshot(): NarrativeSnapshot {
    return {
      schemaVersion: 1,
      currentSceneId: this.currentSceneId,
      visitedScenes: Array.from(this.visitedScenes),
      choiceHistory: this.choiceHistory.map((c) => ({ ...c })),
      flags: Object.fromEntries(this.flags),
      npcRelations: Object.fromEntries(
        Array.from(this.npcRelations.entries()).map(([k, v]) => [
          k,
          { ...v, notes: [...v.notes] },
        ]),
      ),
    };
  }

  restore(s: NarrativeSnapshot): void {
    if (s.schemaVersion !== 1) {
      throw new Error(
        `restore: schemaVersion ${s.schemaVersion} 不支持，当前实现仅支持 v1`,
      );
    }
    this.currentSceneId = s.currentSceneId;
    this.visitedScenes = new Set(s.visitedScenes);
    this.choiceHistory = s.choiceHistory.map((c) => ({ ...c }));
    this.flags = new Map(Object.entries(s.flags));
    this.npcRelations = new Map(
      Object.entries(s.npcRelations).map(([k, v]) => [
        k,
        { ...v, notes: [...v.notes] },
      ]),
    );
  }
}
