import { getTranslations, type Translations } from "./i18n";

export const BADGE_COLORS = [
  { id: "red" },
  { id: "orange" },
  { id: "yellow" },
  { id: "green" },
  { id: "cyan" },
  { id: "blue" },
  { id: "purple" },
  { id: "pink" },
] as const;

export type ThemeBadgeColor = (typeof BADGE_COLORS)[number]["id"];
export type CustomBadgeColor = `#${string}`;
export type BadgeColor = ThemeBadgeColor | CustomBadgeColor;
export interface Badge { text: string; color: BadgeColor }
export interface BadgePreset extends Badge { id: string }
export const DEFAULT_BADGE_FONT_SIZE_PERCENT = 72;
export const MIN_BADGE_FONT_SIZE_PERCENT = 50;
export const MAX_BADGE_FONT_SIZE_PERCENT = 150;
// null preserves the original fixed 4px corners; numbers opt into relative rounding.
export type BadgeCornerRoundness = number | null;
export const DEFAULT_CUSTOM_ROUNDNESS_PERCENT = 40;
export interface BadgeSettings { badgeFontSizePercent: number; badgeCornerRoundnessPercent: BadgeCornerRoundness }
export interface PresetData { schemaVersion: 4; presets: BadgePreset[]; settings: BadgeSettings }
export interface BadgeDraft extends Badge { save: boolean; customColorInput?: string }
export interface InsertSession {
  presets: BadgePreset[];
  selected: BadgePreset[];
  draft: BadgeDraft;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultSettings(): BadgeSettings {
  return { badgeFontSizePercent: DEFAULT_BADGE_FONT_SIZE_PERCENT, badgeCornerRoundnessPercent: null };
}

export function validateFontSizePercent(value: unknown, strings = getTranslations()): number {
  if (typeof value !== "number" || !Number.isInteger(value)
    || value < MIN_BADGE_FONT_SIZE_PERCENT || value > MAX_BADGE_FONT_SIZE_PERCENT) {
    throw new Error(strings.invalidFontSize);
  }
  return value;
}

export function validateCornerRoundness(value: unknown, strings = getTranslations()): BadgeCornerRoundness {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(strings.invalidCornerRoundness);
  }
  return value;
}

export function isThemeColor(value: unknown): value is ThemeBadgeColor {
  return BADGE_COLORS.some(color => color.id === value);
}

export function normalizeHexColor(value: unknown): CustomBadgeColor | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(hex)) return hex as CustomBadgeColor;
  if (/^#[\da-f]{3}$/.test(hex)) return `#${Array.from(hex.slice(1), digit => digit + digit).join("")}`;
  return undefined;
}

export function normalizeColor(value: unknown): BadgeColor | undefined {
  return isThemeColor(value) ? value : normalizeHexColor(value);
}

export function colorLabel(color: BadgeColor, strings: Translations): string {
  return isThemeColor(color) ? strings.colors[color] : color;
}

export function normalizeBadge(value: unknown, strings = getTranslations()): Badge {
  if (!isRecord(value) || typeof value.text !== "string" || !value.text.trim()) throw new Error(strings.requiredText);
  if (/[\r\n]/.test(value.text)) throw new Error(strings.singleLine);
  const color = normalizeColor(value.color);
  if (!color) throw new Error(strings.invalidColor);
  return { text: value.text.trim(), color };
}

export function sameBadge(a: Badge, b: Badge): boolean {
  const color = normalizeColor(a.color);
  return a.text === b.text && color !== undefined && color === normalizeColor(b.color);
}

export function planPresetImport(badges: readonly Badge[], existing: readonly Badge[]): { newBadges: Badge[]; skipped: number } {
  const newBadges: Badge[] = [];
  for (const badge of badges) {
    if (existing.some(preset => sameBadge(preset, badge)) || newBadges.some(preset => sameBadge(preset, badge))) continue;
    newBadges.push({ ...badge });
  }
  return { newBadges, skipped: badges.length - newBadges.length };
}

export function createId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, "0")).join("");
}

export function defaultData(strings: Translations = getTranslations()): PresetData {
  return { schemaVersion: 4, settings: defaultSettings(), presets: [
    { id: "default-blue", color: "blue", text: strings.defaults.blue },
    { id: "default-green", color: "green", text: strings.defaults.green },
    { id: "default-purple", color: "purple", text: strings.defaults.purple },
    { id: "default-red", color: "red", text: strings.defaults.red },
  ] };
}

export function decodeData(raw: unknown, strings = getTranslations()): PresetData {
  if (raw == null) return defaultData(strings);
  if (!isRecord(raw) || ![1, 2, 3, 4].includes(raw.schemaVersion as number) || !Array.isArray(raw.presets)) {
    throw new Error(strings.unsupportedConfig);
  }
  const settings = defaultSettings();
  if (raw.schemaVersion === 3 || raw.schemaVersion === 4) {
    settings.badgeFontSizePercent = validateFontSizePercent(isRecord(raw.settings) ? raw.settings.badgeFontSizePercent : undefined, strings);
  }
  if (raw.schemaVersion === 4) {
    settings.badgeCornerRoundnessPercent = validateCornerRoundness(isRecord(raw.settings) ? raw.settings.badgeCornerRoundnessPercent : undefined, strings);
  }
  const presets: BadgePreset[] = [];
  const entries: unknown[] = raw.presets;
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim()) {
      throw new Error(strings.invalidId);
    }
    const badge = normalizeBadge(entry, strings);
    if (presets.some(preset => preset.id === entry.id || sameBadge(preset, badge))) {
      throw new Error(strings.duplicateConfig);
    }
    presets.push({ id: entry.id, ...badge });
  }
  return { schemaVersion: 4, presets, settings };
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
    if (isThemeColor(color)) return `<span class="badge badge-${color}">${escaped}</span>`;
    return `<span class="badge badge-custom" style="--simple-badge-color: ${color};">${escaped}</span>`;
  }).join(" ");
}
