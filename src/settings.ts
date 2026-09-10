import { Modal, PluginSettingTab, setIcon, type App } from "obsidian";
import { renderBadge } from "./badge";
import { BadgeForm } from "./badge-form";
import type { Badge, BadgePreset } from "./model";
import type SimpleBadgePlugin from "./main";

export class PresetEditModal extends Modal {
  private form: BadgeForm | undefined;
  constructor(app: App, private readonly preset: BadgePreset | undefined,
    private readonly save: (badge: Badge) => Promise<void>, private readonly closed: () => void) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("simple-badge-edit-modal");
    this.titleEl.setText(this.preset ? "编辑预设 Badge" : "新增预设 Badge");
    this.form = new BadgeForm(this.contentEl, {
      initial: this.preset ? { ...this.preset, save: false } : undefined,
      submitLabel: "保存预设",
      onSubmit: async draft => { await this.save(draft); this.close(); },
    });
    this.form.focus();
  }
  onClose(): void { this.form?.destroy(); this.contentEl.empty(); this.closed(); }
}

export class SimpleBadgeSettingTab extends PluginSettingTab {
  private unsubscribe: (() => void) | undefined;
  private listEl: HTMLElement | undefined;
  private statusEl: HTMLElement | undefined;
  private busy = false;
  private visible = false;
  constructor(app: App, private readonly owner: SimpleBadgePlugin) { super(app, owner); }

  // Use the imperative settings API to retain support for pre-1.13 Obsidian.
  display(): void {
    this.unsubscribe?.();
    this.visible = true;
    this.containerEl.empty();
    this.containerEl.addClass("simple-badge-settings");
    this.containerEl.createEl("h2", { text: "预设 Badge" });
    this.containerEl.createEl("p", { cls: "simple-badge-muted", text: "管理右键插入窗口中的预设。列表顺序只影响展示，插入顺序以点选顺序为准。" });
    const add = this.containerEl.createEl("button", { cls: "mod-cta", text: "新增预设", attr: { type: "button" } });
    add.disabled = !!this.owner.loadError;
    add.addEventListener("click", () => this.owner.openPresetEditor());
    this.statusEl = this.containerEl.createDiv({ cls: "simple-badge-message", attr: { role: "status", "aria-live": "polite" } });
    if (this.owner.loadError) { this.statusEl.addClass("is-error"); this.statusEl.setText(this.owner.loadError); }
    this.listEl = this.containerEl.createDiv({ cls: "simple-badge-settings-list" });
    this.unsubscribe = this.owner.presets.subscribe(() => this.renderPresets());
    this.renderPresets();
  }
  hide(): void { this.visible = false; this.unsubscribe?.(); this.unsubscribe = undefined; }

  private renderPresets(): void {
    if (!this.visible || !this.listEl) return;
    const presets = this.owner.presets.presets;
    this.listEl.empty();
    if (!presets.length) this.listEl.createEl("p", { cls: "simple-badge-muted", text: "暂无预设，点击“新增预设”创建第一个 Badge。" });
    presets.forEach((preset, index) => {
      const row = this.listEl!.createDiv({ cls: "simple-badge-settings-row" });
      renderBadge(row.createDiv({ cls: "simple-badge-preview" }), preset);
      const controls = row.createDiv({ cls: "simple-badge-settings-actions" });
      const up = controls.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": `上移 ${preset.text}` } });
      setIcon(up, "arrow-up");
      up.disabled = this.busy || index === 0;
      up.addEventListener("click", () => { void this.runAction(() => this.owner.presets.move(preset.id, -1), "展示顺序已保存。"); });
      const down = controls.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": `下移 ${preset.text}` } });
      setIcon(down, "arrow-down");
      down.disabled = this.busy || index === presets.length - 1;
      down.addEventListener("click", () => { void this.runAction(() => this.owner.presets.move(preset.id, 1), "展示顺序已保存。"); });
      const edit = controls.createEl("button", { text: "编辑", attr: { type: "button", "aria-label": `编辑 ${preset.text}` } });
      edit.disabled = this.busy;
      edit.addEventListener("click", () => this.owner.openPresetEditor(preset));
      const remove = controls.createEl("button", { text: "删除", attr: { type: "button", "aria-label": `删除 ${preset.text}` } });
      remove.disabled = this.busy;
      remove.addEventListener("click", () => { void this.runAction(() => this.owner.presets.remove(preset.id), "预设已删除，笔记中已有的 Badge 不受影响。"); });
    });
  }

  private async runAction(action: () => Promise<void>, success: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.renderPresets();
    try {
      await action();
      if (this.visible) { this.statusEl?.removeClass("is-error"); this.statusEl?.setText(success); }
    } catch (error) {
      if (this.visible) {
        this.statusEl?.addClass("is-error");
        this.statusEl?.setText(error instanceof Error ? error.message : "保存失败，请重试。");
      }
    } finally { this.busy = false; this.renderPresets(); }
  }
}
