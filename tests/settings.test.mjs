import test from "node:test";
import assert from "node:assert/strict";
import { Setting, setModernSettings } from "./fixtures/obsidian.mjs";
import { SimpleBadgeSettingTab } from "../src/settings.ts";
import { BadgeFontSize, BadgeRoundness } from "../src/appearance.ts";
import { PresetStore } from "../src/preset-store.ts";
import { getTranslations } from "../src/i18n.ts";

async function setup(t) {
  setModernSettings(true);
  const store = new PresetStore({ load: async () => null, save: async () => {} });
  await store.load();
  const fontSize = new BadgeFontSize(store, { setTimeout, clearTimeout });
  const roundness = new BadgeRoundness(store, { setTimeout, clearTimeout });
  const disposers = [];
  const owner = { presets: store, fontSize, roundness, strings: getTranslations(),
    appearance: { attach() {} }, register: dispose => disposers.push(dispose) };
  const tab = new SimpleBadgeSettingTab({}, owner);
  t.after(() => { tab.hide(); disposers.forEach(dispose => dispose()); fontSize.dispose(); roundness.dispose(); setModernSettings(true); });
  return { tab, store, fontSize, roundness };
}

const createRows = tab => [new Setting(tab.containerEl), new Setting(tab.containerEl)];

function renderAppearance(tab, rows) {
  const cleanups = tab.getSettingDefinitions()[0].items.map((definition, index) => {
    const row = rows[index];
    row.setName(definition.name).setDesc(definition.desc);
    row.controlEl.empty();
    return definition.render(row);
  });
  return () => cleanups.forEach(cleanup => cleanup?.());
}

function assertSinglePreview(rows, value, roundness = null) {
  const previews = rows.flatMap(row => row.infoEl.find("simple-badge-appearance-preview"));
  assert.equal(previews.length, 1, "exactly one preview row survives refresh");
  assert.equal(previews[0].children.length, 2);
  for (const [index, row] of rows.entries()) {
    const messages = row.infoEl.find("simple-badge-message");
    assert.equal(messages.length, 1, "status nodes must not accumulate either");
    assert.equal(row.infoEl.children.length, index ? 4 : 3, "host name and description are preserved");
    assert.ok(row.nameEl.text);
    assert.ok(row.descEl.text);
    assert.equal(row.controlEl.children.length, index ? 5 : 4);
    const controls = row.controlEl.children.slice(index);
    const [slider, input] = controls;
    const current = index ? roundness : value;
    assert.equal(slider.value, current ?? 40);
    assert.equal(input.value, current === null ? "" : String(current));
    assert.equal(input.attrs["aria-describedby"], messages[0].attrs.id);
  }
}

for (const hostRunsCleanup of [false, true]) {
  test(`preset edits, moves, additions and deletions keep one preview (host cleanup: ${hostRunsCleanup})`, async t => {
    const { tab, store, fontSize, roundness } = await setup(t);
    const row = createRows(tab);
    let cleanup = renderAppearance(tab, row);
    let refreshes = 0;
    tab.onUpdate = () => {
      if (hostRunsCleanup) cleanup?.();
      cleanup = renderAppearance(tab, row);
      refreshes++;
      assertSinglePreview(row, fontSize.value, roundness.value);
    };
    const id = store.presets[0].id;
    await store.update(id, { text: "Edited preset", color: "blue" });
    await store.move(id, 1);
    await store.move(id, -1);
    await store.add({ text: "Temporary preset", color: "green" });
    await store.remove(store.presets.at(-1).id);
    assert.equal(refreshes, 5);
    fontSize.set(90);
    await fontSize.flush();
    assertSinglePreview(row, 90);
    roundness.set(100);
    await roundness.flush();
    await store.move(id, 1);
    assertSinglePreview(row, 90, 100);
    cleanup();
    for (const item of row) assert.equal(item.infoEl.children.length, 2);
  });
}

test("cleanup is scoped to its row and remains safe after rerendering or hiding settings", async t => {
  const { tab, fontSize } = await setup(t);
  const first = createRows(tab);
  const second = createRows(tab);
  const staleCleanup = renderAppearance(tab, first);
  renderAppearance(tab, second);
  const cleanup = renderAppearance(tab, first);
  staleCleanup();
  staleCleanup();
  assertSinglePreview(first, 72);
  assertSinglePreview(second, 72);
  fontSize.set(100);
  await fontSize.flush();
  assertSinglePreview(first, 100);
  assertSinglePreview(second, 100);
  tab.hide();
  for (const row of [...first, ...second]) assert.equal(row.infoEl.children.length, 2);
  renderAppearance(tab, first);
  cleanup();
  assertSinglePreview(first, 100);
});

test("legacy settings rebuilds release the previous preview and status nodes", async t => {
  const { tab, store } = await setup(t);
  setModernSettings(false);
  tab.display();
  const oldRow = tab.containerEl.find("simple-badge-roundness")[0];
  await store.move(store.presets[0].id, 1);
  assert.equal(oldRow.isConnected, false);
  assert.equal(oldRow.find("simple-badge-appearance-preview").length, 0);
  assert.equal(oldRow.find("simple-badge-message").length, 0);
  assert.equal(tab.containerEl.find("simple-badge-appearance-preview").length, 1);
  tab.hide();
  assert.equal(tab.containerEl.find("simple-badge-appearance-preview").length, 0);
});

test("corner mode, invalid input, cross-control refresh and reset keep the last valid shape", async t => {
  const { tab, fontSize, roundness, store } = await setup(t);
  const rows = createRows(tab);
  renderAppearance(tab, rows);
  const shape = rows[1];
  const [mode, slider, input, , reset] = shape.controlEl.children;
  await new Promise(setImmediate);
  assert.equal(roundness.value, null, "rendering must not replace original corners with the hidden slider value");
  assert.equal(store.badgeCornerRoundnessPercent, null);
  assert.equal(mode.value, "original");
  assert.equal(slider.displayFormat(40), "");
  assert.ok(shape.settingEl.classes.has("simple-badge-original-corners"));
  mode.change("custom");
  await roundness.flush();
  assert.equal(roundness.value, 40);
  assert.equal(mode.value, "custom");
  assert.equal(slider.displayFormat(40), "40%");
  assertSinglePreview(rows, 72, 40);
  for (const invalid of ["", "101", "-1", "2.5"]) {
    input.value = invalid;
    input.listeners.input();
    fontSize.set(90);
    assert.equal(input.value, invalid, "an unrelated font change must preserve incomplete corner input");
    input.listeners.blur();
    assert.equal(input.attrs["aria-invalid"], "true");
    assert.equal(shape.infoEl.find("simple-badge-message")[0].text, getTranslations().invalidCornerRoundness);
    assert.equal(roundness.value, 40);
  }
  slider.change(0);
  assertSinglePreview(rows, 90, 0);
  input.value = "100";
  input.listeners.input();
  input.listeners.blur();
  await new Promise(setImmediate); // The blur handler has already submitted its asynchronous save.
  assert.equal(store.badgeCornerRoundnessPercent, 100);
  assertSinglePreview(rows, 90, 100);
  reset.listeners.click();
  await new Promise(setImmediate);
  assert.equal(store.badgeCornerRoundnessPercent, null);
  assert.equal(mode.value, "original");
  assertSinglePreview(rows, 90);
});

test("rendering saved corner values and refreshing from another row never changes the selection", async t => {
  const { tab, fontSize, roundness, store } = await setup(t);
  for (const value of [0, 100, 25, null]) {
    roundness.set(value);
    await roundness.flush();
    const rows = createRows(tab);
    const cleanup = renderAppearance(tab, rows);
    fontSize.set(fontSize.value === 90 ? 100 : 90);
    await fontSize.flush();
    assert.equal(roundness.value, value);
    assert.equal(store.badgeCornerRoundnessPercent, value);
    assertSinglePreview(rows, fontSize.value, value);
    cleanup();
  }
});
