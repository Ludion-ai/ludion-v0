#!/usr/bin/env node
// Put Keycloak KEYCLOAK_VERSION in the tools directory for MCP-1/MCP-2 (accept/mcp/keycloak.mjs):
// download the release zip from GitHub, refuse it unless its SHA-256 is the pinned one, unpack it.
// Does nothing when it is already there. Java 21 comes from the machine (CI: actions/setup-java).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { KEYCLOAK_VERSION, KEYCLOAK_ZIP_URL, KEYCLOAK_ZIP_SHA256, TOOLS, tools } from "./keycloak.mjs";

const home = path.join(TOOLS, `keycloak-${KEYCLOAK_VERSION}`);
if (fs.existsSync(path.join(home, "bin"))) {
  console.log(`Keycloak ${KEYCLOAK_VERSION}: ${home}`);
} else {
  fs.mkdirSync(TOOLS, { recursive: true });
  const zip = path.join(TOOLS, `keycloak-${KEYCLOAK_VERSION}.zip`);
  if (!fs.existsSync(zip)) {
    const r = await fetch(KEYCLOAK_ZIP_URL);
    if (!r.ok) { console.error(`✖ ${KEYCLOAK_ZIP_URL}: HTTP ${r.status}`); process.exit(1); }
    fs.writeFileSync(`${zip}.part`, Buffer.from(await r.arrayBuffer()));
    fs.renameSync(`${zip}.part`, zip);
  }
  const sha = createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
  if (sha !== KEYCLOAK_ZIP_SHA256) {
    fs.rmSync(zip);
    console.error(`✖ keycloak-${KEYCLOAK_VERSION}.zip has SHA-256 ${sha}, not the pinned ${KEYCLOAK_ZIP_SHA256}; removed`);
    process.exit(1);
  }
  if (process.platform === "win32") execFileSync("tar", ["-xf", zip, "-C", TOOLS], { stdio: "inherit" });
  else execFileSync("unzip", ["-q", "-o", zip, "-d", TOOLS], { stdio: "inherit" });
  console.log(`Keycloak ${KEYCLOAK_VERSION}: unpacked to ${home} (SHA-256 ${sha.slice(0, 16)}…)`);
}
const { missing } = tools();
if (missing.length) { console.error(`✖ still missing: ${missing.join("; ")}`); process.exit(1); }
