import { getLanguage, MarkdownView, Notice, Plugin, type Editor, type Modal } from "obsidian";
import { insertBadges } from "./badge";
import { BadgeInsertModal } from "./insert-modal";
import { PresetStore } from "./preset-store";
import { PresetEditModal, SimpleBadgeSettingTab } from "./settings";
import type { BadgePreset, InsertSession } from "./model";
import { getTranslations } from "./i18n";
import { captureEditorTarget } from "./editor-target";
import { PresetImportModal } from "./import-modal";
import { BadgeAppearance, BadgeFontSize, BadgeRoundness } from "./appearance";

export default class SimpleBadgePlugin extends Plugin {
  presets!: PresetStore;
  fontSize!: BadgeFontSize;
  roundness!: BadgeRoundness;
  appearance!: BadgeAppearance;
  strings = getTranslations();
  loadError: string | undefined;
  private revisions = new WeakMap<Editor, number>();
  private insertModal: BadgeInsertModal | undefined;
  private settingsTab: SimpleBadgeSettingTab | undefined;
  private presetModals = new Set<Modal>();
  private pendingSession: InsertSession | undefined;
  private active = false;

  async onload(): Promise<void> {
    this.strings = getTranslations(getLanguage());
    this.presets = new PresetStore({ load: () => this.loadData(), save: data => this.saveData(data) }, this.strings);
    try { await this.presets.load(); }
    catch (error) {
      this.loadError = error instanceof Error ? error.message : this.strings.loadFailed;
      new Notice(`Simple Badge: ${this.loadError}`);
    }
    this.active = true;
    this.fontSize = new BadgeFontSize(this.presets, this.app.workspace.containerEl.win);
    this.roundness = new BadgeRoundness(this.presets, this.app.workspace.containerEl.win);
    const appearance = this.appearance = new BadgeAppearance(this.fontSize.value, this.roundness.value);
    const attachWindows = () => {
      if (!this.active) return;
      appearance.attach(this.app.workspace.containerEl.ownerDocument);
      this.app.workspace.iterateAllLeaves(leaf => appearance.attach(leaf.view.containerEl.ownerDocument));
    };
    attachWindows();
    this.app.workspace.onLayoutReady(attachWindows);
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => appearance.attach(win.document)));
    this.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, win) => appearance.detach(win.document)));
    this.register(this.fontSize.subscribe(() => {
      appearance.set(this.fontSize.value);
      if (this.fontSize.error) new Notice(this.fontSize.error);
    }));
    this.register(this.roundness.subscribe(() => {
      appearance.setRoundness(this.roundness.value);
      if (this.roundness.error) new Notice(this.roundness.error);
    }));
    this.register(() => appearance.dispose());
    this.settingsTab = new SimpleBadgeSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.registerEvent(this.app.workspace.on("editor-change", (editor) => {
      this.revisions.set(editor, (this.revisions.get(editor) ?? 0) + 1);
    }));

    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      const markdownView = info instanceof MarkdownView ? info : undefined;
      if (markdownView && markdownView.getMode() !== "source") return;

      const leaf = this.app.workspace.getMostRecentLeaf();
      const hostView = leaf?.view;
      const target = captureEditorTarget(editor, info, () => this.active && (
        markdownView
          ? markdownView.getMode() === "source" && markdownView.containerEl.isConnected
          : !!hostView && leaf?.view === hostView && hostView.containerEl.isConnected
            && this.app.workspace.activeEditor?.editor === editor
      ), () => this.revisions.get(editor) ?? 0);
      menu.addItem(item => item.setTitle(this.strings.insertBadge).setIcon("tag").onClick(() => {
        if (!this.active) return;
        this.insertModal?.close();
        const session = this.pendingSession;
        this.pendingSession = undefined;
        const modal = new BadgeInsertModal(this.app, this.presets, {
          isTargetValid: () => target.isValid(),
          insert: badges => insertBadges(editor, target.position, badges),
          relocate: session => {
            this.pendingSession = session;
            new Notice(this.strings.selectionPreserved);
          },
          close: () => { if (this.insertModal === modal) this.insertModal = undefined; },
        }, session);
        this.insertModal = modal;
        modal.open();
        appearance.attach(modal.modalEl.ownerDocument);
      }));
    }));
  }

  openPresetEditor(preset?: BadgePreset): void {
    if (!this.active || this.loadError) return;
    const modal = new PresetEditModal(this.app, this.strings, preset, async badge => {
      if (!this.active) throw new Error(this.strings.pluginDisabled);
      if (preset) await this.presets.update(preset.id, badge);
      else await this.presets.add(badge);
    }, () => this.presetModals.delete(modal));
    this.presetModals.add(modal);
    modal.open();
    this.appearance.attach(modal.modalEl.ownerDocument);
  }

  openPresetImporter(): void {
    if (!this.active || this.loadError) return;
    const modal = new PresetImportModal(this.app, this.presets, badges => {
      if (!this.active) return Promise.reject(new Error(this.strings.pluginDisabled));
      return this.presets.addMany(badges);
    }, () => this.presetModals.delete(modal));
    this.presetModals.add(modal);
    modal.open();
    this.appearance.attach(modal.modalEl.ownerDocument);
  }

  onunload(): void {
    this.active = false;
    this.fontSize?.dispose();
    this.roundness?.dispose();
    this.insertModal?.close();
    for (const modal of this.presetModals) modal.close();
    this.settingsTab?.hide();
    this.pendingSession = undefined;
  }
}
