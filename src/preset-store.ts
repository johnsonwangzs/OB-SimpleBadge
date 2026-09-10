import { createId, decodeData, normalizeBadge, sameBadge, type Badge, type BadgePreset, type PresetData } from "./model";

interface PresetStorage {
  load(): Promise<unknown>;
  save(data: PresetData): Promise<void>;
}

export class PresetStore {
  private data: PresetData = { schemaVersion: 1, presets: [] };
  private loaded = false;
  private tail: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(private readonly storage: PresetStorage) {}

  async load(): Promise<void> {
    this.data = decodeData(await this.storage.load());
    this.loaded = true;
  }

  get presets(): BadgePreset[] { return this.data.presets.map(item => ({ ...item })); }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  add(badge: Badge): Promise<BadgePreset> {
    return this.mutate(draft => {
      const value = normalizeBadge(badge);
      const existing = draft.presets.find(item => sameBadge(item, value));
      if (existing) return { ...existing };
      const preset = { id: createId(), ...value };
      draft.presets.push(preset);
      return { ...preset };
    });
  }

  update(id: string, badge: Badge): Promise<void> {
    return this.mutate(draft => {
      const index = this.findIndex(draft, id);
      const value = normalizeBadge(badge);
      if (draft.presets.some(item => item.id !== id && sameBadge(item, value))) {
        throw new Error("已有相同文字和颜色的预设，请修改后再保存。");
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
    if (index < 0) throw new Error("该预设已不存在，请重新打开编辑窗口。");
    return index;
  }

  private mutate<T>(change: (draft: PresetData) => T): Promise<T> {
    // Serialize writes so a slow save cannot overwrite a newer change.
    const operation = this.tail.then(async () => {
      if (!this.loaded) throw new Error("预设配置尚未成功加载，暂时无法保存。");
      const draft: PresetData = { schemaVersion: 1, presets: this.presets };
      const result = change(draft);
      await this.storage.save(draft);
      this.data = draft;
      for (const listener of this.listeners) {
        try { listener(); } catch (error) { console.error("Simple Badge: settings refresh failed", error); }
      }
      return result;
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }
}
