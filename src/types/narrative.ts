// NarrativeState 接口 —— V0 关键抽象
//
// 目标：把"叙事编排状态"跟"角色卡状态"分开。
// V0 自写实现（in-memory）；V1 把这个接口的实现换成 ink runtime 包装，
// 业务代码（GameEngine / WebGAL Adapter）0 改动。
//
// 不放进 NarrativeState 的：
// - 角色属性 / HP / Sanity / 技能 → 放 Character
// - 检定算法 / 骰子 → 放 RulesEngine
// - 场景文本 / 立绘资源 → 放 Scenario 定义
//
// 只放进 NarrativeState 的：
// - 我现在在哪个场景
// - 之前去过哪些场景
// - 玩家做过哪些选择
// - 故事 flags（如"已找到日记"、"NPC X 信任度=高"）
// - NPC 关系（独立于场景的长期状态）

export interface ChoiceLog {
  sceneId: string;
  choiceId: string;
  /** 玩家看到的选项文本（log 用）*/
  text: string;
  /** 时间戳 */
  ts: number;
}

export interface NpcRelation {
  /** NPC 标识 */
  npcId: string;
  /** 对玩家态度：-100 (敌对) ~ +100 (盟友) */
  attitude: number;
  /** 自由文本注记，可以是"知道我的真名"/"欠我人情"等 */
  notes: string[];
}

export type FlagValue = boolean | number | string;

/**
 * NarrativeState 快照（save/load 用）
 * 必须是 plain JSON-serializable —— 不能含 Map/Set。
 */
export interface NarrativeSnapshot {
  schemaVersion: 1;
  currentSceneId: string;
  visitedScenes: string[];           // Set 序列化为 array
  choiceHistory: ChoiceLog[];
  flags: Record<string, FlagValue>;  // Map 序列化为 object
  npcRelations: Record<string, NpcRelation>;
}

/**
 * NarrativeState —— 叙事编排接口
 *
 * V0 由 InMemoryNarrativeState 实现。
 * V1 由 InkRuntimeNarrativeState 实现，包装 ink web runtime（inkjs/ts-ink）。
 *
 * **接口契约**：
 * - 所有方法同步（不返回 Promise）—— 状态变化即时生效
 * - snapshot/restore 必须双向无损（roundtrip identity）
 * - flag 命名建议下划线 / 点号风格："found_diary" / "npc.smith.trust"
 */
export interface NarrativeState {
  // ── 读 ───────────────────────────────────────────

  /** 当前场景 ID */
  getCurrentScene(): string;

  /** 是否去过某场景 */
  hasVisited(sceneId: string): boolean;

  /** 选择历史（按时间顺序）*/
  getChoiceHistory(): ReadonlyArray<ChoiceLog>;

  /** 读 flag */
  getFlag(key: string): FlagValue | undefined;

  /** 读 NPC 关系 */
  getNpcRelation(npcId: string): NpcRelation | undefined;

  // ── 写 ───────────────────────────────────────────

  /** 跳到某场景；自动加入 visitedScenes */
  jumpToScene(sceneId: string): void;

  /** 记录玩家做的选择 */
  logChoice(choiceId: string, text: string): void;

  /** 设/改 flag */
  setFlag(key: string, value: FlagValue): void;

  /** 删 flag */
  deleteFlag(key: string): void;

  /** 修改 NPC 关系（增量 patch）*/
  updateNpc(npcId: string, patch: Partial<NpcRelation>): void;

  // ── 序列化 ───────────────────────────────────────

  snapshot(): NarrativeSnapshot;
  restore(s: NarrativeSnapshot): void;
}
