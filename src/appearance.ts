import { validateFontSizePercent, validateCornerRoundness, type BadgeCornerRoundness } from "./model";
import type { PresetStore } from "./preset-store";

/** Preview immediately; debounce disk writes and ignore completions for older input. */
export class AppearanceValue<T extends number | null> {
  value: T;
  saving = false;
  error = "";
  private pending: T | undefined;
  private timer: number | undefined;
  private revision = 0;
  private disposed = false;
  private listeners = new Set<() => void>();

  constructor(private readonly source: { read(): T; write(value: T): Promise<void>; validate(value: T): unknown; failureMessage: string },
    private readonly timerWindow: Pick<Window, "setTimeout" | "clearTimeout">) {
    this.value = source.read();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(value: T): void {
    if (this.disposed) return;
    this.source.validate(value);
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
      await this.source.write(value);
    } catch (error) {
      console.error("Simple Badge: appearance save failed", error);
      if (revision === this.revision) {
        this.value = this.source.read();
        this.error = this.source.failureMessage;
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

export class BadgeFontSize extends AppearanceValue<number> {
  constructor(store: Pick<PresetStore, "badgeFontSizePercent" | "setBadgeFontSizePercent" | "strings">,
    timerWindow: Pick<Window, "setTimeout" | "clearTimeout">) {
    super({ read: () => store.badgeFontSizePercent, write: value => store.setBadgeFontSizePercent(value),
      validate: value => validateFontSizePercent(value, store.strings), failureMessage: store.strings.fontSizeSaveFailed }, timerWindow);
  }
}

export class BadgeRoundness extends AppearanceValue<BadgeCornerRoundness> {
  constructor(store: Pick<PresetStore, "badgeCornerRoundnessPercent" | "setBadgeCornerRoundnessPercent" | "strings">,
    timerWindow: Pick<Window, "setTimeout" | "clearTimeout">) {
    super({ read: () => store.badgeCornerRoundnessPercent, write: value => store.setBadgeCornerRoundnessPercent(value),
      validate: value => validateCornerRoundness(value, store.strings), failureMessage: store.strings.cornerRoundnessSaveFailed }, timerWindow);
  }
}

const FONT_SIZE_PROPERTY = "--simple-badge-font-size";
const ROUNDNESS_PROPERTY = "--simple-badge-border-radius";

export function cornerRadiusCss(percent: BadgeCornerRoundness): string {
  validateCornerRoundness(percent);
  if (percent === null) return "4px";
  if (percent === 100) return "999px";
  // Half the single-line badge height: (1.35em line + 0.16em padding + 2px border) / 2.
  return `calc(${percent / 100} * (0.755em + 1px))`;
}

/** One inherited percentage per window also updates existing and subsequently rendered badges. */
export class BadgeAppearance {
  private documents = new Map<Document, { properties: { name: string; value: string; priority: string }[]; cleanup: () => void }>();
  private disposed = false;

  constructor(private percent: number, private roundness: BadgeCornerRoundness = null) {}

  attach(doc: Document): void {
    if (this.disposed || this.documents.has(doc)) return;
    const style = doc.documentElement.style;
    const win = doc.defaultView;
    const closed = () => this.detach(doc);
    win?.addEventListener("pagehide", closed, { once: true });
    this.documents.set(doc, { properties: [FONT_SIZE_PROPERTY, ROUNDNESS_PROPERTY].map(name => ({ name,
      value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) })),
      cleanup: () => win?.removeEventListener("pagehide", closed) });
    style.setProperty(FONT_SIZE_PROPERTY, `${this.percent}%`);
    style.setProperty(ROUNDNESS_PROPERTY, cornerRadiusCss(this.roundness));
  }

  set(percent: number): void {
    if (this.disposed) return;
    this.percent = percent;
    for (const doc of this.documents.keys()) doc.documentElement.style.setProperty(FONT_SIZE_PROPERTY, `${percent}%`);
  }

  setRoundness(percent: BadgeCornerRoundness): void {
    if (this.disposed) return;
    const radius = cornerRadiusCss(percent);
    this.roundness = percent;
    for (const doc of this.documents.keys()) doc.documentElement.style.setProperty(ROUNDNESS_PROPERTY, radius);
  }

  detach(doc: Document): void {
    const previous = this.documents.get(doc);
    if (!previous) return;
    previous.cleanup();
    for (const { name, value, priority } of previous.properties) {
      if (value) doc.documentElement.style.setProperty(name, value, priority);
      else doc.documentElement.style.removeProperty(name);
    }
    this.documents.delete(doc);
  }

  dispose(): void {
    this.disposed = true;
    for (const doc of this.documents.keys()) this.detach(doc);
  }
}
