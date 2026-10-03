// Every module a Worker loads, resolved the way a Workers bundler does (the `workerd`, `worker`,
// `import`, `default` conditions), and the Node built-ins among them. Used by PRIV-5 (the Card Host
// loads none) and the Registry Worker's test (it loads only what nodejs_compat provides).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const IMPORTS = /(?:^|[;\s])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const BARE_BUILTIN = /^(assert|async_hooks|buffer|child_process|crypto|dns|events|fs|http|https|module|net|os|path|perf_hooks|process|stream|string_decoder|timers|tls|url|util|worker_threads|zlib)(\/.*)?$/;

function resolveBare(spec, fromFile) {
  const parts = spec.split("/"), name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const sub = "." + spec.slice(name.length);
  for (let dir = path.dirname(fromFile); ; dir = path.dirname(dir)) {
    const pkgDir = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(pkgDir, "package.json"))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
      const ex = pkg.exports;
      const conditional = ex && typeof ex === "object" && !Object.keys(ex).some((k) => k.startsWith("."));
      let target = ex === undefined ? undefined : typeof ex === "string" || conditional ? (sub === "." ? ex : undefined) : ex[sub];
      while (target && typeof target === "object") target = target.workerd ?? target.worker ?? target.import ?? target.default;
      if (!target && ex === undefined && sub === ".") target = pkg.module ?? pkg.main ?? "index.js";
      if (!target) throw new Error(`${spec} does not resolve from ${fromFile}`);
      return fs.realpathSync(path.join(pkgDir, target));
    }
    if (path.dirname(dir) === dir) throw new Error(`${spec} is not installed (from ${fromFile})`);
  }
}

/** @returns {{ files: string[], builtins: string[] }} builtins as "<file relative to the repo> → <specifier>" */
export function importGraph(entry) {
  const seen = new Set(), builtins = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of src.matchAll(IMPORTS)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith("node:") || BARE_BUILTIN.test(spec)) builtins.push(`${path.relative(ROOT, file).split(path.sep).join("/")} → ${spec}`);
      else visit(spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : resolveBare(spec, file));
    }
  };
  visit(fs.realpathSync(entry));
  return { files: [...seen], builtins };
}
