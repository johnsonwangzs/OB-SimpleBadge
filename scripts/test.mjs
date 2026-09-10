import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const output = new URL("../node_modules/.cache/simple-badge-tests.mjs", import.meta.url);
await mkdir(new URL(".", output), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("../tests/core.test.mjs", import.meta.url))],
  outfile: fileURLToPath(output), bundle: true, platform: "node", format: "esm", target: "node20",
});
const result = spawnSync(process.execPath, ["--test", fileURLToPath(output)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
