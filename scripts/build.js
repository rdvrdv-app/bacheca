// Build di produzione: precompila il JSX di index.html con esbuild e scrive dist/.
// Elimina babel-standalone (~1,5 MB) e la compilazione nel browser a ogni apertura.
// Uso: npm install esbuild && node scripts/build.js
const { readFileSync, writeFileSync, mkdirSync, copyFileSync } = require("node:fs");
const { join } = require("node:path");
const { transformSync } = require("esbuild");

const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");

const m = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
if (!m) throw new Error("Script babel non trovato in index.html");

const { code } = transformSync(m[1], { loader: "jsx", target: "es2020", minify: true });

let out = html.replace(m[0], () => `<script>\n${code}\n</script>`);
out = out.replace(/[ \t]*<script src="[^"]*babel-standalone[^"]*"><\/script>\n?/, "");

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "index.html"), out);
for (const f of ["maintenance.html", "manifest.json", "sw.js", "icon.svg"]) {
  copyFileSync(join(root, f), join(root, "dist", f));
}
console.log(`Build OK → dist/ (JSX precompilato: ${(code.length / 1024).toFixed(0)} KB)`);
