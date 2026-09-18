import test from "node:test";
import assert from "node:assert/strict";
import { BadgeAppearance, BadgeRoundness, BadgeFontSize, cornerRadiusCss } from "../src/appearance.ts";
import { decodeData, serializeBadges, validateCornerRoundness } from "../src/model.ts";
import { PresetStore } from "../src/preset-store.ts";
import { getTranslations } from "../src/i18n.ts";

const presets = [{ id: "old", text: "Existing", color: "#e67e22" }];
const data = (roundness = null, fontSize = 90) => ({ schemaVersion: 4, presets: structuredClone(presets),
  settings: { badgeFontSizePercent: fontSize, badgeCornerRoundnessPercent: roundness } });
async function setup(raw = data(), save = async () => {}) {
  let persisted = structuredClone(raw);
  const writes = [];
  const store = new PresetStore({ load: async () => persisted, save: async value => {
    await save(value);
    persisted = structuredClone(value);
    writes.push(persisted);
  } });
  await store.load();
  return { store, writes, read: () => structuredClone(persisted) };
}

test("v1-v3 migrate lazily to original corners, preserving font ratio, IDs and empty presets", async () => {
  for (const version of [1, 2, 3]) {
    for (const entries of [presets, []]) {
      const raw = { schemaVersion: version, presets: entries, ...(version === 3 ? { settings: { badgeFontSizePercent: 125 } } : {}) };
      const { store, writes, read } = await setup(raw);
      assert.equal(store.badgeFontSizePercent, version === 3 ? 125 : 72);
      assert.equal(store.badgeCornerRoundnessPercent, null);
      await store.setBadgeCornerRoundnessPercent(null);
      assert.equal(writes.length, 0);
      assert.deepEqual(read(), raw);
      await store.setBadgeCornerRoundnessPercent(0);
      assert.deepEqual(read(), { schemaVersion: 4, presets: entries, settings: {
        badgeFontSizePercent: version === 3 ? 125 : 72, badgeCornerRoundnessPercent: 0,
      } });
      assert.equal((await setup(read())).store.badgeCornerRoundnessPercent, 0);
    }
  }
});

test("corner data accepts only original mode or integer percentages from 0 through 100", async () => {
  const invalid = [undefined, "50", true, {}, [], NaN, Infinity, -1, 101, 0.5];
  for (const language of ["en", "zh"]) {
    const strings = getTranslations(language);
    for (const valid of [null, 0, 40, 100]) {
      assert.equal(validateCornerRoundness(valid, strings), valid);
      assert.equal(decodeData(data(valid), strings).settings.badgeCornerRoundnessPercent, valid);
    }
    for (const value of invalid) {
      assert.throws(() => validateCornerRoundness(value, strings), { message: strings.invalidCornerRoundness });
      assert.throws(() => decodeData({ ...data(), settings: { badgeFontSizePercent: 90, badgeCornerRoundnessPercent: value } }, strings),
        { message: strings.invalidCornerRoundness });
    }
    assert.throws(() => decodeData({ ...data(), settings: { badgeFontSizePercent: 90 } }, strings), { message: strings.invalidCornerRoundness });
  }
  const { store, writes } = await setup();
  for (const value of invalid) await assert.rejects(store.setBadgeCornerRoundnessPercent(value));
  assert.equal(writes.length, 0);
  assert.equal(store.badgeCornerRoundnessPercent, null);
  const broken = new PresetStore({ load: async () => data(101), save: async () => { throw Error("Must not write"); } });
  await assert.rejects(broken.load());
  await assert.rejects(broken.setBadgeCornerRoundnessPercent(40));
});

test("corner, font, preset and import writes share a queue and leave span serialization untouched", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { store, read } = await setup(data(), async () => gate);
  const before = serializeBadges(store.presets);
  const changes = [store.setBadgeCornerRoundnessPercent(100), store.setBadgeFontSizePercent(125),
    store.update("old", { text: "Edited", color: "red" }), store.addMany([{ text: "Imported", color: "blue" }]),
    store.setBadgeCornerRoundnessPercent(0)];
  release();
  await Promise.all(changes);
  assert.deepEqual(read().settings, { badgeFontSizePercent: 125, badgeCornerRoundnessPercent: 0 });
  assert.deepEqual(read().presets.map(preset => preset.text), ["Edited", "Imported"]);
  await store.update("old", presets[0]);
  assert.equal(serializeBadges([store.presets[0]]), before);
  await store.setBadgeCornerRoundnessPercent(null);
  assert.equal((await setup(read())).store.badgeFontSizePercent, 125);
  assert.equal((await setup(read())).store.badgeCornerRoundnessPercent, null);
});

test("roundness previews immediately, debounces rapid input, and saves reset to original mode", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, writes } = await setup();
  const value = new BadgeRoundness(store, { setTimeout, clearTimeout });
  value.set(0);
  t.mock.timers.tick(200);
  value.set(100);
  assert.equal(value.value, 100);
  assert.equal(writes.length, 0);
  await value.flush();
  assert.equal(writes.length, 1);
  value.set(null);
  await value.flush();
  assert.equal(writes.length, 2);
  assert.equal(store.badgeCornerRoundnessPercent, null);
  value.dispose();
});

test("failed corner saves restore original mode while independently successful font changes persist", async t => {
  t.mock.method(console, "error", () => {});
  let fail = true;
  const { store } = await setup(data(), async value => {
    if (fail && value.settings.badgeCornerRoundnessPercent !== null) throw Error("Disk unavailable");
  });
  const corners = new BadgeRoundness(store, { setTimeout, clearTimeout });
  const font = new BadgeFontSize(store, { setTimeout, clearTimeout });
  corners.set(100);
  font.set(125);
  await Promise.all([corners.flush(), font.flush()]);
  assert.equal(corners.value, null);
  assert.equal(corners.error, getTranslations().cornerRoundnessSaveFailed);
  assert.equal(font.value, 125);
  assert.equal(font.error, "");
  fail = false;
  corners.set(100);
  await corners.flush();
  assert.equal(store.badgeCornerRoundnessPercent, 100);
  assert.equal(corners.error, "");
  corners.dispose();
  font.dispose();
});

test("stale corner failure cannot undo a newer reset, and disposal flushes pending shape", async t => {
  t.mock.method(console, "error", () => {});
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { store } = await setup(data(), async value => {
    if (value.settings.badgeCornerRoundnessPercent === 100) { await gate; throw Error("Disk unavailable"); }
  });
  const corners = new BadgeRoundness(store, { setTimeout, clearTimeout });
  corners.set(100);
  const older = corners.flush();
  corners.set(null);
  release();
  await older;
  assert.equal(corners.value, null);
  assert.equal(corners.error, "");
  await corners.flush();
  corners.set(0);
  const saved = new Promise(resolve => store.subscribe(resolve));
  corners.dispose();
  await saved;
  assert.equal(store.badgeCornerRoundnessPercent, 0);
});

test("corner CSS reaches square and pill endpoints; windows restore both previous CSS properties", () => {
  assert.equal(cornerRadiusCss(null), "4px");
  assert.equal(cornerRadiusCss(0), "calc(0 * (0.755em + 1px))");
  assert.equal(cornerRadiusCss(100), "999px");
  assert.match(cornerRadiusCss(50), /0\.5.*0\.755em/);
  const font = "--simple-badge-font-size", corner = "--simple-badge-border-radius";
  const doc = initial => {
    const values = new Map(initial);
    const events = new Map();
    return { events, documentElement: { style: {
      getPropertyValue: key => values.get(key)?.[0] ?? "",
      getPropertyPriority: key => values.get(key)?.[1] ?? "",
      setProperty: (key, value, priority = "") => values.set(key, [value, priority]),
      removeProperty: key => values.delete(key),
    } }, defaultView: {
      addEventListener: (event, listener) => events.set(event, listener),
      removeEventListener: event => events.delete(event),
    } };
  };
  const main = doc([[font, ["60%", "important"]], [corner, ["2px", "important"]]]);
  const popout = doc([]);
  const appearance = new BadgeAppearance(90);
  appearance.attach(main);
  assert.equal(main.documentElement.style.getPropertyValue(corner), "4px");
  appearance.setRoundness(100);
  appearance.set(150);
  appearance.attach(popout);
  for (const win of [main, popout]) {
    assert.equal(win.documentElement.style.getPropertyValue(font), "150%");
    assert.equal(win.documentElement.style.getPropertyValue(corner), "999px");
  }
  popout.events.get("pagehide")();
  assert.equal(popout.documentElement.style.getPropertyValue(corner), "");
  appearance.dispose();
  assert.equal(main.documentElement.style.getPropertyValue(corner), "2px");
  assert.equal(main.documentElement.style.getPropertyPriority(corner), "important");
  assert.equal(main.documentElement.style.getPropertyValue(font), "60%");
  assert.equal(main.documentElement.style.getPropertyPriority(font), "important");
});
