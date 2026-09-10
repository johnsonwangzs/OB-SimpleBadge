import test from "node:test";
import assert from "node:assert/strict";
import { OrderedBadges, decodeData, defaultData, normalizeBadge, serializeBadges } from "../src/model.ts";
import { PresetStore } from "../src/preset-store.ts";
import { insertBadges } from "../src/badge.ts";

const a = { id: "a", text: "重要", color: "red" };
const b = { id: "b", text: "信息", color: "blue" };
const c = { id: "c", text: "完成", color: "green" };
const empty = () => ({ schemaVersion: 1, presets: [] });
const makeStore = async (raw = null) => {
  let persisted = structuredClone(raw);
  const store = new PresetStore({ load: async () => persisted, save: async data => { persisted = structuredClone(data); } });
  await store.load();
  return { store, read: () => structuredClone(persisted) };
};

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
  assert.equal(defaultData().presets[0].text, "信息");
});

test("invalid or future configuration is rejected instead of silently overwritten", async () => {
  for (const raw of [{}, { schemaVersion: 2, presets: [] }, { schemaVersion: 1, presets: [a, a] },
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
