import { Modal, PluginSettingTab, requireApiVersion, Setting, type App, type SettingDefinitionItem } from "obsidian";
import { renderBadge } from "./badge";
import { BadgeForm } from "./badge-form";
import { colorLabel, DEFAULT_BADGE_FONT_SIZE_PERCENT, MIN_BADGE_FONT_SIZE_PERCENT, MAX_BADGE_FONT_SIZE_PERCENT,
  validateFontSizePercent, validateCornerRoundness, type Badge, type BadgePreset } from "./model";
import type SimpleBadgePlugin from "./main";
import type { Translations } from "./i18n";
import { AppearanceControl } from "./appearance-control";

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
  private busy = false;
  private visible = false;
  private status = "";
  private statusIsError = false;
  private appearanceControls = new Set<AppearanceControl<number> | AppearanceControl<number | null>>();
  constructor(app: App, private readonly owner: SimpleBadgePlugin) {
    super(app, owner);
    // Keep the search index current even while this tab is hidden.
    owner.register(owner.presets.subscribe(change => { if (change === "presets") this.refresh(); }));
    const refreshAppearance = () => {
      for (const control of this.appearanceControls) {
        if (control.element.isConnected) control.refresh();
        else { control.destroy(); this.appearanceControls.delete(control); }
      }
    };
    owner.register(owner.fontSize.subscribe(refreshAppearance));
    owner.register(owner.roundness.subscribe(refreshAppearance));
  }

  // Obsidian 1.13+ renders and indexes these definitions instead of display().
  getSettingDefinitions(): SettingDefinitionItem[] {
    const strings = this.owner.strings;
    return [
      {
        type: "group", heading: strings.appearance,
        items: [{
          name: strings.badgeFontSize, desc: strings.badgeFontSizeDescription,
          aliases: ["badge", "font", "size", "scale", "%", "字号", "比例"],
          render: setting => this.renderAppearance(setting, "fontSize"),
        }, {
          name: strings.badgeCornerRoundness, desc: strings.badgeCornerRoundnessDescription,
          aliases: ["badge", "shape", "corner", "radius", "roundness", "pill", "圆角", "形状", "胶囊"],
          render: setting => this.renderAppearance(setting, "roundness"),
        }],
      },
      {
        type: "group", heading: strings.presetBadges,
        items: [{
          name: strings.addPreset, desc: strings.presetDescription, aliases: ["badge", "badges"],
          render: setting => this.renderAdd(setting),
        }, {
          name: strings.importPresets, desc: strings.importDescription, aliases: ["span", "HTML", "import", "badge"],
          render: setting => this.renderImport(setting),
        }],
      },
      {
        type: "list", emptyState: strings.emptyPresetsForSettings,
        items: this.owner.presets.presets.map(preset => ({
          name: preset.text, desc: colorLabel(preset.color, strings), aliases: [strings.presetBadges, "badge"],
          render: setting => this.renderPreset(setting, preset),
        })),
      },
      {
        name: this.owner.loadError ?? this.status, searchable: false,
        visible: () => !!(this.owner.loadError || this.status),
        render: setting => this.renderStatus(setting),
      },
    ];
  }

  // Older Obsidian versions use the same row renderers through display().
  display(): void {
    this.visible = true;
    this.renderLegacy();
  }
  hide(): void {
    this.visible = false;
    for (const control of this.appearanceControls) control.destroy();
    this.appearanceControls.clear();
    void this.owner.fontSize.flush();
    void this.owner.roundness.flush();
  }

  private renderLegacy(): void {
    const strings = this.owner.strings;
    this.containerEl.empty();
    new Setting(this.containerEl).setName(strings.appearance).setHeading();
    this.renderAppearance(new Setting(this.containerEl).setName(strings.badgeFontSize).setDesc(strings.badgeFontSizeDescription), "fontSize");
    this.renderAppearance(new Setting(this.containerEl).setName(strings.badgeCornerRoundness).setDesc(strings.badgeCornerRoundnessDescription), "roundness");
    new Setting(this.containerEl).setName(strings.presetBadges).setHeading();
    this.renderAdd(new Setting(this.containerEl).setName(strings.addPreset).setDesc(strings.presetDescription));
    this.renderImport(new Setting(this.containerEl).setName(strings.importPresets).setDesc(strings.importDescription));
    const presets = this.owner.presets.presets;
    if (!presets.length) this.containerEl.createEl("p", { cls: "simple-badge-muted", text: strings.emptyPresetsForSettings });
    for (const preset of presets) {
      this.renderPreset(new Setting(this.containerEl).setName(preset.text).setDesc(colorLabel(preset.color, strings)), preset);
    }
    if (this.owner.loadError || this.status) this.renderStatus(new Setting(this.containerEl).setName(this.owner.loadError ?? this.status));
  }

  private renderAdd(setting: Setting): void {
    setting.addButton(button => button.setButtonText(this.owner.strings.addPreset).setCta()
      .setDisabled(this.busy || !!this.owner.loadError).onClick(() => this.owner.openPresetEditor()));
  }

  private renderAppearance(setting: Setting, kind: "fontSize" | "roundness"): () => void {
    // Obsidian's separate settings window is not a workspace leaf.
    this.owner.appearance.attach(setting.settingEl.ownerDocument);
    for (const control of this.appearanceControls) {
      if (!control.element.isConnected || control.element === setting.settingEl) {
        control.destroy();
        this.appearanceControls.delete(control);
      }
    }
    const strings = this.owner.strings;
    const disabled = !!this.owner.loadError;
    const control = kind === "fontSize"
      ? new AppearanceControl(setting, this.owner.fontSize, strings, {
        className: "simple-badge-font-size", min: MIN_BADGE_FONT_SIZE_PERCENT, max: MAX_BADGE_FONT_SIZE_PERCENT,
        defaultValue: DEFAULT_BADGE_FONT_SIZE_PERCENT, validate: value => validateFontSizePercent(value, strings),
        label: strings.badgeFontSize, inputLabel: strings.badgeFontSizeInput, resetLabel: strings.resetFontSize,
        savedMessage: strings.fontSizeSaved,
      }, disabled)
      : new AppearanceControl(setting, this.owner.roundness, strings, {
        className: "simple-badge-roundness", min: 0, max: 100,
        defaultValue: null, validate: value => validateCornerRoundness(value, strings),
        label: strings.badgeCornerRoundness, inputLabel: strings.badgeCornerRoundnessInput, resetLabel: strings.resetCornerRoundness,
        savedMessage: strings.cornerRoundnessSaved, originalCorners: true, preview: true,
      }, disabled);
    this.appearanceControls.add(control);
    return () => {
      control.destroy();
      this.appearanceControls.delete(control);
    };
  }

  private renderImport(setting: Setting): void {
    setting.addButton(button => button.setButtonText(this.owner.strings.importAction)
      .setDisabled(this.busy || !!this.owner.loadError).onClick(() => this.owner.openPresetImporter()));
  }

  private renderPreset(setting: Setting, preset: BadgePreset): void {
    this.owner.appearance.attach(setting.settingEl.ownerDocument);
    const strings = this.owner.strings;
    const presets = this.owner.presets.presets;
    const index = presets.findIndex(item => item.id === preset.id);
    const disabled = this.busy || index < 0 || !!this.owner.loadError;
    setting.nameEl.empty();
    renderBadge(setting.nameEl, preset);
    setting.addExtraButton(button => button.setIcon("arrow-up").setTooltip(strings.moveUp(preset.text))
      .setDisabled(disabled || index === 0)
      .onClick(() => { void this.runAction(() => this.owner.presets.move(preset.id, -1), strings.orderSaved); }));
    setting.addExtraButton(button => button.setIcon("arrow-down").setTooltip(strings.moveDown(preset.text))
      .setDisabled(disabled || index === presets.length - 1)
      .onClick(() => { void this.runAction(() => this.owner.presets.move(preset.id, 1), strings.orderSaved); }));
    setting.addButton(button => {
      button.setButtonText(strings.edit).setDisabled(disabled).onClick(() => this.owner.openPresetEditor(preset));
      button.buttonEl.setAttr("aria-label", strings.editNamed(preset.text));
    });
    setting.addButton(button => {
      button.setButtonText(strings.delete).setDisabled(disabled)
        .onClick(() => { void this.runAction(() => this.owner.presets.remove(preset.id), strings.presetDeleted); });
      button.buttonEl.setAttr("aria-label", strings.deleteNamed(preset.text));
    });
  }

  private renderStatus(setting: Setting): void {
    setting.setClass("simple-badge-message");
    const isError = !!this.owner.loadError || this.statusIsError;
    setting.settingEl.toggleClass("is-error", isError);
    setting.settingEl.setAttr("role", isError ? "alert" : "status");
    setting.settingEl.setAttr("aria-live", "polite");
  }

  private refresh(): void {
    if (requireApiVersion("1.13.0")) this.update();
    else if (this.visible) this.renderLegacy();
  }

  private async runAction(action: () => Promise<void>, success: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.refresh();
    try {
      await action();
      this.statusIsError = false;
      this.status = success;
    } catch (error) {
      this.statusIsError = true;
      this.status = error instanceof Error ? error.message : this.owner.strings.saveFailed;
    } finally { this.busy = false; this.refresh(); }
  }
}
