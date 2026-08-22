import { DurableObject } from "cloudflare:workers";

const CACHE_TTL_SECONDS = 600;
const WARM_INTERVAL_MS = 24 * 60 * 60 * 1000;

function movieCacheKey(id) {
  return new Request(`https://cache.internal/get-movie?id=${encodeURIComponent(id)}`);
}

function prefixFor(kind) {
  return kind === "leaked" ? "l:" : "m:";
}

export class MovieStoreDO extends DurableObject {
  // kind: "movie" | "leaked"  (default "movie" for backward compat)
  async get(id, kind) {
    if (kind) {
      return (await this.ctx.storage.get(prefixFor(kind) + id)) || null;
    }
    // Try movie first, then leaked (public /get-movie works for both)
    const m = await this.ctx.storage.get("m:" + id);
    if (m) return m;
    return (await this.ctx.storage.get("l:" + id)) || null;
  }

  async put(id, data, kind = "movie") {
    await this.ctx.storage.put(prefixFor(kind) + id, data);
    await this.#ensureWarmAlarm();
    return true;
  }

  async delete(id, kind) {
    if (kind) {
      await this.ctx.storage.delete(prefixFor(kind) + id);
      return true;
    }
    // delete from both if present
    await this.ctx.storage.delete("m:" + id);
    await this.ctx.storage.delete("l:" + id);
    return true;
  }

  async list(cursor, kind = "movie") {
    const prefix = prefixFor(kind);
    const opts = { prefix, limit: 100 };
    if (cursor) opts.startAfter = cursor;
    const page = await this.ctx.storage.list(opts);
    const keys = [...page.keys()];
    const ids = keys.map((k) => k.slice(prefix.length));
    const nextCursor = keys.length === 100 ? keys[keys.length - 1] : null;
    return { ids, cursor: nextCursor, kind };
  }

  async #ensureWarmAlarm() {
    const current = await this.ctx.storage.getAlarm();
    if (!current) await this.ctx.storage.setAlarm(Date.now() + WARM_INTERVAL_MS);
  }

  async alarm() {
    for (const kind of ["movie", "leaked"]) {
      let cursor = null;
      for (;;) {
        const page = await this.list(cursor, kind);
        for (const id of page.ids) {
          const data = await this.get(id, kind);
          if (!data) continue;
          const res = new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
          });
          await caches.default.put(movieCacheKey(id), res);
        }
        cursor = page.cursor;
        if (!cursor) break;
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + WARM_INTERVAL_MS);
  }
}
