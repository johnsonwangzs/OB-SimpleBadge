import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
const options = {
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "browser",
  target: "es2018",
  sourcemap: watch ? "inline" : false,
  treeShaking: true,
  logLevel: "info",
  banner: { js: `/* Simple Badge — generated from src/main.ts.\n\n${readFileSync(new URL("./THIRD-PARTY-NOTICES.txt", import.meta.url), "utf8")}\n*/` },
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
