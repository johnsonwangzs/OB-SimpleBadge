import { createId, decodeData, defaultSettings, normalizeBadge, planPresetImport, sameBadge, validateFontSizePercent, type Badge, type BadgePreset, type PresetData } from "./model";
import { getTranslations } from "./i18n";

interface PresetStorage {
  load(): Promise<unknown>;
  save(data: PresetData): Promise<void>;
}

export interface ImportResult { added: number; skipped: number }
type StoreChange = "presets" | "appearance";

export class PresetStore {
  private data: PresetData = { schemaVersion: 3, presets: [], settings: defaultSettings() };
  private loaded = false;
  private tail: Promise<void> = Promise.resolve();
  private listeners = new Set<(change: StoreChange) => void>();

  constructor(private readonly storage: PresetStorage, readonly strings = getTranslations()) {}

  async load(): Promise<void> {
    this.data = decodeData(await this.storage.load(), this.strings);
    this.loaded = true;
  }

  get presets(): BadgePreset[] { return this.data.presets.map(item => ({ ...item })); }
  get badgeFontSizePercent(): number { return this.data.settings.badgeFontSizePercent; }

  async setBadgeFontSizePercent(value: number): Promise<void> {
    const percent = validateFontSizePercent(value, this.strings);
    await this.mutate(draft => { draft.settings.badgeFontSizePercent = percent; }, true, "appearance");
  }

  subscribe(listener: (change: StoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  add(badge: Badge): Promise<BadgePreset> {
    return this.mutate(draft => {
      const value = normalizeBadge(badge, this.strings);
      const existing = draft.presets.find(item => sameBadge(item, value));
      if (existing) return { ...existing };
      const preset = { id: createId(), ...value };
      draft.presets.push(preset);
      return { ...preset };
    });
  }

  async addMany(badges: readonly Badge[]): Promise<ImportResult> {
    // Validate and snapshot the whole batch before queuing a single write.
    const values = badges.map(badge => normalizeBadge(badge, this.strings));
    return this.mutate(draft => {
      const { newBadges, skipped } = planPresetImport(values, draft.presets);
      draft.presets.push(...newBadges.map(value => ({ id: createId(), ...value })));
      return { added: newBadges.length, skipped };
    }, true);
  }

  update(id: string, badge: Badge): Promise<void> {
    return this.mutate(draft => {
      const index = this.findIndex(draft, id);
      const value = normalizeBadge(badge, this.strings);
      if (draft.presets.some(item => item.id !== id && sameBadge(item, value))) {
        throw new Error(this.strings.duplicatePreset);
      }
      draft.presets[index] = { id, ...value };
    });
  }

  remove(id: string): Promise<void> {
    return this.mutate(draft => { draft.presets.splice(this.findIndex(draft, id), 1); });
  }

  move(id: string, direction: -1 | 1): Promise<void> {
    return this.mutate(draft => {
      const index = this.findIndex(draft, id);
      const destination = index + direction;
      if (destination < 0 || destination >= draft.presets.length) return;
      [draft.presets[index], draft.presets[destination]] = [draft.presets[destination], draft.presets[index]];
    });
  }

  private findIndex(data: PresetData, id: string): number {
    const index = data.presets.findIndex(item => item.id === id);
    if (index < 0) throw new Error(this.strings.missingPreset);
    return index;
  }

  private mutate<T>(change: (draft: PresetData) => T, skipUnchanged = false, kind: StoreChange = "presets"): Promise<T> {
    // Serialize writes so a slow save cannot overwrite a newer change.
    const operation = this.tail.then(async () => {
      if (!this.loaded) throw new Error(this.strings.configNotLoaded);
      const draft: PresetData = { schemaVersion: 3, presets: this.presets, settings: { ...this.data.settings } };
      const result = change(draft);
      if (skipUnchanged && draft.settings.badgeFontSizePercent === this.badgeFontSizePercent
        && draft.presets.length === this.data.presets.length
        && draft.presets.every((preset, index) => preset.id === this.data.presets[index].id
          && sameBadge(preset, this.data.presets[index]))) return result;
      await this.storage.save(draft);
      this.data = draft;
      for (const listener of this.listeners) {
        try { listener(kind); } catch (error) { console.error("Simple Badge: settings refresh failed", error); }
      }
      return result;
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }
}
