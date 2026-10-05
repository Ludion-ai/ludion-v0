// A copy of a package's source with one line changed: a Gate (or a Registry) that lost one check, to
// show an oracle's judge catches it. The copy is written under node_modules/.cache (gitignored; its
// bare imports resolve from the repository's node_modules) and removed by the caller's cleanup.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let n = 0;

/**
 * @param {string} src   the source folder, from the repository root (e.g. "packages/gate-core/src")
 * @param {string} file  the file in it to change
 * @param {string} from  the exact text to change (must be there: a mutant of nothing proves nothing)
 * @param {string} to
 * @param {string} entry the module to import from the copy
 */
export async function sourceMutant(src, file, from, to, entry = "index.mjs") {
  const dir = path.join(ROOT, "node_modules", ".cache", "ludion-mutants", `${process.pid}-${++n}`);
  fs.cpSync(path.join(ROOT, src), path.join(dir, "src"), { recursive: true });
  const f = path.join(dir, "src", file);
  const text = fs.readFileSync(f, "utf8");
  if (!text.includes(from)) throw new Error(`mutant: ${src}/${file} no longer contains ${JSON.stringify(from)}`);
  fs.writeFileSync(f, text.replace(from, to));
  const mod = await import(pathToFileURL(path.join(dir, "src", entry)).href);
  return { mod, dir: path.join(dir, "src"), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** @ludion/gate-core with one line changed. */
export const gateCoreMutant = (file, from, to) => sourceMutant("packages/gate-core/src", file, from, to);
