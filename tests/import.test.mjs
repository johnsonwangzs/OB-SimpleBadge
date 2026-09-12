import test from "node:test";
import assert from "node:assert/strict";
import { BADGE_COLORS, planPresetImport, serializeBadges } from "../src/model.ts";
import { PresetStore } from "../src/preset-store.ts";
import { MAX_IMPORT_BADGES, MAX_IMPORT_LENGTH, parseBadgeSpans } from "../src/span-import.ts";
import { getTranslations } from "../src/i18n.ts";

const theme = (text = "Important", color = "red") => `<span class="badge badge-${color}">${text}</span>`;
const custom = (text = "Review", color = "#ABC") => `<span class="badge badge-custom" style="--simple-badge-color: ${color};">${text}</span>`;
const plain = ({ text, color }) => ({ text, color });

test("span import round-trips every supported color and literal badge text", () => {
  const badges = [...BADGE_COLORS.map(({ id }) => ({ color: id, text: `颜色 ${id} & <b>\"🐱\"</b>` })),
    { color: "#e67e22", text: "Custom &amp; &quot; <test>" }];
  assert.deepEqual(parseBadgeSpans(serializeBadges(badges)), badges);
});

test("span import accepts copied batches, HTML fences and harmless formatting differences", () => {
  const input = "<SPAN STYLE = '--simple-badge-color: &#35;AbC' CLASS = ' badge-custom   badge '>\n Review \n</SPAN>";
  assert.deepEqual(parseBadgeSpans(input), [{ text: "Review", color: "#aabbcc" }]);
  for (const separator of ["", " ", "\n", "\r\n\t"]) {
    const source = `${theme()}${separator}${custom()}`;
    const expected = [{ text: "Important", color: "red" }, { text: "Review", color: "#aabbcc" }];
    for (const fenced of [source, `\n\x60\x60\x60html\n${source}\n\x60\x60\x60\n`, `\x60\x60\x60\r\n${source}\r\n\x60\x60\x60`]) {
      assert.deepEqual(parseBadgeSpans(fenced), expected);
    }
  }
  assert.deepEqual(parseBadgeSpans('<span class="badge&#32;badge-blue" > Information </span >'), [{ text: "Information", color: "blue" }]);
});

test("HTML entities are decoded exactly once, including named and numeric Unicode entities", () => {
  assert.deepEqual(parseBadgeSpans(theme('A &amp; B &lt;tag&gt; &quot;x&quot; &apos;y&apos; &copy; &#128049; &#x1F431; &amp;lt; &unknown;')),
    [{ text: 'A & B <tag> "x" \'y\' © 🐱 🐱 &lt; &unknown;', color: "red" }]);
  assert.equal(parseBadgeSpans(theme("A&nbsp;B"))[0].text, "A\u00a0B");
  assert.equal(serializeBadges(parseBadgeSpans(theme("&lt;img src=x onerror=alert(1)&gt;"))),
    theme("&lt;img src=x onerror=alert(1)&gt;"));
});

test("invalid markup never becomes a partial import or silently loses attributes and styling", () => {
  const invalid = [
    "", " ", "<span", '<span class="badge badge-red">unclosed', "<span>Text</span>",
    '<span class="badge badge-red"/>', theme("<b>nested</b>"), theme("<span>nested</span>"),
    theme("<img src=x onerror=alert(1)>"), '<script>alert(1)</script>',
    theme().replace("class=", 'onclick="alert(1)" class='), theme().replace("class=", 'data-color="red" class='),
    theme().replace("class=", 'class="badge badge-blue" class='),
    theme().replace("badge-red", "badge-red extra"), theme().replace("badge-red", "badge-red badge-blue"),
    theme().replace("badge-red", "badge-unknown"), theme().replace("badge-red", "badge-custom"),
    theme().replace("class=", 'style="color: red" class='),
    custom().replace(";\"", '; color: red;"'), custom().replace(";\"", '; --simple-badge-color: #123;"'),
    custom().replace("style=", 'style="" style='), custom().replace(' style=', 'style='),
    custom("Text", "#1234"), custom("Text", "rgb(1, 2, 3)"), custom("Text", "#12345678"),
    theme(""), theme("&nbsp;"), theme("A\nB"), theme("A&#10;B"),
    theme() + " surrounding prose", "prefix " + theme(), theme() + "<!-- comment -->",
    `\x60\x60\x60javascript\n${theme()}\n\x60\x60\x60`, `\x60\x60\x60html\n${theme()}`,
  ];
  for (const source of invalid) assert.throws(() => parseBadgeSpans(source), undefined, source);
  assert.throws(() => parseBadgeSpans(theme() + '\n<span class="badge badge-custom">broken</span>'), /^Error: Badge 2: /);
});

test("import validation reports the offending badge in English and Chinese", () => {
  for (const language of ["en", "zh"]) {
    const strings = getTranslations(language);
    assert.throws(() => parseBadgeSpans("", strings), { message: strings.importRequired });
    assert.throws(() => parseBadgeSpans(theme() + custom("broken", "#invalid"), strings),
      { message: strings.importItemError(2, strings.importCustomStyle) });
    assert.throws(() => parseBadgeSpans(theme(""), strings), { message: strings.importItemError(1, strings.requiredText) });
    assert.throws(() => parseBadgeSpans(theme("A\nB"), strings), { message: strings.importItemError(1, strings.singleLine) });
    assert.ok(parseBadgeSpans(strings.importPlaceholder, strings).length === 2);
  }
});

test("import limits bound batch size and reject oversized input before parsing", () => {
  assert.equal(parseBadgeSpans(theme().repeat(MAX_IMPORT_BADGES)).length, MAX_IMPORT_BADGES);
  assert.throws(() => parseBadgeSpans(theme().repeat(MAX_IMPORT_BADGES + 1)),
    { message: getTranslations().importTooMany(MAX_IMPORT_BADGES) });
  assert.throws(() => parseBadgeSpans("x".repeat(MAX_IMPORT_LENGTH + 1)), { message: getTranslations().importTooLarge });
  const maxText = "x".repeat(MAX_IMPORT_LENGTH - theme("").length);
  assert.equal(parseBadgeSpans(theme(maxText))[0].text.length, maxText.length);
  assert.throws(() => parseBadgeSpans('<span class="' + "x".repeat(100_000)));
});

test("import preview counts match first occurrences and distinguish text or color changes", () => {
  const existing = [{ text: "Review", color: "#aabbcc" }];
  const badges = parseBadgeSpans([custom(), theme("Review"), theme("Review"), theme("review"), custom("New")].join("\n"));
  const plan = planPresetImport(badges, existing);
  assert.deepEqual(plan, { newBadges: [{ text: "Review", color: "red" }, { text: "review", color: "red" },
    { text: "New", color: "#aabbcc" }], skipped: 2 });
  badges[1].text = "Changed later";
  assert.equal(plan.newBadges[0].text, "Review");
});

test("batch import appends in source order with one write, stable existing IDs and reload persistence", async () => {
  const original = { schemaVersion: 2, presets: [{ id: "existing", text: "Important", color: "red" }] };
  let persisted = structuredClone(original);
  let saves = 0;
  let notifications = 0;
  const store = new PresetStore({ load: async () => persisted, save: async data => { persisted = structuredClone(data); saves++; } });
  await store.load();
  store.subscribe(() => { notifications++; });
  const badges = parseBadgeSpans([theme(), custom(), theme("New", "pink"), custom("Review", "#AABBCC")].join(" "));
  assert.deepEqual(await store.addMany(badges), { added: 2, skipped: 2 });
  assert.equal(saves, 1);
  assert.equal(notifications, 1);
  assert.deepEqual(store.presets[0], original.presets[0]);
  assert.deepEqual(store.presets.slice(1).map(plain), [{ text: "Review", color: "#aabbcc" }, { text: "New", color: "pink" }]);
  assert.equal(new Set(store.presets.map(preset => preset.id)).size, 3);
  const reopened = new PresetStore({ load: async () => persisted, save: async () => {} });
  await reopened.load();
  assert.deepEqual(reopened.presets, store.presets);
  assert.equal(serializeBadges(reopened.presets.slice(1)), serializeBadges([badges[1], badges[2]]));
});

test("empty and all-duplicate imports do not write, notify, or migrate existing data", async () => {
  let writes = 0;
  let notifications = 0;
  const raw = { schemaVersion: 1, presets: [{ id: "old", text: "Important", color: "red" }] };
  const store = new PresetStore({ load: async () => raw, save: async () => { writes++; } });
  await store.load();
  store.subscribe(() => { notifications++; });
  assert.deepEqual(await store.addMany(parseBadgeSpans(theme().repeat(2))), { added: 0, skipped: 2 });
  assert.deepEqual(await store.addMany([]), { added: 0, skipped: 0 });
  assert.equal(writes, 0);
  assert.equal(notifications, 0);
  assert.deepEqual(store.presets, raw.presets);
});

test("an invalid batch or unloaded store cannot save a valid prefix", async () => {
  let writes = 0;
  const store = new PresetStore({ load: async () => ({ schemaVersion: 2, presets: [] }), save: async () => { writes++; } });
  const valid = { text: "Valid", color: "blue" };
  await assert.rejects(store.addMany([valid]), { message: getTranslations().configNotLoaded });
  await store.load();
  await assert.rejects(store.addMany([valid, { text: "", color: "red" }]));
  assert.throws(() => store.addMany(parseBadgeSpans(theme() + "broken")));
  assert.deepEqual(store.presets, []);
  assert.equal(writes, 0);
});

test("failed batch saves preserve memory and allow a complete retry", async () => {
  const original = { schemaVersion: 1, presets: [{ id: "old", text: "Old", color: "green" }] };
  let persisted = structuredClone(original);
  let fail = true;
  let notifications = 0;
  const store = new PresetStore({ load: async () => persisted, save: async data => {
    if (fail) throw new Error("Disk unavailable");
    persisted = structuredClone(data);
  } });
  await store.load();
  store.subscribe(() => { notifications++; });
  const badges = parseBadgeSpans(theme() + custom());
  await assert.rejects(store.addMany(badges), { message: "Disk unavailable" });
  assert.deepEqual(store.presets, original.presets);
  assert.deepEqual(persisted, original);
  assert.equal(notifications, 0);
  fail = false;
  assert.deepEqual(await store.addMany(badges), { added: 2, skipped: 0 });
  assert.equal(persisted.schemaVersion, 2);
  assert.equal(persisted.presets.length, 3);
  assert.equal(notifications, 1);
});

test("concurrent imports snapshot input and deduplicate against the latest committed batch", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const writes = [];
  const store = new PresetStore({ load: async () => ({ schemaVersion: 2, presets: [] }), save: async data => {
    if (!writes.length) await gate;
    writes.push(structuredClone(data));
  } });
  await store.load();
  const badges = [{ text: " Review ", color: "#ABC" }];
  const first = store.addMany(badges);
  badges[0].text = "Changed";
  badges.push({ text: "Not submitted", color: "red" });
  const second = store.addMany([{ text: "Review", color: "#aabbcc" }, { text: "Next", color: "blue" }]);
  await Promise.resolve();
  assert.deepEqual(store.presets, []);
  release();
  assert.deepEqual(await first, { added: 1, skipped: 0 });
  assert.deepEqual(await second, { added: 1, skipped: 1 });
  assert.equal(writes.length, 2);
  assert.deepEqual(store.presets.map(plain), [{ text: "Review", color: "#aabbcc" }, { text: "Next", color: "blue" }]);
});
