// gitleaks, pinned (ADR-042): the release for this platform, downloaded once into the tools directory
// (LUDION_TOOLS, default ~/.cache/ludion-tools) and refused unless its SHA-256 is the pinned one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const GITLEAKS_VERSION = "8.30.1";
// From gitleaks_8.30.1_checksums.txt of the GitHub release.
const ASSETS = {
  "linux-x64": { file: `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`, sha256: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb" },
  "win32-x64": { file: `gitleaks_${GITLEAKS_VERSION}_windows_x64.zip`, sha256: "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e" },
};
const TOOLS = process.env.LUDION_TOOLS ?? path.join(os.homedir(), ".cache", "ludion-tools");

/** The path of the pinned gitleaks binary, fetching it if needed. Throws if the bytes are not the pinned ones. */
export async function gitleaks() {
  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`no pinned gitleaks for ${process.platform}-${process.arch}`);
  const dir = path.join(TOOLS, `gitleaks-${GITLEAKS_VERSION}`);
  const bin = path.join(dir, process.platform === "win32" ? "gitleaks.exe" : "gitleaks");
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(TOOLS, asset.file);
  if (!fs.existsSync(archive)) {
    const r = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${asset.file}`);
    if (!r.ok) throw new Error(`gitleaks download: HTTP ${r.status}`);
    fs.writeFileSync(`${archive}.part`, Buffer.from(await r.arrayBuffer()));
    fs.renameSync(`${archive}.part`, archive);
  }
  const sha = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  if (sha !== asset.sha256) { fs.rmSync(archive); throw new Error(`${asset.file} has SHA-256 ${sha}, not the pinned ${asset.sha256}; removed`); }
  if (asset.file.endsWith(".zip")) execFileSync("tar", ["-xf", archive, "-C", dir]);
  else execFileSync("tar", ["-xzf", archive, "-C", dir]);
  return bin;
}

/**
 * Run gitleaks; returns its findings (secrets redacted). It runs inside `target`, so paths are
 * relative to it, as .gitleaks.toml writes them.
 * @param {string} bin @param {"git"|"dir"} mode @param {string} target @param {{ config: string }} o
 */
export function scan(bin, mode, target, { config }) {
  const report = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ludion-gitleaks-")), "report.json");
  try {
    execFileSync(bin, [mode, "--no-banner", "--redact", "--config", config, "--report-format", "json", "--report-path", report, "--exit-code", "0", "."],
      { cwd: target, stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 });
    return JSON.parse(fs.readFileSync(report, "utf8"));
  } finally { fs.rmSync(path.dirname(report), { recursive: true, force: true }); }
}
