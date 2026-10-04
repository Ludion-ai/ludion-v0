#!/usr/bin/env node
// Does this CI run deploy the preview and run WEB-1 (the human's decision, 2026-10-04: LOOP-2)?
//   - a push to main: always (the preview shows main);
//   - a pull request: only when it touches what the site is built from (site/ and the files the build
//     bundles, as siteHash() reads them) or the workflow that runs the preview.
//
//   node site/changed.mjs --event pull_request --base origin/main    → prints true or false
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED } from "./build.mjs";

/** Path prefixes whose change changes what the preview serves or how it is checked. */
export const PREVIEW_INPUTS = Object.freeze(["site/", ...BUNDLED.map((b) => (b.endsWith(".mjs") ? b : `${b}/`)), ".github/workflows/ci.yml"]);

/** @param {{ event: string, files: string[] }} x */
export function previewNeeded({ event, files }) {
  if (event !== "pull_request") return true;
  return files.some((f) => PREVIEW_INPUTS.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const event = arg("--event") ?? "push";
  let files = [];
  if (event === "pull_request") {
    const base = arg("--base") ?? "origin/main";
    files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
  }
  console.log(previewNeeded({ event, files }) ? "true" : "false");
}
