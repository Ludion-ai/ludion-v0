// The Registry's store on a Cloudflare Durable Object (ADR-041): the same contract as
// createMemoryStore, one storage key per record (a Durable Object value has a size limit, so the
// whole state is never one value). A Durable Object runs one request at a time (its input gate), so
// each read-then-write here is atomic, as the memory store's is.
//
// `storage` is a Durable Object's `ctx.storage` (get/put/list/delete), or anything with that shape.

const REV = (seq) => `rev:${String(seq).padStart(12, "0")}`;
/** The most keys one storage call is given (the key-value API's batch limit). */
const BATCH = 128;
/** How often, at most, the expired rate-limit counters are swept (one listing of all of them). */
const SWEEP_S = 60;

/** @param {{ get(k: string): Promise<any>, put(k: string|object, v?: any): Promise<void>, list(o: object): Promise<Map<string, any>>, delete(k: string|string[]): Promise<any> }} storage */
export async function createDurableStore(storage) {
  let seq = (await storage.get("seq")) ?? 0;
  let stapleCount = (await storage.get("stapleCount")) ?? 0;
  let ver = (await storage.get("ver")) ?? 0;
  let swept = -Infinity;
  return {
    getDiver: (id) => storage.get(`diver:${id}`),
    /** Every change to a Diver takes the next version (the bulk copy's delta, REG-5). */
    async putDiver(id, rec) {
      const next = ver + 1;
      await storage.put({ [`diver:${id}`]: { ...rec, ver: next }, ver: next });
      ver = next;
    },
    async listDivers() { return [...(await storage.list({ prefix: "diver:" })).values()]; },
    async version() { return ver; },
    getPrincipal: (credentialId) => storage.get(`principal:${credentialId}`),
    /** false if the credential is already registered (a key is never replaced). */
    async addPrincipal(rec) {
      if ((await storage.get(`principal:${rec.id}`)) !== undefined) return false;
      await storage.put(`principal:${rec.id}`, rec);
      return true;
    },
    putPrincipal: (rec) => storage.put(`principal:${rec.id}`, rec),
    getMandate: (jti) => storage.get(`mandate:${jti}`),
    putMandate: (jti, rec) => storage.put(`mandate:${jti}`, rec),
    /** Record a consent's challenge; false if it was already used (checked and set in one step). */
    async useConsent(challenge, untilS, nowS) {
      const all = await storage.list({ prefix: "consent:" });
      const stale = [...all].filter(([, t]) => t < nowS).map(([k]) => k);
      if (stale.length) await storage.delete(stale);
      const key = `consent:${challenge}`;
      if (all.has(key) && !stale.includes(key)) return false;
      await storage.put(key, untilS);
      return true;
    },
    async appendRevocation(make) {
      const next = seq + 1;
      const entry = await make(next);
      await storage.put({ [REV(next)]: entry, seq: next });
      seq = next;
      return entry;
    },
    async revocationsSince(after) {
      const m = await storage.list({ prefix: "rev:", start: REV(after + 1) });
      return [...m.values()];
    },
    async countStaple() { stapleCount++; await storage.put("stapleCount", stapleCount); },
    /**
     * One more in `key`'s fixed window of `windowS`: the count with this one, and when the window ends.
     * It reads only its own counter (an expired one counts as gone); the expired are swept at most
     * once a minute, so a busy hour costs one listing a minute, not one per registration.
     */
    async hit(key, windowS, nowS) {
      if (nowS - swept >= SWEEP_S) {
        swept = nowS;
        const stale = [...(await storage.list({ prefix: "hit:" }))].filter(([, h]) => h.until <= nowS).map(([k]) => k);
        for (let i = 0; i < stale.length; i += BATCH) await storage.delete(stale.slice(i, i + BATCH));
      }
      const k = `hit:${key}`;
      const got = await storage.get(k);
      const prev = got && got.until > nowS ? got : undefined;
      const h = { n: (prev?.n ?? 0) + 1, until: prev?.until ?? nowS + windowS };
      await storage.put(k, h);
      return h;
    },
    get state() { return { seq }; },
  };
}

/** An in-memory stand-in for a Durable Object's storage, with its API's shape (tests, local runs). */
export function memoryStorage() {
  const m = new Map();
  return {
    async get(k) { return structuredClone(m.get(k)); },
    async put(k, v) { if (typeof k === "object") { for (const [a, b] of Object.entries(k)) m.set(a, structuredClone(b)); } else m.set(k, structuredClone(v)); },
    async list({ prefix = "", start } = {}) {
      return new Map([...m].filter(([k]) => k.startsWith(prefix) && (start == null || k >= start)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, structuredClone(v)]));
    },
    async delete(k) { for (const x of [].concat(k)) m.delete(x); },
    get size() { return m.size; },
  };
}
