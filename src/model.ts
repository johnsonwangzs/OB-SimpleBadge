export const BADGE_COLORS = [
  { id: "blue", label: "蓝色" },
  { id: "green", label: "绿色" },
  { id: "purple", label: "紫色" },
  { id: "red", label: "红色" },
] as const;

export type BadgeColor = (typeof BADGE_COLORS)[number]["id"];
export interface Badge { text: string; color: BadgeColor }
export interface BadgePreset extends Badge { id: string }
export interface PresetData { schemaVersion: 1; presets: BadgePreset[] }
export interface BadgeDraft extends Badge { save: boolean }
export interface InsertSession {
  presets: BadgePreset[];
  selected: BadgePreset[];
  draft: BadgeDraft;
}

export function normalizeBadge(value: Badge): Badge {
  if (typeof value.text !== "string" || !value.text.trim()) throw new Error("请输入 Badge 文字。");
  if (/[\r\n]/.test(value.text)) throw new Error("Badge 文字只能有一行。");
  if (!BADGE_COLORS.some(color => color.id === value.color)) throw new Error("请选择有效的 Badge 颜色。");
  return { text: value.text.trim(), color: value.color };
}

export function sameBadge(a: Badge, b: Badge): boolean {
  return a.text === b.text && a.color === b.color;
}

export function createId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, "0")).join("");
}

export function defaultData(): PresetData {
  return { schemaVersion: 1, presets: [
    { id: "default-blue", color: "blue", text: "信息" },
    { id: "default-green", color: "green", text: "完成" },
    { id: "default-purple", color: "purple", text: "备注" },
    { id: "default-red", color: "red", text: "重要" },
  ] };
}

export function decodeData(raw: unknown): PresetData {
  if (raw == null) return defaultData();
  if (typeof raw !== "object" || !("schemaVersion" in raw) || raw.schemaVersion !== 1
    || !("presets" in raw) || !Array.isArray(raw.presets)) {
    throw new Error("预设配置格式或版本不受支持，请检查 data.json 后重新启用插件。");
  }
  const presets: BadgePreset[] = [];
  for (const entry of raw.presets) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id.trim()) {
      throw new Error("预设配置包含无效的 ID。");
    }
    const badge = normalizeBadge(entry as Badge);
    if (presets.some(preset => preset.id === entry.id || sameBadge(preset, badge))) {
      throw new Error("预设配置包含重复的 Badge 或 ID。");
    }
    presets.push({ id: entry.id, ...badge });
  }
  return { schemaVersion: 1, presets };
}

// Selections are snapshots: later preset edits cannot silently change this batch.
export class OrderedBadges {
  private items: BadgePreset[];

  constructor(items: readonly BadgePreset[] = []) {
    this.items = [];
    for (const item of items) this.add(item);
  }

  get values(): BadgePreset[] { return this.items.map(item => ({ ...item })); }
  get size(): number { return this.items.length; }
  indexOf(id: string): number { return this.items.findIndex(item => item.id === id); }

  toggle(item: BadgePreset): void {
    const index = this.indexOf(item.id);
    if (index < 0) this.add(item);
    else this.items.splice(index, 1);
  }

  add(item: BadgePreset): void {
    const index = this.items.findIndex(current => current.id === item.id || sameBadge(current, item));
    if (index < 0) this.items.push({ ...item });
    else this.items[index] = { ...item };
  }

  remove(id: string): void { this.items = this.items.filter(item => item.id !== id); }
}

export function serializeBadges(items: readonly Badge[]): string {
  return items.map(item => {
    const { text, color } = normalizeBadge(item);
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<span class="badge badge-${color}">${escaped}</span>`;
  }).join(" ");
}
