// Minimal settings host: row refreshes clear controlEl but retain infoEl children.
export class Element {
  constructor({ cls = "", text = "", attr = {} } = {}) {
    this.classes = new Set(cls.split(" ").filter(Boolean));
    this.text = text;
    this.attrs = { ...attr };
    this.children = [];
    this.listeners = {};
    this.ownerDocument = {};
    this.style = { setProperty() {} };
  }
  get isConnected() { return this.root || !!this.parent?.isConnected; }
  createEl(_tag, options) {
    const child = new Element(options);
    child.parent = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  setText(text) { this.text = text; }
  setAttr(key, value) { this.attrs[key] = value; }
  toggleClass(cls, enabled) { if (enabled) this.classes.add(cls); else this.classes.delete(cls); }
  addEventListener(event, listener) { this.listeners[event] = listener; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = undefined;
    this.root = false;
  }
  empty() { for (const child of [...this.children]) child.remove(); }
  find(cls) { return this.children.flatMap(child => [...(child.classes.has(cls) ? [child] : []), ...child.find(cls)]); }
}

class Control {
  constructor(parent, type) {
    this.element = parent.createEl(type);
    this.inputEl = this.sliderEl = this.buttonEl = this.element;
  }
  setValue(value) { this.element.value = value; return this; }
  setDisabled(value) { this.element.disabled = value; return this; }
  setLimits() { return this; }
  setIcon() { return this; }
  setTooltip() { return this; }
  setButtonText(text) { this.element.text = text; return this; }
  setCta() { return this; }
  onChange(callback) { this.element.listeners.change = callback; return this; }
  onClick(callback) { this.element.listeners.click = callback; return this; }
}

export class Setting {
  constructor(container) {
    this.settingEl = container.createDiv({ cls: "setting-item" });
    this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
    this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
  }
  setClass(cls) { this.settingEl.classes.add(cls); return this; }
  setName(name) { this.nameEl.setText(name); return this; }
  setDesc(desc) { this.descEl.setText(desc); return this; }
  setHeading() { return this; }
  addSlider(render) { render(new Control(this.controlEl, "input")); return this; }
  addText(render) { render(new Control(this.controlEl, "input")); return this; }
  addExtraButton(render) { render(new Control(this.controlEl, "button")); return this; }
  addButton(render) { render(new Control(this.controlEl, "button")); return this; }
}

export class PluginSettingTab {
  constructor() { this.containerEl = new Element(); this.containerEl.root = true; }
  update() { this.onUpdate?.(); }
}
export class Modal {}
export class ColorComponent {}
let modern = true;
export const setModernSettings = value => { modern = value; };
export const requireApiVersion = () => modern;
