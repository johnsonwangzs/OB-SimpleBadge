import { validateFontSizePercent } from "./model";
import type { PresetStore } from "./preset-store";

/** Preview immediately; debounce disk writes and ignore completions for older input. */
export class BadgeFontSize {
  value: number;
  saving = false;
  error = "";
  private pending: number | undefined;
  private timer: number | undefined;
  private revision = 0;
  private disposed = false;
  private listeners = new Set<() => void>();

  constructor(private readonly store: Pick<PresetStore, "badgeFontSizePercent" | "setBadgeFontSizePercent" | "strings">,
    private readonly timerWindow: Pick<Window, "setTimeout" | "clearTimeout">) {
    this.value = store.badgeFontSizePercent;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(value: number): void {
    if (this.disposed) return;
    validateFontSizePercent(value, this.store.strings);
    if (value === this.value && !this.error) return;
    this.value = value;
    this.pending = value;
    this.revision++;
    this.saving = true;
    this.error = "";
    if (this.timer !== undefined) this.timerWindow.clearTimeout(this.timer);
    this.timer = this.timerWindow.setTimeout(() => { void this.flush(); }, 250);
    this.emit();
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) this.timerWindow.clearTimeout(this.timer);
    this.timer = undefined;
    const value = this.pending;
    if (value === undefined) return;
    this.pending = undefined;
    const revision = this.revision;
    try {
      await this.store.setBadgeFontSizePercent(value);
    } catch (error) {
      console.error("Simple Badge: font size save failed", error);
      if (revision === this.revision) {
        this.value = this.store.badgeFontSizePercent;
        this.error = this.store.strings.fontSizeSaveFailed;
      }
    } finally {
      if (revision === this.revision) {
        this.saving = false;
        this.emit();
      }
    }
  }

  dispose(): void {
    // Persist the final valid input even if the plugin is disabled during the debounce.
    this.disposed = true;
    this.listeners.clear();
    void this.flush();
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try { listener(); } catch (error) { console.error("Simple Badge: appearance refresh failed", error); }
    }
  }
}

const FONT_SIZE_PROPERTY = "--simple-badge-font-size";

/** One inherited percentage per window also updates existing and subsequently rendered badges. */
export class BadgeAppearance {
  private documents = new Map<Document, { value: string; priority: string; cleanup: () => void }>();
  private disposed = false;

  constructor(private percent: number) {}

  attach(doc: Document): void {
    if (this.disposed || this.documents.has(doc)) return;
    const style = doc.documentElement.style;
    const win = doc.defaultView;
    const closed = () => this.detach(doc);
    win?.addEventListener("pagehide", closed, { once: true });
    this.documents.set(doc, { value: style.getPropertyValue(FONT_SIZE_PROPERTY), priority: style.getPropertyPriority(FONT_SIZE_PROPERTY),
      cleanup: () => win?.removeEventListener("pagehide", closed) });
    style.setProperty(FONT_SIZE_PROPERTY, `${this.percent}%`);
  }

  set(percent: number): void {
    if (this.disposed) return;
    this.percent = percent;
    for (const doc of this.documents.keys()) doc.documentElement.style.setProperty(FONT_SIZE_PROPERTY, `${percent}%`);
  }

  detach(doc: Document): void {
    const previous = this.documents.get(doc);
    if (!previous) return;
    previous.cleanup();
    if (previous.value) doc.documentElement.style.setProperty(FONT_SIZE_PROPERTY, previous.value, previous.priority);
    else doc.documentElement.style.removeProperty(FONT_SIZE_PROPERTY);
    this.documents.delete(doc);
  }

  dispose(): void {
    this.disposed = true;
    for (const doc of this.documents.keys()) this.detach(doc);
  }
}
