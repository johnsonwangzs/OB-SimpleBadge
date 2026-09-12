import test from "node:test";
import "./import.test.mjs";
import assert from "node:assert/strict";
import { BADGE_COLORS, OrderedBadges, colorLabel, decodeData, defaultData, normalizeBadge, normalizeHexColor, sameBadge, serializeBadges } from "../src/model.ts";
import { PresetStore } from "../src/preset-store.ts";
import { insertBadges, renderBadge } from "../src/badge.ts";
import { getTranslations } from "../src/i18n.ts";
import { captureEditorTarget } from "../src/editor-target.ts";

const a = { id: "a", text: "重要", color: "red" };
const b = { id: "b", text: "信息", color: "blue" };
const c = { id: "c", text: "完成", color: "green" };
const empty = () => ({ schemaVersion: 2, presets: [] });
const makeStore = async (raw = null) => {
  let persisted = structuredClone(raw);
  const store = new PresetStore({ load: async () => persisted, save: async data => { persisted = structuredClone(data); } });
  await store.load();
  return { store, read: () => structuredClone(persisted) };
};

test("HEX input normalizes shorthand, case and surrounding whitespace without accepting CSS", () => {
  for (const [input, output] of [["#ABC", "#aabbcc"], [" #E67E22 ", "#e67e22"], ["#000", "#000000"], ["#FFFfff", "#ffffff"]]) {
    assert.equal(normalizeHexColor(input), output);
    assert.deepEqual(normalizeBadge({ text: " Custom ", color: input }), { text: "Custom", color: output });
  }
  for (const input of [null, undefined, 123, {}, "", "#", "#12", "#1234", "#12345", "#12345678", "#gg0000", "123456",
    "rgb(0, 0, 0)", "var(--color-red)", "#abcdef; color: red", '#abcdef\" onclick=\"bad']) {
    assert.equal(normalizeHexColor(input), undefined);
    assert.throws(() => serializeBadges([{ text: "Invalid", color: input }]));
  }
});

test("all eight theme colors have translated names and keep class-only HTML", () => {
  assert.deepEqual(BADGE_COLORS.map(color => color.id), ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"]);
  for (const { id } of BADGE_COLORS) {
    assert.equal(serializeBadges([{ text: "Theme", color: id }]), `<span class="badge badge-${id}">Theme</span>`);
    for (const language of ["en", "zh"]) {
      const strings = getTranslations(language);
      assert.ok(colorLabel(id, strings));
      assert.equal(colorLabel("#e67e22", strings), "#e67e22");
    }
  }
});

test("custom colors travel in HTML with escaped text, mixed selection order and one batch transaction", () => {
  const custom = { id: "custom", text: ' A & <b>"custom"</b> 🐱 ', color: "#ABC" };
  const selected = new OrderedBadges([custom, a, { id: "new", text: "Cyan", color: "cyan" }]);
  const expected = '<span class="badge badge-custom" style="--simple-badge-color: #aabbcc;">A &amp; &lt;b&gt;"custom"&lt;/b&gt; 🐱</span> <span class="badge badge-red">重要</span> <span class="badge badge-cyan">Cyan</span>';
  assert.equal(serializeBadges(selected.values), expected);
  const transactions = [];
  insertBadges({ transaction: tx => transactions.push(tx), focus: () => {} }, { line: 2, ch: 3 }, selected.values);
  assert.equal(transactions.length, 1);
  assert.deepEqual(transactions[0].changes, [{ from: { line: 2, ch: 3 }, to: { line: 2, ch: 3 }, text: expected }]);
});

test("DOM previews receive only normalized colors and plain text, matching Markdown output", () => {
  const creations = [];
  const properties = [];
  const container = { createSpan: options => {
    creations.push(options);
    return { style: { setProperty: (...args) => properties.push(args) } };
  } };
  renderBadge(container, { text: "<b>Text</b>", color: "#ABC" });
  renderBadge(container, { text: "Theme", color: "orange" });
  assert.deepEqual(creations, [{ cls: "badge badge-custom", text: "<b>Text</b>" }, { cls: "badge badge-orange", text: "Theme" }]);
  assert.deepEqual(properties, [["--simple-badge-color", "#aabbcc"]]);
  assert.throws(() => renderBadge(container, { text: "Invalid", color: "#abcdef; display:none" }));
  assert.equal(creations.length, 2);
});

test("version 1 migrates on the next successful save, keeping IDs, order and empty lists", async () => {
  const raw = { schemaVersion: 1, presets: [c, a, b] };
  const { store, read } = await makeStore(raw);
  assert.deepEqual(read(), raw);
  assert.deepEqual(store.presets, raw.presets);
  assert.deepEqual(decodeData({ schemaVersion: 1, presets: [] }), empty());
  await store.update(a.id, { text: a.text, color: "#E67E22" });
  assert.deepEqual(read(), { schemaVersion: 2, presets: [c, { ...a, color: "#e67e22" }, b] });
  const { store: reopened } = await makeStore(read());
  assert.deepEqual(reopened.presets, store.presets);
  await reopened.update(a.id, { text: a.text, color: "pink" });
  assert.equal(reopened.presets[1].color, "pink");
  assert.equal(raw.schemaVersion, 1);
  assert.deepEqual(raw.presets, [c, a, b]);
});

test("equivalent HEX colors reuse IDs and cannot create duplicate presets or selections", async () => {
  const { store, read } = await makeStore(empty());
  const first = await store.add({ text: "Custom", color: "#ABC" });
  const second = await store.add({ text: " Custom ", color: "#aabbcc" });
  assert.equal(first.id, second.id);
  assert.equal(first.color, "#aabbcc");
  assert.equal(sameBadge({ ...first, color: "#ABC" }, second), true);
  const selected = new OrderedBadges([{ ...first, id: "temporary", color: "#ABC" }, a]);
  selected.add(second);
  assert.deepEqual(selected.values, [second, a]);
  const another = await store.add({ text: "Another", color: "blue" });
  await assert.rejects(store.update(another.id, { text: "Custom", color: "#AaBbCc" }));
  assert.equal(read().presets.length, 2);
  assert.throws(() => decodeData({ schemaVersion: 2, presets: [first, { ...first, id: "other", color: "#ABC" }] }));
});

test("failed version 2 saves preserve the old configuration and allow retry", async () => {
  let persisted = { schemaVersion: 1, presets: [a] };
  let fail = true;
  const store = new PresetStore({ load: async () => persisted, save: async data => {
    if (fail) throw new Error("Disk unavailable");
    persisted = structuredClone(data);
  } });
  await store.load();
  await assert.rejects(store.add({ text: "Custom", color: "#ABC" }));
  assert.deepEqual(persisted, { schemaVersion: 1, presets: [a] });
  assert.deepEqual(store.presets, [a]);
  fail = false;
  await store.add({ text: "Custom", color: "#ABC" });
  assert.equal(persisted.schemaVersion, 2);
  assert.equal(persisted.presets[1].color, "#aabbcc");
});

test("Canvas and fileless editors retain their own insertion position and batch undo transaction", () => {
  for (const file of [{ path: "test-canvas.canvas", extension: "canvas" }, null]) {
    let text = "before after";
    let cursor = { line: 0, ch: 7 };
    const changes = [];
    const editor = {
      getValue: () => text,
      getCursor: side => { assert.equal(side, "to"); return cursor; },
      transaction: tx => { changes.push(tx); text = text.slice(0, tx.changes[0].from.ch) + tx.changes[0].text + text.slice(tx.changes[0].to.ch); },
      focus: () => {},
    };
    const target = captureEditorTarget(editor, { file, editor }, () => true, () => 0);
    cursor.ch = 0;
    assert.equal(target.isValid(), true);
    insertBadges(editor, target.position, [b, a]);
    assert.equal(text, `before ${serializeBadges([b, a])}after`);
    assert.equal(changes.length, 1);
    assert.equal(target.isValid(), false);
  }
});

test("an insertion target rejects switched cards, closed editors, and changed content", () => {
  let text = "same text";
  let revision = 0;
  let available = true;
  const editor = { getValue: () => text, getCursor: () => ({ line: 0, ch: 2 }) };
  const info = { file: { path: "test-canvas.canvas" }, editor };
  const target = captureEditorTarget(editor, info, () => available, () => revision);
  assert.equal(target.isValid(), true);
  info.editor = { ...editor };
  assert.equal(target.isValid(), false);
  info.editor = editor;
  available = false;
  assert.equal(target.isValid(), false);
  available = true;
  text = "changed without an editor-change event";
  assert.equal(target.isValid(), false);
  text = "same text";
  revision++;
  assert.equal(target.isValid(), false);
  revision--;
  info.file = { path: "another.canvas" };
  assert.equal(target.isValid(), false);
});

test("selection follows click order, cancellation compacts, reselection appends", () => {
  const selected = new OrderedBadges();
  [c, a, b].forEach(item => selected.toggle(item));
  assert.deepEqual(selected.values, [c, a, b]);
  selected.toggle(a);
  assert.deepEqual(selected.values, [c, b]);
  assert.equal(selected.indexOf(b.id), 1);
  selected.toggle(a);
  assert.deepEqual(selected.values, [c, b, a]);
});

test("selected values are isolated from later edits and returned snapshots", () => {
  const preset = { ...a };
  const selected = new OrderedBadges([preset]);
  preset.text = "已修改";
  selected.values[0].text = "也修改";
  assert.deepEqual(selected.values, [a]);
});

test("saving a temporary badge upgrades it in place, without duplicates", () => {
  const temporary = { ...b, id: "temporary" };
  const selected = new OrderedBadges([a, temporary, c]);
  selected.add(b);
  selected.add(b);
  assert.deepEqual(selected.values, [a, b, c]);
  selected.remove(b.id);
  assert.deepEqual(selected.values, [a, c]);
});

test("serialization keeps exact order and one space only between spans", () => {
  assert.equal(serializeBadges([a, b]), '<span class="badge badge-red">重要</span> <span class="badge badge-blue">信息</span>');
  assert.equal(serializeBadges([]), "");
});

test("HTML-like text, ampersands, and emoji remain literal badge text", () => {
  assert.equal(serializeBadges([{ text: ' A & <b>"验收"</b> 🐱 ', color: "purple" }]),
    '<span class="badge badge-purple">A &amp; &lt;b&gt;"验收"&lt;/b&gt; 🐱</span>');
  assert.throws(() => normalizeBadge({ text: "  ", color: "blue" }));
  assert.throws(() => normalizeBadge({ text: "A\nB", color: "blue" }));
  assert.throws(() => normalizeBadge({ text: "A", color: 'red" onclick="bad' }));
});

test("batch uses one editor transaction, preserves selection text, and puts caret after output", () => {
  let document = "甲乙丙";
  let transaction;
  let changes = 0;
  let focused = false;
  insertBadges({
    transaction(tx) {
      transaction = tx;
      changes++;
      const edit = tx.changes[0];
      document = document.slice(0, edit.from.ch) + edit.text + document.slice(edit.to.ch);
    },
    focus() { focused = true; },
  }, { line: 0, ch: 2 }, [a, b]);
  const output = serializeBadges([a, b]);
  assert.equal(document, `甲乙${output}丙`);
  assert.equal(changes, 1);
  assert.deepEqual(transaction.selection, { from: { line: 0, ch: 2 + output.length }, to: { line: 0, ch: 2 + output.length } });
  assert.equal(focused, true);
});

test("first launch gets defaults, deliberately empty presets stay empty", () => {
  assert.deepEqual(decodeData(null), defaultData());
  assert.deepEqual(decodeData(empty()), empty());
  const first = defaultData(); first.presets[0].text = "changed";
  assert.equal(defaultData().presets[0].text, "Information");
});

test("invalid or future configuration is rejected instead of silently overwritten", async () => {
  for (const raw of [{}, { schemaVersion: 3, presets: [] }, { schemaVersion: 1, presets: [a, a] },
    { schemaVersion: 1, presets: [a, { ...a, id: "different" }] }, { schemaVersion: 1, presets: [{ ...a, text: "" }] }]) {
    let saves = 0;
    const store = new PresetStore({ load: async () => raw, save: async () => { saves++; } });
    await assert.rejects(store.load());
    await assert.rejects(store.add(b));
    assert.equal(saves, 0);
  }
});

test("duplicate creation reuses a stable ID, same text in a different color is distinct", async () => {
  const { store } = await makeStore(empty());
  const one = await store.add(a);
  const two = await store.add({ ...a, text: " 重要 " });
  assert.equal(one.id, two.id);
  await store.add({ ...a, color: "blue" });
  assert.equal(store.presets.length, 2);
});

test("untrusted configuration entries are rejected without saving or coercing fields", async () => {
  const entries = [null, 42, "badge", [], {}, { ...a, id: 7 }, { ...a, id: " " },
    { id: "a", color: "red" }, { ...a, text: 7 }, { ...a, text: {} },
    { id: "a", text: "A" }, { ...a, color: null }, { ...a, color: "invalid" }];
  for (const entry of entries) {
    let saves = 0;
    const store = new PresetStore({
      load: async () => ({ schemaVersion: 1, presets: [b, entry] }),
      save: async () => { saves++; },
    });
    await assert.rejects(store.load());
    assert.deepEqual(store.presets, []);
    await assert.rejects(store.add(c));
    assert.equal(saves, 0);
  }
  for (const value of [null, undefined, [], 123, "badge"]) assert.throws(() => normalizeBadge(value));
  assert.deepEqual(decodeData({ schemaVersion: 1, presets: [a, b] }).presets, [a, b]);
});

test("edit, move, delete and empty list survive a new store instance", async () => {
  const { store, read } = await makeStore({ schemaVersion: 1, presets: [a, b, c] });
  await store.update(b.id, { text: "参考", color: "purple" });
  await store.move(b.id, -1);
  await store.remove(c.id);
  const reopened = new PresetStore({ load: async () => read(), save: async () => {} });
  await reopened.load();
  assert.deepEqual(reopened.presets, [{ id: b.id, text: "参考", color: "purple" }, a]);
  await store.remove(b.id); await store.remove(a.id);
  assert.deepEqual(decodeData(read()), empty());
});

test("conflicting edits and stale IDs do not alter stored data", async () => {
  const { store, read } = await makeStore({ schemaVersion: 1, presets: [a, b] });
  await assert.rejects(store.update(a.id, b));
  await assert.rejects(store.update("missing", c));
  assert.deepEqual(read().presets, [a, b]);
});

test("concurrent saves are serialized and preserve both new presets", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const writes = [];
  const store = new PresetStore({ load: async () => empty(), save: async data => {
    if (!writes.length) await gate;
    writes.push(structuredClone(data));
  } });
  await store.load();
  const one = store.add(a); const two = store.add(b);
  await Promise.resolve();
  assert.equal(store.presets.length, 0);
  release();
  await Promise.all([one, two]);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].presets.map(item => item.text), [a.text, b.text]);
});

test("a failed save leaves memory unchanged and does not poison subsequent saves", async () => {
  let fail = true;
  let notifications = 0;
  const store = new PresetStore({ load: async () => empty(), save: async () => { if (fail) throw new Error("Disk unavailable"); } });
  await store.load();
  const unsubscribe = store.subscribe(() => { notifications++; });
  await assert.rejects(store.add(a));
  assert.deepEqual(store.presets, []);
  assert.equal(notifications, 0);
  fail = false;
  await store.add(b);
  assert.equal(store.presets[0].text, b.text);
  assert.equal(notifications, 1);
  unsubscribe();
  await store.add(c);
  assert.equal(notifications, 1);
});

test("language resolution supports Chinese locale variants and defaults other languages to English", () => {
  for (const locale of ["zh", "zh-CN", "zh_TW", "zh-Hans", " ZH-hant-HK "]) {
    assert.equal(getTranslations(locale).insertBadge, "插入 Badge");
  }
  for (const locale of [undefined, "", "en", "en-US", "fr", "ja", "unknown", "zhunknown"]) {
    assert.equal(getTranslations(locale).insertBadge, "Insert Badge");
  }
});

test("new vaults get translated default text with stable IDs and colors", async () => {
  const stores = ["en", "zh"].map(locale => new PresetStore({ load: async () => null, save: async () => {} }, getTranslations(locale)));
  await Promise.all(stores.map(store => store.load()));
  assert.deepEqual(stores[0].presets.map(item => item.text), ["Information", "Done", "Note", "Important"]);
  assert.deepEqual(stores[1].presets.map(item => item.text), ["信息", "完成", "备注", "重要"]);
  assert.deepEqual(stores[0].presets.map(({ id, color }) => ({ id, color })), stores[1].presets.map(({ id, color }) => ({ id, color })));
});

test("switching UI language preserves saved badge text, IDs, order and deliberately empty lists", async () => {
  const raw = defaultData(getTranslations("zh"));
  raw.presets[0].text = "自定义 & <标记>";
  const stores = ["en", "zh"].map(locale => new PresetStore({ load: async () => structuredClone(raw), save: async () => {} }, getTranslations(locale)));
  await Promise.all(stores.map(store => store.load()));
  for (const store of stores) {
    assert.deepEqual(store.presets, raw.presets);
    assert.deepEqual(decodeData(empty(), store.strings), empty());
  }
  assert.equal(serializeBadges(stores[0].presets), serializeBadges(stores[1].presets));
});

test("validation and preset errors use the same language as their UI", async () => {
  for (const locale of ["en", "zh"]) {
    const strings = getTranslations(locale);
    for (const [badge, message] of [
      [{ text: "", color: "blue" }, strings.requiredText],
      [{ text: "A\nB", color: "blue" }, strings.singleLine],
      [{ text: "A", color: "invalid" }, strings.invalidColor],
    ]) assert.throws(() => normalizeBadge(badge, strings), { message });
    assert.throws(() => decodeData({ schemaVersion: 3, presets: [] }, strings), { message: strings.unsupportedConfig });
    assert.throws(() => decodeData({ schemaVersion: 1, presets: [{ ...a, id: "" }] }, strings), { message: strings.invalidId });
    assert.throws(() => decodeData({ schemaVersion: 1, presets: [a, a] }, strings), { message: strings.duplicateConfig });
    const store = new PresetStore({ load: async () => ({ schemaVersion: 1, presets: [a, b] }), save: async () => {} }, strings);
    await assert.rejects(store.add(c), { message: strings.configNotLoaded });
    await store.load();
    await assert.rejects(store.update(a.id, b), { message: strings.duplicatePreset });
    await assert.rejects(store.remove("missing"), { message: strings.missingPreset });
    assert.deepEqual(store.presets, [a, b]);
  }
});
