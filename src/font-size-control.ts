import type { Setting, SliderComponent } from "obsidian";
import { renderBadge } from "./badge";
import type { BadgeFontSize } from "./appearance";
import { createId, DEFAULT_BADGE_FONT_SIZE_PERCENT, MAX_BADGE_FONT_SIZE_PERCENT, MIN_BADGE_FONT_SIZE_PERCENT, validateFontSizePercent } from "./model";
import type { Translations } from "./i18n";

/** Refreshes only this row, keeping focus and incomplete numeric input intact. */
export class FontSizeControl {
  readonly element: HTMLElement;
  private input!: HTMLInputElement;
  private slider!: SliderComponent;
  private status: HTMLElement;
  private preview: HTMLElement;
  private lastValue: number;
  private invalid = false;
  private showValidation = false;
  private interacted = false;

  constructor(setting: Setting, private readonly fontSize: BadgeFontSize, private readonly strings: Translations, disabled: boolean) {
    this.element = setting.settingEl;
    this.lastValue = fontSize.value;
    setting.setClass("simple-badge-font-size");
    const statusId = `simple-badge-font-size-status-${createId()}`;
    this.status = setting.infoEl.createDiv({ cls: "simple-badge-message", attr: { id: statusId, role: "status", "aria-live": "polite" } });
    this.preview = setting.infoEl.createDiv({ cls: "simple-badge-font-size-preview simple-badge-preview", attr: { "aria-label": strings.preview } });
    renderBadge(this.preview, { text: strings.defaults.blue, color: "blue" });
    renderBadge(this.preview, { text: strings.defaults.red, color: "#e67e22" });
    setting.addSlider(slider => {
      this.slider = slider.setLimits(MIN_BADGE_FONT_SIZE_PERCENT, MAX_BADGE_FONT_SIZE_PERCENT, 1)
        .setValue(fontSize.value).setDisabled(disabled).onChange(value => this.use(value));
      slider.sliderEl.setAttr("aria-label", strings.badgeFontSize);
      slider.sliderEl.setAttr("aria-describedby", statusId);
      slider.sliderEl.addEventListener("change", () => { void fontSize.flush(); });
    });
    setting.addText(text => {
      this.input = text.setValue(String(fontSize.value)).setDisabled(disabled).inputEl;
      this.input.type = "number";
      this.input.min = String(MIN_BADGE_FONT_SIZE_PERCENT);
      this.input.max = String(MAX_BADGE_FONT_SIZE_PERCENT);
      this.input.step = "1";
      this.input.setAttr("aria-label", strings.badgeFontSizeInput);
      this.input.setAttr("aria-describedby", statusId);
      this.input.addEventListener("input", () => {
        this.showValidation = false;
        try { this.use(validateFontSizePercent(this.input.valueAsNumber, strings)); }
        catch { this.invalid = true; this.refresh(); }
      });
      const commit = () => {
        this.showValidation = true;
        this.refresh();
        if (!this.invalid) void fontSize.flush();
      };
      this.input.addEventListener("blur", commit);
      this.input.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
      });
    });
    setting.controlEl.createSpan({ text: "%", attr: { "aria-hidden": "true" } });
    setting.addExtraButton(button => button.setIcon("reset").setTooltip(strings.resetFontSize).setDisabled(disabled)
      .onClick(() => { this.use(DEFAULT_BADGE_FONT_SIZE_PERCENT); void fontSize.flush(); }));
    this.refresh();
  }

  refresh(): void {
    if (this.fontSize.value !== this.lastValue) {
      this.input.value = String(this.fontSize.value);
      this.invalid = false;
      this.lastValue = this.fontSize.value;
    }
    this.slider.setValue(this.fontSize.value);
    this.slider.sliderEl.setAttr("aria-valuetext", `${this.fontSize.value}%`);
    this.input.setAttr("aria-invalid", String(this.invalid));
    const error = this.invalid && this.showValidation ? this.strings.invalidFontSize : this.fontSize.error;
    this.status.setText(error || (this.fontSize.saving ? this.strings.saving : this.interacted ? this.strings.fontSizeSaved : ""));
    this.status.toggleClass("is-error", !!error);
  }

  destroy(): void {
    // The host clears its controls, but retains custom children of infoEl on rerender.
    this.status.remove();
    this.preview.remove();
  }

  private use(value: number): void {
    this.invalid = false;
    this.showValidation = false;
    this.interacted = true;
    this.input.value = String(value);
    this.fontSize.set(value);
    this.refresh();
  }
}
