import { ColorComponent } from "obsidian";
import { BADGE_COLORS, createId, isThemeColor, normalizeHexColor, type BadgeColor, type CustomBadgeColor, type ThemeBadgeColor } from "./model";
import type { Translations } from "./i18n";

/** Keeps incomplete HEX input separate from the last valid preview color. */
export class BadgeColorPicker {
  private readonly themeButton: HTMLButtonElement;
  private readonly customButton: HTMLButtonElement;
  private readonly palette: HTMLElement;
  private readonly customRow: HTMLElement;
  private readonly hexInput: HTMLInputElement;
  private readonly picker: ColorComponent;
  private readonly hint: HTMLElement;
  private readonly error: HTMLElement;
  private readonly buttons = new Map<ThemeBadgeColor, HTMLButtonElement>();
  private customMode: boolean;
  private themeColor: ThemeBadgeColor;
  private customColor: CustomBadgeColor;

  constructor(container: HTMLElement, private readonly strings: Translations, initial: BadgeColor,
    private readonly onChange: () => void, customInput?: string) {
    this.customMode = !isThemeColor(initial);
    this.themeColor = isThemeColor(initial) ? initial : "blue";
    this.customColor = normalizeHexColor(initial) ?? "#e67e22";
    const root = container.createDiv({ cls: "simple-badge-color-picker" });
    const modes = root.createDiv({ cls: "simple-badge-color-modes", attr: { role: "group", "aria-label": strings.badgeColor } });
    this.themeButton = modes.createEl("button", { text: strings.themeColors, attr: { type: "button" } });
    this.customButton = modes.createEl("button", { text: strings.customColor, attr: { type: "button" } });
    this.themeButton.addEventListener("click", () => this.setMode(false));
    this.customButton.addEventListener("click", () => this.setMode(true));

    this.palette = root.createDiv({ cls: "simple-badge-colors", attr: { role: "group", "aria-label": strings.themeColors } });
    for (const { id } of BADGE_COLORS) {
      const button = this.palette.createEl("button", { attr: { type: "button", "aria-label": strings.colors[id] } });
      button.createSpan({ cls: `simple-badge-color-swatch badge-${id}`, attr: { "aria-hidden": "true" } });
      button.createSpan({ text: strings.colors[id] });
      button.createSpan({ cls: "simple-badge-color-check", text: "✓", attr: { "aria-hidden": "true" } });
      button.addEventListener("click", () => { this.themeColor = id; this.refresh(); this.onChange(); });
      this.buttons.set(id, button);
    }

    this.customRow = root.createDiv({ cls: "simple-badge-custom-color" });
    const pickerLabel = this.customRow.createEl("label", { cls: "simple-badge-native-color" });
    pickerLabel.createSpan({ text: strings.pickColor, cls: "simple-badge-visually-hidden" });
    this.picker = new ColorComponent(pickerLabel).setValue(this.customColor);
    // Native events distinguish user input from setValue(), which also calls ColorComponent.onChange.
    const updateFromPicker = () => this.usePickedColor(this.picker.getValue());
    pickerLabel.addEventListener("input", updateFromPicker);
    pickerLabel.addEventListener("change", updateFromPicker);
    const hexLabel = this.customRow.createEl("label", { cls: "simple-badge-hex-field" });
    hexLabel.createSpan({ text: strings.hexColor, cls: "simple-badge-visually-hidden" });
    this.hexInput = hexLabel.createEl("input", { type: "text", placeholder: "#e67e22" });
    this.hexInput.value = this.customMode ? customInput ?? this.customColor : this.customColor;
    this.hexInput.autocomplete = "off";
    this.hexInput.spellcheck = false;
    this.hexInput.addEventListener("input", () => {
      const color = normalizeHexColor(this.hexInput.value);
      if (color) { this.customColor = color; this.picker.setValue(color); }
      this.clearError();
      this.onChange();
    });
    this.hexInput.addEventListener("blur", () => {
      const color = normalizeHexColor(this.hexInput.value);
      if (color) this.hexInput.value = color;
      else if (this.customMode) this.showError();
    });
    const hintId = `simple-badge-color-hint-${createId()}`;
    const errorId = `simple-badge-color-error-${createId()}`;
    this.hint = root.createDiv({ cls: "simple-badge-muted", attr: { id: hintId } });
    this.error = root.createDiv({ cls: "simple-badge-color-error", attr: { id: errorId, role: "status", "aria-live": "polite" } });
    this.hexInput.setAttr("aria-describedby", `${hintId} ${errorId}`);
    this.refresh();
  }

  get value(): BadgeColor { return this.customMode ? this.customColor : this.themeColor; }
  get customInput(): string | undefined { return this.customMode ? this.hexInput.value : undefined; }
  get isValid(): boolean { return !this.customMode || normalizeHexColor(this.hexInput.value) !== undefined; }

  validate(): boolean {
    if (this.isValid) return true;
    this.showError();
    this.hexInput.focus();
    return false;
  }

  private setMode(custom: boolean): void {
    this.customMode = custom;
    this.clearError();
    this.refresh();
    this.onChange();
  }

  private usePickedColor(value: string): void {
    const color = normalizeHexColor(value);
    if (!color) return;
    this.customColor = color;
    this.hexInput.value = color;
    this.clearError();
    this.onChange();
  }

  private refresh(): void {
    this.themeButton.setAttr("aria-pressed", String(!this.customMode));
    this.customButton.setAttr("aria-pressed", String(this.customMode));
    this.palette.hidden = this.customMode;
    this.customRow.hidden = !this.customMode;
    for (const [color, button] of this.buttons) button.setAttr("aria-pressed", String(color === this.themeColor));
    this.hint.setText(this.customMode ? this.strings.customColorHint : this.strings.themeColorHint);
  }

  private clearError(): void { this.error.empty(); this.hexInput.removeAttribute("aria-invalid"); }
  private showError(): void {
    this.error.setText(this.strings.invalidHexColor);
    this.hexInput.setAttr("aria-invalid", "true");
  }
}
