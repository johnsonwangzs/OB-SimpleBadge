import test from "node:test";
import assert from "node:assert/strict";
import { Setting, setModernSettings } from "./fixtures/obsidian.mjs";
import { SimpleBadgeSettingTab } from "../src/settings.ts";
import { BadgeFontSize } from "../src/appearance.ts";
import { PresetStore } from "../src/preset-store.ts";
import { getTranslations } from "../src/i18n.ts";

async function setup(t) {
  setModernSettings(true);
  const store = new PresetStore({ load: async () => null, save: async () => {} });
  await store.load();
  const fontSize = new BadgeFontSize(store, { setTimeout, clearTimeout });
  const disposers = [];
  const owner = { presets: store, fontSize, strings: getTranslations(),
    appearance: { attach() {} }, register: dispose => disposers.push(dispose) };
  const tab = new SimpleBadgeSettingTab({}, owner);
  t.after(() => { tab.hide(); disposers.forEach(dispose => dispose()); fontSize.dispose(); setModernSettings(true); });
  return { tab, store, fontSize };
}

function renderAppearance(tab, row) {
  const definition = tab.getSettingDefinitions()[0].items[0];
  row.setName(definition.name).setDesc(definition.desc);
  row.controlEl.empty();
  return definition.render(row);
}

function assertSinglePreview(row, value) {
  const previews = row.infoEl.find("simple-badge-font-size-preview");
  const messages = row.infoEl.find("simple-badge-message");
  assert.equal(previews.length, 1, "exactly one preview row survives refresh");
  assert.equal(previews[0].children.length, 2);
  assert.equal(messages.length, 1, "status nodes must not accumulate either");
  assert.equal(row.infoEl.children.length, 4, "host name and description are preserved");
  assert.ok(row.nameEl.text);
  assert.ok(row.descEl.text);
  assert.equal(row.controlEl.children.length, 4);
  const [slider, input] = row.controlEl.children;
  assert.equal(slider.value, value);
  assert.equal(input.value, String(value));
  assert.equal(input.attrs["aria-describedby"], messages[0].attrs.id);
}

for (const hostRunsCleanup of [false, true]) {
  test(`preset edits, moves, additions and deletions keep one preview (host cleanup: ${hostRunsCleanup})`, async t => {
    const { tab, store, fontSize } = await setup(t);
    const row = new Setting(tab.containerEl);
    let cleanup = renderAppearance(tab, row);
    let refreshes = 0;
    tab.onUpdate = () => {
      if (hostRunsCleanup) cleanup?.();
      cleanup = renderAppearance(tab, row);
      refreshes++;
      assertSinglePreview(row, fontSize.value);
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
    cleanup();
    assert.equal(row.infoEl.children.length, 2);
  });
}

test("cleanup is scoped to its row and remains safe after rerendering or hiding settings", async t => {
  const { tab, fontSize } = await setup(t);
  const first = new Setting(tab.containerEl);
  const second = new Setting(tab.containerEl);
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
  assert.equal(first.infoEl.children.length, 2);
  assert.equal(second.infoEl.children.length, 2);
  renderAppearance(tab, first);
  cleanup();
  assertSinglePreview(first, 100);
});

test("legacy settings rebuilds release the previous preview and status nodes", async t => {
  const { tab, store } = await setup(t);
  setModernSettings(false);
  tab.display();
  const oldRow = tab.containerEl.find("simple-badge-font-size")[0];
  await store.move(store.presets[0].id, 1);
  assert.equal(oldRow.isConnected, false);
  assert.equal(oldRow.find("simple-badge-font-size-preview").length, 0);
  assert.equal(oldRow.find("simple-badge-message").length, 0);
  assert.equal(tab.containerEl.find("simple-badge-font-size-preview").length, 1);
  tab.hide();
  assert.equal(tab.containerEl.find("simple-badge-font-size-preview").length, 0);
});
