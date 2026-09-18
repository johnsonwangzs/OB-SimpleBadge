import { requireApiVersion, type DropdownComponent, type Setting, type SliderComponent } from "obsidian";
import { renderBadge } from "./badge";
import type { AppearanceValue } from "./appearance";
import { createId, DEFAULT_CUSTOM_ROUNDNESS_PERCENT } from "./model";
import type { Translations } from "./i18n";

interface ControlOptions<T> {
  className: string;
  min: number;
  max: number;
  defaultValue: T;
  validate(value: unknown): T;
  label: string;
  inputLabel: string;
  resetLabel: string;
  savedMessage: string;
  preview?: boolean;
  originalCorners?: boolean;
}

/** Refresh only this row, preserving focus and incomplete numeric input. */
export class AppearanceControl<T extends number | null> {
  readonly element: HTMLElement;
  private input!: HTMLInputElement;
  private slider!: SliderComponent;
  private mode: DropdownComponent | undefined;
  private status: HTMLElement;
  private preview: HTMLElement | undefined;
  private lastValue: T;
  private validationError = "";
  private showValidation = false;
  private interacted = false;
  private refreshing = false;

  constructor(setting: Setting, private readonly value: AppearanceValue<T>, private readonly strings: Translations,
    private readonly options: ControlOptions<T>, disabled: boolean) {
    this.element = setting.settingEl;
    this.lastValue = value.value;
    setting.setClass("simple-badge-appearance-control").setClass(options.className);
    const statusId = `simple-badge-appearance-status-${createId()}`;
    this.status = setting.infoEl.createDiv({ cls: "simple-badge-message", attr: { id: statusId, role: "status", "aria-live": "polite" } });
    if (options.preview) {
      this.preview = setting.infoEl.createDiv({ cls: "simple-badge-appearance-preview simple-badge-preview", attr: { "aria-label": strings.preview } });
      renderBadge(this.preview, { text: strings.defaults.blue, color: "blue" });
      renderBadge(this.preview, { text: strings.defaults.red, color: "#e67e22" });
    }
    if (options.originalCorners) {
      setting.addDropdown(mode => {
        this.mode = mode.addOption("original", strings.originalCorners).addOption("custom", strings.customCorners)
          .setValue(value.value === null ? "original" : "custom")
          .setDisabled(disabled).onChange(mode => {
            if (this.refreshing) return;
            this.use(mode === "original" ? options.defaultValue : options.validate(DEFAULT_CUSTOM_ROUNDNESS_PERCENT));
            void value.flush();
          });
        mode.selectEl.setAttr("aria-label", strings.cornerMode);
        mode.selectEl.setAttr("aria-describedby", statusId);
      });
    }
    setting.addSlider(slider => {
      this.slider = slider.setLimits(options.min, options.max, 1).setInstant(true).setValue(value.value ?? DEFAULT_CUSTOM_ROUNDNESS_PERCENT)
        .setDisabled(disabled).onChange(raw => {
          if (!this.refreshing) this.use(options.validate(raw));
        });
      // Obsidian 1.13+ also shows an inline value outside sliderEl.
      if (requireApiVersion("1.13.0")) {
        if (options.originalCorners) slider.setDisplayFormat(raw => value.value === null ? "" : `${raw}%`);
      }
      slider.sliderEl.setAttr("aria-label", options.label);
      slider.sliderEl.setAttr("aria-describedby", statusId);
      slider.sliderEl.addClass("simple-badge-percentage");
      slider.sliderEl.addEventListener("change", () => { void value.flush(); });
    });
    setting.addText(text => {
      this.input = text.setValue(value.value === null ? "" : String(value.value)).setDisabled(disabled).inputEl;
      this.input.type = "number";
      this.input.min = String(options.min);
      this.input.max = String(options.max);
      this.input.step = "1";
      this.input.addClass("simple-badge-percentage");
      this.input.setAttr("aria-label", options.inputLabel);
      this.input.setAttr("aria-describedby", statusId);
      this.input.addEventListener("input", () => {
        this.showValidation = false;
        try { this.use(options.validate(this.input.valueAsNumber)); }
        catch (error) {
          this.validationError = error instanceof Error ? error.message : strings.saveFailed;
          this.refresh();
        }
      });
      const commit = () => {
        this.showValidation = true;
        this.refresh();
        if (!this.validationError) void value.flush();
      };
      this.input.addEventListener("blur", commit);
      this.input.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
      });
    });
    setting.controlEl.createSpan({ cls: "simple-badge-percentage", text: "%", attr: { "aria-hidden": "true" } });
    setting.addExtraButton(button => button.setIcon("reset").setTooltip(options.resetLabel).setDisabled(disabled)
      .onClick(() => { this.use(options.defaultValue); void value.flush(); }));
    this.refresh();
  }

  refresh(): void {
    const current = this.value.value;
    if (current !== this.lastValue) {
      this.input.value = current === null ? "" : String(current);
      this.validationError = "";
      this.lastValue = current;
    }
    this.element.toggleClass("simple-badge-original-corners", current === null);
    // Some host components invoke onChange even for programmatic setValue calls.
    this.refreshing = true;
    try {
      this.mode?.setValue(current === null ? "original" : "custom");
      this.slider.setValue(current ?? DEFAULT_CUSTOM_ROUNDNESS_PERCENT);
    } finally { this.refreshing = false; }
    this.slider.sliderEl.setAttr("aria-valuetext", current === null ? this.strings.originalCorners : `${current}%`);
    this.input.setAttr("aria-invalid", String(!!this.validationError));
    const error = this.validationError && this.showValidation ? this.validationError : this.value.error;
    this.status.setText(error || (this.value.saving ? this.strings.saving : this.interacted ? this.options.savedMessage : ""));
    this.status.toggleClass("is-error", !!error);
  }

  destroy(): void {
    // Obsidian clears its controls but retains custom infoEl children when reusing a row.
    this.status.remove();
    this.preview?.remove();
  }

  private use(value: T): void {
    this.validationError = "";
    this.showValidation = false;
    this.interacted = true;
    this.input.value = value === null ? "" : String(value);
    this.value.set(value);
    this.refresh();
  }
}
