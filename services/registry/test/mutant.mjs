// A copy of @ludion/gate-core's source with one line changed: a Gate that lost one check, to show an
// oracle's judge catches it. The copy is written under node_modules/.cache (gitignored; its bare
// imports resolve from the repository's node_modules) and removed by the caller's cleanup.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let n = 0;

/**
 * @param {string} file  a file in packages/gate-core/src
 * @param {string} from  the exact text to change (must be there: a mutant of nothing proves nothing)
 * @param {string} to
 * @returns {Promise<{ mod: typeof import("@ludion/gate-core"), cleanup: () => void }>}
 */
export async function gateCoreMutant(file, from, to) {
  const dir = path.join(ROOT, "node_modules", ".cache", "ludion-mutants", `${process.pid}-${++n}`);
  fs.cpSync(path.join(ROOT, "packages/gate-core/src"), path.join(dir, "src"), { recursive: true });
  const f = path.join(dir, "src", file);
  const text = fs.readFileSync(f, "utf8");
  if (!text.includes(from)) throw new Error(`mutant: ${file} no longer contains ${JSON.stringify(from)}`);
  fs.writeFileSync(f, text.replace(from, to));
  const mod = await import(pathToFileURL(path.join(dir, "src", "index.mjs")).href);
  return { mod, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
