import { renderBadge } from "./badge";
import { normalizeBadge, type BadgeDraft } from "./model";
import { BadgeColorPicker } from "./color-picker";
import type { Translations } from "./i18n";

interface BadgeFormOptions {
  initial?: BadgeDraft;
  allowSaveOption?: boolean;
  submitLabel: string;
  resetOnSuccess?: boolean;
  onSubmit(draft: BadgeDraft): Promise<string | void>;
  onBusyChange?(busy: boolean): void;
}

export class BadgeForm {
  private readonly formEl: HTMLFormElement;
  private readonly fields: HTMLFieldSetElement;
  private readonly input: HTMLInputElement;
  private readonly saveInput: HTMLInputElement | undefined;
  private readonly preview: HTMLElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly colorPicker: BadgeColorPicker;
  private busy = false;
  private destroyed = false;

  constructor(container: HTMLElement, private readonly strings: Translations, private readonly options: BadgeFormOptions) {
    this.formEl = container.createEl("form", { cls: "simple-badge-form" });
    this.fields = this.formEl.createEl("fieldset");
    const label = this.fields.createEl("label", { cls: "simple-badge-field", text: strings.text });
    this.input = label.createEl("input", { type: "text", placeholder: strings.placeholder });
    this.input.value = options.initial?.text ?? "";
    this.input.required = true;
    this.input.autocomplete = "off";
    this.input.addEventListener("input", () => { this.status.empty(); this.refresh(); });

    this.fields.createDiv({ cls: "simple-badge-field-label", text: strings.color });
    this.colorPicker = new BadgeColorPicker(this.fields, strings, options.initial?.color ?? "blue",
      () => { this.status.empty(); this.refresh(); }, options.initial?.customColorInput);
    const previewRow = this.fields.createDiv({ cls: "simple-badge-form-preview" });
    previewRow.createSpan({ cls: "simple-badge-muted", text: strings.preview });
    this.preview = previewRow.createSpan({ cls: "simple-badge-preview" });

    if (options.allowSaveOption) {
      const saveLabel = this.fields.createEl("label", { cls: "simple-badge-save-option" });
      this.saveInput = saveLabel.createEl("input", { type: "checkbox" });
      this.saveInput.checked = options.initial?.save ?? false;
      saveLabel.createSpan({ text: strings.saveAsPreset });
      this.saveInput.addEventListener("change", () => this.refresh());
    }
    this.submitButton = this.fields.createEl("button", { attr: { type: "submit" } });
    this.status = this.formEl.createDiv({ cls: "simple-badge-form-status", attr: { role: "status", "aria-live": "polite" } });
    this.formEl.addEventListener("submit", event => { event.preventDefault(); void this.submit(); });
    this.refresh();
  }

  get draft(): BadgeDraft {
    return { text: this.input.value, color: this.colorPicker.value, save: this.saveInput?.checked ?? false,
      customColorInput: this.colorPicker.customInput };
  }
  focus(): void { this.input.focus(); }
  destroy(): void { this.destroyed = true; }

  private refresh(): void {
    const draft = this.draft;
    this.preview.empty();
    renderBadge(this.preview, { text: draft.text.trim() || "Badge", color: draft.color });
    this.fields.disabled = this.busy;
    this.submitButton.disabled = this.busy || !draft.text.trim() || !this.colorPicker.isValid;
    this.submitButton.setText(this.busy ? this.strings.saving : draft.save ? this.strings.addAndSave : this.options.submitLabel);
  }

  private async submit(): Promise<void> {
    if (this.busy || this.destroyed || !this.colorPicker.validate()) return;
    try {
      const draft = { ...normalizeBadge(this.draft, this.strings), save: this.draft.save };
      this.busy = true;
      this.status.empty();
      this.status.removeClass("is-error");
      this.options.onBusyChange?.(true);
      this.refresh();
      const message = await this.options.onSubmit(draft);
      if (this.destroyed) return;
      if (this.options.resetOnSuccess) this.input.value = "";
      this.status.setText(message ?? "");
    } catch (error) {
      if (!this.destroyed) {
        this.status.addClass("is-error");
        this.status.setText(error instanceof Error ? error.message : this.strings.saveFailed);
      }
    } finally {
      this.busy = false;
      if (!this.destroyed) {
        this.options.onBusyChange?.(false);
        this.refresh();
      }
    }
  }
}
