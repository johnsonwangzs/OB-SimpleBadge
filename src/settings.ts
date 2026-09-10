import { Modal, PluginSettingTab, setIcon, type App } from "obsidian";
import { renderBadge } from "./badge";
import { BadgeForm } from "./badge-form";
import type { Badge, BadgePreset } from "./model";
import type SimpleBadgePlugin from "./main";
import type { Translations } from "./i18n";

export class PresetEditModal extends Modal {
  private form: BadgeForm | undefined;
  constructor(app: App, private readonly strings: Translations, private readonly preset: BadgePreset | undefined,
    private readonly save: (badge: Badge) => Promise<void>, private readonly closed: () => void) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("simple-badge-edit-modal");
    this.titleEl.setText(this.preset ? this.strings.editPreset : this.strings.newPreset);
    this.form = new BadgeForm(this.contentEl, this.strings, {
      initial: this.preset ? { ...this.preset, save: false } : undefined,
      submitLabel: this.strings.savePreset,
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
    const strings = this.owner.strings;
    this.unsubscribe?.();
    this.visible = true;
    this.containerEl.empty();
    this.containerEl.addClass("simple-badge-settings");
    this.containerEl.createEl("h2", { text: strings.presetBadges });
    this.containerEl.createEl("p", { cls: "simple-badge-muted", text: strings.presetDescription });
    const add = this.containerEl.createEl("button", { cls: "mod-cta", text: strings.addPreset, attr: { type: "button" } });
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
    const strings = this.owner.strings;
    if (!this.visible || !this.listEl) return;
    const presets = this.owner.presets.presets;
    this.listEl.empty();
    if (!presets.length) this.listEl.createEl("p", { cls: "simple-badge-muted", text: strings.emptyPresetsForSettings });
    presets.forEach((preset, index) => {
      const row = this.listEl!.createDiv({ cls: "simple-badge-settings-row" });
      renderBadge(row.createDiv({ cls: "simple-badge-preview" }), preset);
      const controls = row.createDiv({ cls: "simple-badge-settings-actions" });
      const up = controls.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": strings.moveUp(preset.text) } });
      setIcon(up, "arrow-up");
      up.disabled = this.busy || index === 0;
      up.addEventListener("click", () => { void this.runAction(() => this.owner.presets.move(preset.id, -1), strings.orderSaved); });
      const down = controls.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": strings.moveDown(preset.text) } });
      setIcon(down, "arrow-down");
      down.disabled = this.busy || index === presets.length - 1;
      down.addEventListener("click", () => { void this.runAction(() => this.owner.presets.move(preset.id, 1), strings.orderSaved); });
      const edit = controls.createEl("button", { text: strings.edit, attr: { type: "button", "aria-label": strings.editNamed(preset.text) } });
      edit.disabled = this.busy;
      edit.addEventListener("click", () => this.owner.openPresetEditor(preset));
      const remove = controls.createEl("button", { text: strings.delete, attr: { type: "button", "aria-label": strings.deleteNamed(preset.text) } });
      remove.disabled = this.busy;
      remove.addEventListener("click", () => { void this.runAction(() => this.owner.presets.remove(preset.id), strings.presetDeleted); });
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
        this.statusEl?.setText(error instanceof Error ? error.message : this.owner.strings.saveFailed);
      }
    } finally { this.busy = false; this.renderPresets(); }
  }
}
