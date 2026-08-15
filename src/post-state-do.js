import { DurableObject } from "cloudflare:workers";

// PostStateDO replaces the old POST_QUEUE KV namespace. It holds every
// short-lived piece of state the "Post Movie" module needs — drafts,
// composing sessions, the current submenu, and forwarded-message links —
// none of which is ever read from a public endpoint, so a KV namespace (and
// its account-wide limits) was never actually needed for it.
//
// It mimics just enough of the KV API (get/put/delete, with an optional TTL
// in seconds on put) that post.js's own get/set helper functions barely had
// to change. Expired entries are dropped lazily on read, and swept up
// periodically by this Durable Object's own alarm — so cleanup needs zero
// Cron Triggers and zero account-level scheduling.
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class PostStateDO extends DurableObject {
  async get(key) {
    const rec = await this.ctx.storage.get(key);
    if (rec === undefined || rec === null) return null;
    if (rec.expiresAt && rec.expiresAt < Date.now()) {
      await this.ctx.storage.delete(key);
      return null;
    }
    return rec.value;
  }

  async put(key, value, ttlSeconds) {
    await this.ctx.storage.put(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
    await this.#ensureSweepScheduled();
    return true;
  }

  async delete(key) {
    await this.ctx.storage.delete(key);
    return true;
  }

  async #ensureSweepScheduled() {
    const current = await this.ctx.storage.getAlarm();
    if (!current) await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  // Runs entirely inside this Durable Object — no Cron Trigger involved.
  async alarm() {
    const now = Date.now();
    let cursor;
    for (;;) {
      const page = await this.ctx.storage.list(cursor ? { startAfter: cursor, limit: 200 } : { limit: 200 });
      if (page.size === 0) break;
      let last;
      for (const [key, rec] of page) {
        last = key;
        if (rec && rec.expiresAt && rec.expiresAt < now) await this.ctx.storage.delete(key);
      }
      if (page.size < 200) break;
      cursor = last;
    }
    await this.ctx.storage.setAlarm(now + SWEEP_INTERVAL_MS);
  }
}
