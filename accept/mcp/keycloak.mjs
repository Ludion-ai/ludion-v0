// A real MCP authorization server for MCP-1 and MCP-2 (ADR-039): Keycloak with CIMD on, in memory,
// on this machine. Nothing here is mocked: Keycloak fetches the card over TLS from the Card Host,
// reads the session keys from the card's jwks_uri, and checks the client assertion itself.
//
// Tools: Java 21 (JAVA_HOME) and Keycloak KEYCLOAK_VERSION (KEYCLOAK_HOME). Both default to
// ~/.cache/ludion-tools (LUDION_TOOLS); `node accept/mcp/fetch-keycloak.mjs` puts Keycloak there,
// checked against KEYCLOAK_ZIP_SHA256.
//
// Names: Keycloak resolves through its own hosts file (-Djdk.net.hosts.file), so a card can live at
// its production name (https://dvr-….agents.ludion.ai) on 127.0.0.1 without touching the machine's
// DNS. TLS: a self-signed certificate for that one name, trusted by this Keycloak alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

export const KEYCLOAK_VERSION = "26.8.0";
export const KEYCLOAK_ZIP_URL = `https://github.com/keycloak/keycloak/releases/download/${KEYCLOAK_VERSION}/keycloak-${KEYCLOAK_VERSION}.zip`;
export const KEYCLOAK_ZIP_SHA256 = "7ed1de3fda2598369262613bf682aab7e233d80a38c405e91588f7a7454370a1";
export const TOOLS = process.env.LUDION_TOOLS ?? path.join(os.homedir(), ".cache", "ludion-tools");
const WIN = process.platform === "win32";

/** Where Java and Keycloak are, and what is missing. */
export function tools() {
  const kc = process.env.KEYCLOAK_HOME ?? path.join(TOOLS, `keycloak-${KEYCLOAK_VERSION}`);
  let java = process.env.JAVA_HOME;
  if (!java && fs.existsSync(TOOLS)) {
    const d = fs.readdirSync(TOOLS).find((x) => /^jdk-21/.test(x));
    if (d) java = path.join(TOOLS, d);
  }
  const missing = [];
  if (!java || !fs.existsSync(path.join(java, "bin", WIN ? "java.exe" : "java"))) missing.push("Java 21 (set JAVA_HOME)");
  if (!fs.existsSync(path.join(kc, "bin", WIN ? "kc.bat" : "kc.sh"))) missing.push(`Keycloak ${KEYCLOAK_VERSION} (node accept/mcp/fetch-keycloak.mjs, or set KEYCLOAK_HOME)`);
  return { java, kc, missing };
}

export const freePort = () => new Promise((ok, no) => {
  const s = net.createServer().once("error", no).listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});

/**
 * A self-signed certificate for one DNS name (a wildcard is fine): { pfx, passphrase } for Node, and
 * a PEM for Keycloak's truststore.
 */
export function certificateFor(dnsName, { java, dir }) {
  const keytool = path.join(java, "bin", WIN ? "keytool.exe" : "keytool");
  const p12 = path.join(dir, "tls.p12"), pem = path.join(dir, "tls.pem"), passphrase = randomBytes(12).toString("hex");
  execFileSync(keytool, ["-genkeypair", "-alias", "tls", "-keyalg", "EC", "-groupname", "secp256r1", "-dname", `CN=${dnsName.replace(/^\*\./, "")}`, "-ext", `SAN=dns:${dnsName}`,
    "-validity", "2", "-keystore", p12, "-storetype", "PKCS12", "-storepass", passphrase], { stdio: "ignore" });
  execFileSync(keytool, ["-exportcert", "-rfc", "-alias", "tls", "-keystore", p12, "-storepass", passphrase, "-file", pem], { stdio: "ignore" });
  return { pfx: fs.readFileSync(p12), passphrase, pem };
}

/**
 * The realm an authorization server sets up to accept Ludion agents by their card URL (CIMD): the
 * client-id-uri condition picks client_ids under the agents' domain, and the CIMD executor fetches
 * the card, takes only confidential clients (private_key_jwt with keys from jwks_uri), and allows
 * the loopback redirects every card lists (ADR-039).
 */
export function cimdRealm({ name = "mcp", agents = "*.agents.ludion.ai", user }) {
  return {
    realm: name, enabled: true,
    users: [{ username: user.username, enabled: true, email: `${user.username}@example.test`, emailVerified: true, firstName: "Test", lastName: "User",
      credentials: [{ type: "password", value: user.password, temporary: false }] }],
    clientProfiles: { profiles: [{ name: "ludion-cimd", executors: [{ executor: "client-id-metadata-document",
      configuration: { "cimd-allow-permitted-domains": [agents, "127.0.0.1", "[::1]"], "only-allow-confidential-client": "true" } }] }] },
    clientPolicies: { policies: [{ name: "ludion-cimd", enabled: true, profiles: ["ludion-cimd"],
      conditions: [{ condition: "client-id-uri", configuration: { "client-id-uri-scheme": ["https"], "client-id-uri-allow-permitted-domains": [agents] } }] }] },
  };
}

/**
 * Start Keycloak (start-dev, in-memory database, CIMD on) and wait until it answers.
 * @param {{ java: string, kc: string, dir: string, hosts: Record<string, string>, trust: string[], startTimeoutMs?: number }} o
 * @returns {Promise<{ url: string, admin: { username: string, password: string }, log: () => string, stop: () => void }>}
 */
export async function startKeycloak({ java, kc, dir, hosts, trust, startTimeoutMs = 240_000 }) {
  const port = await freePort();
  const hostsFile = path.join(dir, "hosts");
  fs.writeFileSync(hostsFile, [...Object.entries(hosts).map(([name, ip]) => `${ip} ${name}`), "127.0.0.1 localhost", "::1 localhost", ""].join("\n"));
  const logFile = path.join(dir, "keycloak.log");
  const fd = fs.openSync(logFile, "w");
  const admin = { username: "admin", password: randomBytes(12).toString("hex") };
  const args = ["start-dev", "--db=dev-mem", "--features=cimd", "--http-host=127.0.0.1", `--http-port=${port}`, `--truststore-paths=${trust.join(",")}`, "--log-level=INFO"];
  const env = { ...process.env, JAVA_HOME: java, KC_BOOTSTRAP_ADMIN_USERNAME: admin.username, KC_BOOTSTRAP_ADMIN_PASSWORD: admin.password,
    JAVA_OPTS_APPEND: `-Djdk.net.hosts.file=${hostsFile}` };
  const child = WIN
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", path.join(kc, "bin", "kc.bat"), ...args], { env, stdio: ["ignore", fd, fd], windowsHide: true })
    : spawn(path.join(kc, "bin", "kc.sh"), args, { env, stdio: ["ignore", fd, fd], detached: true });
  let exited = null;
  child.on("exit", (code) => { exited = code ?? "signal"; });
  const stop = () => {
    try {
      if (WIN) execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGKILL");
    } catch { /* already gone */ }
    try { fs.closeSync(fd); } catch { /* closed */ }
  };
  const url = `http://127.0.0.1:${port}`;
  const log = () => fs.readFileSync(logFile, "utf8");
  const t0 = Date.now();
  for (;;) {
    try { if ((await fetch(`${url}/realms/master`)).ok) break; } catch { /* not yet */ }
    if (exited !== null) { const l = log(); stop(); throw new Error(`Keycloak exited (${exited}) before it answered:\n${l.slice(-2000)}`); }
    if (Date.now() - t0 > startTimeoutMs) { const l = log(); stop(); throw new Error(`Keycloak did not answer in ${startTimeoutMs} ms:\n${l.slice(-2000)}`); }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return { url, admin, log, stop, startedInMs: Date.now() - t0 };
}

/** Create a realm through the admin API. */
export async function createRealm(kc, realm) {
  const form = new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: kc.admin.username, password: kc.admin.password });
  const t = await fetch(`${kc.url}/realms/master/protocol/openid-connect/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  if (!t.ok) throw new Error(`admin token: ${t.status} ${await t.text()}`);
  const { access_token } = await t.json();
  const r = await fetch(`${kc.url}/admin/realms`, { method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" }, body: JSON.stringify(realm) });
  if (r.status !== 201) throw new Error(`create realm: ${r.status} ${await r.text()}`);
}

/** Why Keycloak refused a card, from its log: CIMD's own reason, or the JSON field it could not read. */
export function refusalsInLog(text) {
  const out = [];
  for (const m of text.matchAll(/Unrecognized field "([^"]+)"/g)) out.push(`unrecognized field "${m[1]}"`);
  for (const m of text.matchAll(/client_policy_error_detail="([^"]+)"/g)) out.push(m[1]);
  for (const m of text.matchAll(/type="LOGIN_ERROR"[^\n]*?error="([^"]+)"/g)) if (m[1] !== "invalid_request") out.push(m[1]);
  for (const m of text.matchAll(/type="CLIENT_LOGIN_ERROR"[^\n]*error="([^"]+)"(?:[^\n]*reason="([^"]+)")?/g)) out.push(`client login: ${m[1]}${m[2] ? ` (${m[2]})` : ""}`);
  return [...new Set(out)];
}
