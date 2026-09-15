import test from "node:test";
import assert from "node:assert/strict";
import { BadgeAppearance, BadgeFontSize } from "../src/appearance.ts";
import { decodeData, serializeBadges, validateFontSizePercent } from "../src/model.ts";
import { PresetStore } from "../src/preset-store.ts";
import { getTranslations } from "../src/i18n.ts";

const presets = [{ id: "custom", text: "Old badge", color: "#aabbcc" }, { id: "red", text: "旧预设", color: "red" }];
const currentData = (percent = 72) => ({ schemaVersion: 3, presets: structuredClone(presets), settings: { badgeFontSizePercent: percent } });
const createControl = store => new BadgeFontSize(store, {
  setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args),
});
const setup = async (raw = currentData(), save = async () => {}) => {
  let persisted = structuredClone(raw);
  const writes = [];
  const store = new PresetStore({ load: async () => persisted, save: async data => {
    await save(data);
    writes.push(structuredClone(data));
    persisted = structuredClone(data);
  } });
  await store.load();
  return { store, writes, read: () => structuredClone(persisted) };
};

test("v1 and v2 get 72% without writing until a real change; IDs, order and empty lists survive", async () => {
  for (const schemaVersion of [1, 2]) {
    const raw = { schemaVersion, presets: structuredClone(presets) };
    const { store, writes, read } = await setup(raw);
    assert.equal(store.badgeFontSizePercent, 72);
    assert.deepEqual(read(), raw);
    await store.setBadgeFontSizePercent(72);
    assert.equal(writes.length, 0);
    await store.setBadgeFontSizePercent(85);
    assert.deepEqual(read(), currentData(85));
    assert.equal((await setup(read())).store.badgeFontSizePercent, 85);
    assert.deepEqual(decodeData({ schemaVersion, presets: [] }), { ...currentData(), presets: [] });
  }
});

test("only integer percentages from 50 to 150 can load or save, with localized errors", async () => {
  const invalid = [undefined, null, "72", "80%", "", true, {}, [], NaN, Infinity, -Infinity, 49, 151, 72.5];
  for (const language of ["en", "zh"]) {
    const strings = getTranslations(language);
    for (const value of [50, 72, 100, 150]) assert.equal(validateFontSizePercent(value, strings), value);
    for (const value of invalid) {
      assert.throws(() => validateFontSizePercent(value, strings), { message: strings.invalidFontSize });
      assert.throws(() => decodeData({ ...currentData(), settings: { badgeFontSizePercent: value } }, strings), { message: strings.invalidFontSize });
    }
    assert.throws(() => decodeData({ schemaVersion: 3, presets }, strings), { message: strings.invalidFontSize });
  }
  for (const value of invalid) {
    const { store, writes } = await setup();
    await assert.rejects(store.setBadgeFontSizePercent(value));
    assert.equal(store.badgeFontSizePercent, 72);
    assert.equal(writes.length, 0);
  }
  let writes = 0;
  const store = new PresetStore({ load: async () => currentData(200), save: async () => { writes++; } });
  await assert.rejects(store.load());
  await assert.rejects(store.setBadgeFontSizePercent(80));
  await assert.rejects(store.add({ text: "New", color: "blue" }));
  assert.equal(writes, 0);
});

test("size, editing and importing share one queue and cannot overwrite each other", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { store, writes, read } = await setup(currentData(), async () => gate);
  const notifications = [];
  store.subscribe(change => notifications.push(change));
  const operations = [store.setBadgeFontSizePercent(90), store.update("red", { text: "Edited", color: "red" }),
    store.addMany([{ text: "Imported", color: "green" }]), store.setBadgeFontSizePercent(120)];
  await Promise.resolve();
  assert.equal(store.badgeFontSizePercent, 72);
  release();
  await Promise.all(operations);
  assert.equal(writes.length, 4);
  assert.equal(read().settings.badgeFontSizePercent, 120);
  assert.deepEqual(read().presets.map(preset => preset.text), ["Old badge", "Edited", "Imported"]);
  assert.deepEqual(notifications, ["appearance", "presets", "presets", "appearance"]);
  await store.move("red", -1);
  await store.remove("custom");
  assert.equal(read().settings.badgeFontSizePercent, 120);
  const html = serializeBadges(store.presets);
  await store.setBadgeFontSizePercent(50);
  assert.equal(serializeBadges(store.presets), html);
});

test("rapid changes preview immediately and debounce to the final percentage", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, writes } = await setup();
  const control = createControl(store);
  const previews = [];
  control.subscribe(() => previews.push(control.value));
  control.set(80);
  t.mock.timers.tick(200);
  control.set(100);
  t.mock.timers.tick(200);
  control.set(150);
  assert.deepEqual(previews, [80, 100, 150]);
  assert.equal(writes.length, 0);
  await control.flush();
  assert.equal(writes.length, 1);
  assert.equal(store.badgeFontSizePercent, 150);
  assert.equal(control.saving, false);
  control.dispose();
});

test("debounced changes save without closing the settings page", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, writes } = await setup();
  const control = createControl(store);
  const completed = new Promise(resolve => control.subscribe(() => { if (!control.saving) resolve(); }));
  control.set(85);
  t.mock.timers.tick(250);
  await completed;
  assert.equal(writes.length, 1);
  assert.equal(store.badgeFontSizePercent, 85);
  control.dispose();
});

test("save failure restores the last committed ratio and allows retry and reset", async t => {
  t.mock.method(console, "error", () => {});
  let fail = true;
  const { store, read } = await setup(currentData(90), async () => { if (fail) throw new Error("Disk unavailable"); });
  const control = createControl(store);
  control.set(120);
  await control.flush();
  assert.equal(control.value, 90);
  assert.equal(control.error, getTranslations().fontSizeSaveFailed);
  assert.deepEqual(read(), currentData(90));
  fail = false;
  control.set(120);
  await control.flush();
  assert.equal(control.error, "");
  assert.equal(read().settings.badgeFontSizePercent, 120);
  control.set(72);
  await control.flush();
  assert.equal(read().settings.badgeFontSizePercent, 72);
  control.dispose();
});

test("an older success or failure cannot roll back newer pending input", async t => {
  t.mock.method(console, "error", () => {});
  for (const fail of [false, true]) {
    let release;
    let first = true;
    const gate = new Promise(resolve => { release = resolve; });
    const { store } = await setup(currentData(), async () => {
      if (first) { first = false; await gate; if (fail) throw new Error("Disk unavailable"); }
    });
    const control = createControl(store);
    control.set(80);
    const older = control.flush();
    control.set(110);
    release();
    await older;
    assert.equal(control.value, 110);
    assert.equal(control.saving, true);
    assert.equal(control.error, "");
    await control.flush();
    assert.equal(store.badgeFontSizePercent, 110);
    control.dispose();
  }
});

test("disposal flushes pending input without later UI notifications or accepting changes", async () => {
  const { store } = await setup();
  const control = createControl(store);
  let notifications = 0;
  control.subscribe(() => { notifications++; });
  control.set(95);
  const saved = new Promise(resolve => store.subscribe(resolve));
  control.dispose();
  control.set(130);
  await saved;
  assert.equal(store.badgeFontSizePercent, 95);
  assert.equal(notifications, 1);
});

test("existing and new windows share the current percentage and restore prior CSS on cleanup", () => {
  const property = "--simple-badge-font-size";
  const document = (value = "", priority = "") => {
    const properties = new Map(value ? [[property, { value, priority }]] : []);
    return { documentElement: { style: {
      getPropertyValue: key => properties.get(key)?.value ?? "",
      getPropertyPriority: key => properties.get(key)?.priority ?? "",
      setProperty: (key, value, priority = "") => properties.set(key, { value, priority }),
      removeProperty: key => properties.delete(key),
    } } };
  };
  const main = document();
  const existing = document("65%", "important");
  const popup = document();
  const value = doc => doc.documentElement.style.getPropertyValue(property);
  const appearance = new BadgeAppearance(72);
  appearance.attach(main);
  appearance.attach(existing);
  appearance.attach(existing);
  appearance.set(125);
  appearance.attach(popup);
  assert.deepEqual([main, existing, popup].map(value), ["125%", "125%", "125%"]);
  appearance.detach(existing);
  assert.equal(value(existing), "65%");
  assert.equal(existing.documentElement.style.getPropertyPriority(property), "important");
  appearance.dispose();
  appearance.set(150);
  appearance.attach(main);
  assert.deepEqual([main, existing, popup].map(value), ["", "65%", ""]);
});
