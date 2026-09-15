import { Modal, Notice, type App } from "obsidian";
import { renderBadge } from "./badge";
import { createId, planPresetImport, type Badge } from "./model";
import type { ImportResult, PresetStore } from "./preset-store";
import { parseBadgeSpans } from "./span-import";

export class PresetImportModal extends Modal {
  private input!: HTMLTextAreaElement;
  private preview!: HTMLElement;
  private summary!: HTMLElement;
  private error!: HTMLElement;
  private addButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;
  private badges: Badge[] = [];
  private unsubscribe: (() => void) | undefined;
  private busy = false;
  private opened = false;

  constructor(app: App, private readonly store: PresetStore,
    private readonly save: (badges: readonly Badge[]) => Promise<ImportResult>, private readonly closed: () => void) { super(app); }

  onOpen(): void {
    this.opened = true;
    const strings = this.store.strings;
    this.modalEl.addClass("simple-badge-import-modal");
    this.titleEl.setText(strings.importPresets);
    const hintId = `simple-badge-import-hint-${createId()}`;
    const errorId = `simple-badge-import-error-${createId()}`;
    this.contentEl.createEl("p", { text: strings.importHint, cls: "simple-badge-muted", attr: { id: hintId } });
    const label = this.contentEl.createEl("label", { text: strings.spanCode, cls: "simple-badge-field" });
    this.input = label.createEl("textarea", { cls: "simple-badge-span-input", attr: { "aria-describedby": `${hintId} ${errorId}` } });
    this.input.rows = 7;
    this.input.spellcheck = false;
    this.input.placeholder = strings.importPlaceholder;
    this.input.addEventListener("input", () => this.validateInput());
    this.summary = this.contentEl.createDiv({ cls: "simple-badge-muted", attr: { role: "status", "aria-live": "polite" } });
    this.preview = this.contentEl.createDiv({ cls: "simple-badge-import-preview", attr: { "aria-label": strings.preview } });
    this.error = this.contentEl.createDiv({ cls: "simple-badge-message is-error", attr: { id: errorId, role: "status", "aria-live": "polite" } });
    const footer = this.contentEl.createDiv({ cls: "simple-badge-footer" });
    this.cancelButton = footer.createEl("button", { text: strings.cancel, attr: { type: "button" } });
    this.cancelButton.addEventListener("click", () => this.close());
    this.addButton = footer.createEl("button", { text: strings.importAction, cls: "mod-cta", attr: { type: "button" } });
    this.addButton.addEventListener("click", () => { void this.submit(); });
    this.unsubscribe = this.store.subscribe(change => { if (change === "presets") this.renderPreview(); });
    this.renderPreview();
    this.input.focus();
  }

  onClose(): void {
    this.opened = false;
    this.unsubscribe?.();
    this.contentEl.empty();
    this.closed();
  }

  private validateInput(): void {
    this.badges = [];
    this.error.empty();
    this.input.removeAttribute("aria-invalid");
    if (this.input.value.trim()) {
      try { this.badges = parseBadgeSpans(this.input.value, this.store.strings); }
      catch (error) {
        this.error.setText(error instanceof Error ? error.message : this.store.strings.importSyntax);
        this.input.setAttr("aria-invalid", "true");
      }
    }
    this.renderPreview();
  }

  private renderPreview(): void {
    if (!this.opened) return;
    const { newBadges, skipped } = planPresetImport(this.badges, this.store.presets);
    this.summary.setText(this.badges.length ? this.store.strings.importSummary(newBadges.length, skipped) : "");
    this.preview.empty();
    for (const badge of newBadges) renderBadge(this.preview, badge);
    this.input.disabled = this.busy;
    this.cancelButton.disabled = this.busy;
    this.addButton.disabled = this.busy || !newBadges.length;
    this.addButton.setText(this.busy ? this.store.strings.saving : this.store.strings.importAction);
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.opened || !this.badges.length) return;
    this.busy = true;
    this.error.empty();
    this.renderPreview();
    try {
      const result = await this.save(this.badges);
      if (!this.opened) return;
      new Notice(this.store.strings.importSuccess(result.added, result.skipped));
      this.close();
    } catch (error) {
      if (this.opened) this.error.setText(error instanceof Error ? error.message : this.store.strings.saveFailed);
    } finally { this.busy = false; this.renderPreview(); }
  }
}
