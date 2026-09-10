import { copyFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vaultArgument = process.argv[2];
if (!vaultArgument) throw new Error('Usage: pnpm run deploy "D:/path/to/vault"');

const vault = await realpath(resolve(vaultArgument));
const config = join(vault, ".obsidian");
if (!(await stat(config)).isDirectory()) throw new Error("The vault must contain an .obsidian directory.");

const manifest = JSON.parse(await readFile(join(project, "manifest.json"), "utf8"));
if (!/^[a-z0-9-]+$/.test(manifest.id)) throw new Error("Invalid plugin ID.");
const files = ["main.js", "manifest.json", "styles.css"];
for (const file of files) {
  if (!(await stat(join(project, file))).isFile()) throw new Error(`Missing ${file}; run pnpm build first.`);
}

const destination = join(config, "plugins", manifest.id);
await mkdir(destination, { recursive: true });
for (const file of files) await copyFile(join(project, file), join(destination, file));
console.log(`Deployed Simple Badge ${manifest.version} to ${destination}`);
console.log("Enable Simple Badge in Obsidian, or toggle it off and on to reload an update.");
