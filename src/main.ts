import { getLanguage, MarkdownView, Notice, Plugin, type Editor } from "obsidian";
import { insertBadges } from "./badge";
import { BadgeInsertModal } from "./insert-modal";
import { PresetStore } from "./preset-store";
import { PresetEditModal, SimpleBadgeSettingTab } from "./settings";
import type { BadgePreset, InsertSession } from "./model";
import { getTranslations } from "./i18n";

export default class SimpleBadgePlugin extends Plugin {
  presets!: PresetStore;
  strings = getTranslations();
  loadError: string | undefined;
  private revisions = new WeakMap<Editor, number>();
  private insertModal: BadgeInsertModal | undefined;
  private settingsTab: SimpleBadgeSettingTab | undefined;
  private editModals = new Set<PresetEditModal>();
  private pendingSession: InsertSession | undefined;
  private active = false;

  async onload(): Promise<void> {
    // getLanguage was added in Obsidian 1.8.7; older versions use English.
    this.strings = getTranslations(typeof getLanguage === "function" ? getLanguage() : "en");
    this.presets = new PresetStore({ load: () => this.loadData(), save: data => this.saveData(data) }, this.strings);
    try { await this.presets.load(); }
    catch (error) {
      this.loadError = error instanceof Error ? error.message : this.strings.loadFailed;
      new Notice(`Simple Badge: ${this.loadError}`);
    }
    this.active = true;
    this.settingsTab = new SimpleBadgeSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.registerEvent(this.app.workspace.on("editor-change", (editor) => {
      this.revisions.set(editor, (this.revisions.get(editor) ?? 0) + 1);
    }));

    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      if (!(info instanceof MarkdownView) || info.getMode() !== "source" || info.file?.extension !== "md") {
        return;
      }

      const file = info.file;
      const position = { ...editor.getCursor("to") };
      const revision = this.revisions.get(editor) ?? 0;
      menu.addItem(item => item.setTitle(this.strings.insertBadge).setIcon("tag").onClick(() => {
        if (!this.active) return;
        this.insertModal?.close();
        const session = this.pendingSession;
        this.pendingSession = undefined;
        const modal = new BadgeInsertModal(this.app, this.presets, {
          isTargetValid: () => this.active && info.file === file && info.editor === editor
            && info.getMode() === "source" && info.containerEl.isConnected
            && (this.revisions.get(editor) ?? 0) === revision,
          insert: badges => insertBadges(editor, position, badges),
          relocate: session => {
            this.pendingSession = session;
            new Notice(this.strings.selectionPreserved);
          },
          close: () => { if (this.insertModal === modal) this.insertModal = undefined; },
        }, session);
        this.insertModal = modal;
        modal.open();
      }));
    }));
  }

  openPresetEditor(preset?: BadgePreset): void {
    if (!this.active || this.loadError) return;
    const modal = new PresetEditModal(this.app, this.strings, preset, async badge => {
      if (!this.active) throw new Error(this.strings.pluginDisabled);
      if (preset) await this.presets.update(preset.id, badge);
      else await this.presets.add(badge);
    }, () => this.editModals.delete(modal));
    this.editModals.add(modal);
    modal.open();
  }

  onunload(): void {
    this.active = false;
    this.insertModal?.close();
    for (const modal of this.editModals) modal.close();
    this.settingsTab?.hide();
    this.pendingSession = undefined;
  }
}
