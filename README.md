# Simple Badge

English | [简体中文](README.zh-CN.md)

Right-click in an Obsidian Markdown editor and choose **Insert Badge** to preview, create, and insert multiple text badges in the order you select them. Current version: **0.3.0**.

```html
<span class="badge badge-red">Important</span> <span class="badge badge-green">Done</span>
```

The plugin includes blue, green, purple, and red styles with fixed sizing, rounded corners, and other appearance settings. No separate CSS snippet is required.

The interface follows Obsidian's language: Chinese language settings use Simplified Chinese, and all other languages use English. This includes menus, dialogs, settings, color names, status messages, and accessibility labels.

To use the English interface, choose **English** under **Settings → General → Language**, then restart Obsidian when prompted. Saved preset text is preserved when you switch languages. This guide includes the corresponding Chinese labels for plugin controls.

## Insert multiple badges

1. Right-click at the desired position in a Markdown editor and choose **Insert Badge (插入 Badge)**.
2. Presets appear as rendered badges on the left. Click the circular button before a badge to select it. The button displays its selection order, starting at 1.
3. Select more presets as needed. Clicking a selected button deselects that badge and renumbers the remaining selections. Selecting it again adds it to the end.
4. The **Insertion order (插入顺序)** area below shows the current selection. Click an item there to remove it.
5. Click **Insert selected badges (插入选定 Badge)** in the bottom-right corner to insert complete span elements, with one space between adjacent spans.

A fresh insertion session starts with no badges selected. Clicking Cancel or pressing Esc closes the dialog without inserting text.

## Create a badge while inserting

Enter text and choose a color on the right side of the dialog. The preview updates immediately.

- Click **Add to selection (加入本次选择)** to append a temporary badge to the current insertion order.
- Check **Also save as preset (同时保存为预设)**, then click **Add to selection and save preset (加入选择并保存预设)** to also save the badge in the preset list for future use.
- Saving takes effect immediately. Canceling the insertion dialog afterward does not undo a preset that has already been saved.
- Text cannot be empty, and leading and trailing whitespace is trimmed. Text is treated as plain text; `&`, `<`, and `>` are automatically escaped in the generated HTML.
- Badges with identical text and color reuse an existing entry and are not added to the same selection more than once. Badges with the same text but different colors can be saved separately.

## Manage presets

Open Obsidian **Settings → Community plugins → Installed plugins → ⋮ next to Simple Badge → Settings**. You can also select **Simple Badge** under the Community plugins section in the settings sidebar. The exact location and appearance of these controls may vary by Obsidian version.

The settings page lets you add, edit, delete, and move presets up or down. Every entry shows a rendered preview. Preset order controls how badges are displayed; insertion order always follows your selection order in the insertion dialog.

On first use, the plugin provides four example presets in the interface language: Information (blue), Done (green), Note (purple), and Important (red) in English; 信息、完成、备注、重要 in Chinese. You can edit or delete all of them. Deliberately clearing the list does not restore the defaults. Existing saved presets are never translated automatically.

Presets are stored in `.obsidian/plugins/simple-badge/data.json` in the current vault. If saving fails, an error is displayed and your input is retained so you can retry. If the configuration is invalid or uses an unsupported version, the plugin asks you to check the file instead of overwriting it with defaults.

Editing or deleting a preset does not change spans already inserted in notes or silently change selections in an insertion dialog that is already open.

## Editor behavior

- Supports the Markdown editor context menu in Source mode and Live Preview on desktop.
- Uses the primary cursor position captured when the context menu opens. If text is selected, the original text is preserved and badges are inserted at the end of the primary selection.
- Adds one space between adjacent spans, without adding other spaces, line breaks, or placeholder text.
- Places the cursor after the entire batch. A single undo or redo applies to the whole batch.
- If the note changes after the dialog opens, or the original editor is no longer valid, attempting to insert prompts you to **Choose a new position (重新定位)**. Click that button, then right-click at a new position to reopen the insertion dialog with your selection and draft preserved.
- The saved insertion session is held only in memory. Canceling the reopened dialog, disabling the plugin, or exiting Obsidian ends that session.
- Reading view renders the badges. Editing modes follow Obsidian's native inline HTML behavior.
- Disabling the plugin leaves the HTML in your notes. To retain the styling independently, copy the `.badge` rule and the four color rules at the beginning of `styles.css` into a CSS snippet and enable it.

## Development and testing

Requires Node.js 20+ and pnpm.

```sh
pnpm install
pnpm build
pnpm test
```

`pnpm dev` watches the source and rebuilds it. `pnpm typecheck` runs type checking separately. Watch mode does not automatically copy files to the vault or reload the plugin.

The 17 automated tests cover selection order, deselection and reselection, selection snapshots, special characters, batch editor transactions, default and empty configurations, duplicates, preset creation/editing/deletion/reordering, reloading, concurrent saves, recovery from failed saves, language resolution, translated defaults and errors, and preservation of saved presets across languages.

The following behaviors have also been verified in the Develop vault on Windows with Obsidian **1.13.7**: numbered selection, renumbering after deselection, mixed insertion of temporary and saved badges, HTML escaping, undo and redo of a complete batch, preset management in settings, preset persistence after re-enabling the plugin, a single context-menu entry after reloading, and preserving a selection while choosing a new insertion position after the note changes. Examples remain in `Simple Badge 示例.md` in that test vault.

Version 0.3.0 was also checked with Obsidian set to English: the context menu, insertion dialog, selection count, success messages, settings page, and preset editor displayed English correctly. Inserting an English temporary badge together with an existing Chinese preset preserved selection order and escaped special characters; a single undo restored the original note. Switching back to Chinese restored the Chinese interface. The note and preset data files matched their original hashes after testing.

The manifest declares a minimum Obsidian version of 1.1.1. Automatic language detection uses the public `getLanguage()` API introduced in Obsidian 1.8.7; versions without that API fall back to English. Older versions, other themes, and mobile have not been verified through actual UI testing; the plugin currently declares desktop-only support. Older embedded browsers that do not support `color-mix()` retain the base badge background.

## Deployment and installation

```sh
pnpm build
pnpm run deploy:dev
```

These commands deploy `main.js`, `manifest.json`, and `styles.css` to the configured development vault:

```text
D:\Notes\Develop\.obsidian\plugins\simple-badge
```

For another vault:

```sh
pnpm run deploy "D:/path/to/vault"
```

Enable **Simple Badge** in Obsidian under **Settings → Community plugins**. After updating, disable and re-enable the plugin to reload it.

Alternatively, extract the three files from `simple-badge-0.3.0.zip` into `.obsidian/plugins/simple-badge/` in the target vault, then enable the plugin. Preserve the existing `data.json` when updating.

The deployment script copies only the three plugin files. It does not modify preset data, the enabled-plugin list, or other plugin settings.

## Source layout

- `src/main.ts`: Context-menu entry, editor position validation, and plugin lifecycle.
- `src/i18n.ts`: English and Simplified Chinese translations and language resolution.
- `src/insert-modal.ts`: Preset selection, badge creation, and batch insertion dialog.
- `src/settings.ts`: Obsidian settings page and preset editor dialog.
- `src/badge-form.ts`: Shared text, color, and preview form used by both dialogs.
- `src/model.ts`: Preset types, configuration validation, selection order, and HTML serialization.
- `src/preset-store.ts`: Preset operations and serialized persistence.
- `src/badge.ts`: Safe DOM previews and batch editor transactions.
- `styles.css`: Fixed badge styles and plugin interface layout.
- `tests/core.test.mjs`: Core behavior tests.
- `scripts/deploy.mjs`: Copies build artifacts to a specified vault.
