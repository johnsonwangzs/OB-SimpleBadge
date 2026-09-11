import { Modal, type App } from "obsidian";
import { renderBadge } from "./badge";
import { BadgeForm } from "./badge-form";
import { OrderedBadges, colorLabel, createId, sameBadge, type BadgePreset, type InsertSession } from "./model";
import type { PresetStore } from "./preset-store";

interface InsertCallbacks {
  isTargetValid(): boolean;
  insert(badges: BadgePreset[]): void;
  relocate(session: InsertSession): void;
  close(): void;
}

export class BadgeInsertModal extends Modal {
  private presets: BadgePreset[];
  private readonly selected: OrderedBadges;
  private form: BadgeForm | undefined;
  private listEl!: HTMLElement;
  private queueEl!: HTMLElement;
  private countEl!: HTMLElement;
  private insertButton!: HTMLButtonElement;
  private errorEl!: HTMLElement;
  private relocateButton!: HTMLButtonElement;
  private presetButtons = new Map<string, HTMLButtonElement>();
  private opened = false;
  private busy = false;

  constructor(app: App, private readonly store: PresetStore, private readonly callbacks: InsertCallbacks,
    private readonly session?: InsertSession) {
    super(app);
    this.shouldRestoreSelection = false;
    this.presets = session?.presets.map(item => ({ ...item })) ?? store.presets;
    this.selected = new OrderedBadges(session?.selected);
  }

  onOpen(): void {
    const strings = this.store.strings;
    this.opened = true;
    this.modalEl.addClass("simple-badge-modal");
    this.titleEl.setText(strings.insertBadge);
    const main = this.contentEl.createDiv({ cls: "simple-badge-insert-main" });
    const presets = main.createDiv();
    presets.createEl("h3", { text: strings.presetBadges });
    this.listEl = presets.createDiv({ cls: "simple-badge-preset-list" });
    const create = main.createDiv();
    create.createEl("h3", { text: strings.createBadge });

    const selection = this.contentEl.createDiv({ cls: "simple-badge-selection" });
    const selectionHeading = selection.createDiv({ cls: "simple-badge-selection-heading" });
    selectionHeading.createSpan({ text: strings.insertionOrder });
    this.countEl = selectionHeading.createSpan({ cls: "simple-badge-muted", attr: { "aria-live": "polite" } });
    this.queueEl = selection.createDiv({ cls: "simple-badge-queue" });
    this.errorEl = this.contentEl.createDiv({ cls: "simple-badge-message is-error", attr: { role: "alert" } });
    const footer = this.contentEl.createDiv({ cls: "simple-badge-footer" });
    this.relocateButton = footer.createEl("button", { text: strings.chooseNewPosition, attr: { type: "button" } });
    this.relocateButton.hidden = true;
    this.relocateButton.addEventListener("click", () => {
      this.callbacks.relocate({ presets: this.presets.map(item => ({ ...item })), selected: this.selected.values,
        draft: this.form?.draft ?? { text: "", color: "blue", save: false } });
      this.close();
    });
    footer.createEl("button", { text: strings.cancel, attr: { type: "button" } }).addEventListener("click", () => this.close());
    this.insertButton = footer.createEl("button", { text: strings.insertSelected, cls: "mod-cta", attr: { type: "button" } });
    this.insertButton.addEventListener("click", () => this.insert());

    this.form = new BadgeForm(create, strings, {
      initial: this.session?.draft,
      allowSaveOption: true,
      submitLabel: strings.addToSelection,
      resetOnSuccess: true,
      onBusyChange: busy => { this.busy = busy; this.renderSelection(); },
      onSubmit: async draft => {
        let preset: BadgePreset;
        if (draft.save) {
          preset = await this.store.add(draft);
          if (!this.opened) return;
          const index = this.presets.findIndex(item => item.id === preset.id);
          if (index < 0) this.presets.push(preset);
          else this.presets[index] = preset;
        } else {
          preset = this.presets.find(item => sameBadge(item, draft))
            ?? this.selected.values.find(item => sameBadge(item, draft))
            ?? { id: createId(), text: draft.text, color: draft.color };
        }
        this.selected.add(preset);
        this.renderSelection();
        return draft.save ? strings.addedAndSaved : strings.added;
      },
    });
    this.renderSelection();
    const first = this.presetButtons.values().next().value;
    if (first) first.focus();
    else this.form.focus();
  }

  onClose(): void {
    this.opened = false;
    this.form?.destroy();
    this.contentEl.empty();
    this.callbacks.close();
  }

  private renderSelection(): void {
    const strings = this.store.strings;
    this.listEl.empty();
    this.presetButtons.clear();
    if (!this.presets.length) this.listEl.createDiv({ cls: "simple-badge-muted", text: strings.emptyPresetsForInsert });
    for (const preset of this.presets) {
      const row = this.listEl.createDiv({ cls: "simple-badge-preset-row" });
      const index = this.selected.indexOf(preset.id);
      const color = colorLabel(preset.color, strings);
      const button = row.createEl("button", { cls: "simple-badge-number", text: index < 0 ? "" : String(index + 1),
        attr: { type: "button", "aria-pressed": String(index >= 0), "aria-label":
          index < 0 ? strings.selectBadge(color, preset.text) : strings.deselectBadge(color, preset.text, index + 1) } });
      button.disabled = this.busy;
      button.addEventListener("click", () => {
        this.selected.toggle(preset);
        this.renderSelection();
        this.presetButtons.get(preset.id)?.focus();
      });
      this.presetButtons.set(preset.id, button);
      renderBadge(row.createSpan({ cls: "simple-badge-preview" }), preset);
    }

    this.queueEl.empty();
    this.countEl.setText(strings.selectionCount(this.selected.size));
    if (!this.selected.size) this.queueEl.createSpan({ cls: "simple-badge-muted", text: strings.noSelection });
    this.selected.values.forEach((preset, index) => {
      const chip = this.queueEl.createEl("button", { cls: "simple-badge-chip", attr: {
        type: "button", "aria-label": strings.removeSelected(index + 1, preset.text) } });
      chip.disabled = this.busy;
      chip.createSpan({ text: String(index + 1) });
      renderBadge(chip.createSpan({ cls: "simple-badge-preview" }), preset);
      if (!this.presets.some(item => item.id === preset.id)) chip.createSpan({ cls: "simple-badge-muted", text: strings.temporary });
      chip.createSpan({ text: "×", attr: { "aria-hidden": "true" } });
      chip.addEventListener("click", () => {
        this.selected.remove(preset.id);
        this.renderSelection();
        const remaining = this.queueEl.querySelectorAll("button");
        (remaining[Math.min(index, remaining.length - 1)] ?? this.presetButtons.values().next().value)?.focus();
      });
    });
    this.refreshInsertButton();
  }

  private refreshInsertButton(): void {
    this.insertButton.disabled = this.busy || !this.selected.size;
    this.relocateButton.disabled = this.busy;
  }

  private insert(): void {
    if (this.busy || !this.selected.size || !this.opened) return;
    if (!this.callbacks.isTargetValid()) {
      this.errorEl.setText(this.store.strings.positionChanged);
      this.relocateButton.hidden = false;
      return;
    }
    const badges = this.selected.values;
    this.close();
    this.callbacks.insert(badges);
  }
}
