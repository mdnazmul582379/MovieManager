import { DurableObject } from "cloudflare:workers";

const CACHE_TTL_SECONDS = 600;
const WARM_INTERVAL_MS = 24 * 60 * 60 * 1000;

function movieCacheKey(id) {
  return new Request(`https://cache.internal/get-movie?id=${encodeURIComponent(id)}`);
}

export class MovieStoreDO extends DurableObject {
  async get(id) { return (await this.ctx.storage.get(`m:${id}`)) || null; }

  async put(id, data) {
    await this.ctx.storage.put(`m:${id}`, data);
    await this.#ensureWarmAlarm();
    return true;
  }

  async delete(id) { await this.ctx.storage.delete(`m:${id}`); return true; }

  async list(cursor) {
    const opts = { prefix: "m:", limit: 100 };
    if (cursor) opts.startAfter = cursor;
    const page = await this.ctx.storage.list(opts);
    const keys = [...page.keys()];
    const ids = keys.map((k) => k.slice(2));
    const nextCursor = keys.length === 100 ? keys[keys.length - 1] : null;
    return { ids, cursor: nextCursor };
  }

  async #ensureWarmAlarm() {
    const current = await this.ctx.storage.getAlarm();
    if (!current) await this.ctx.storage.setAlarm(Date.now() + WARM_INTERVAL_MS);
  }

  // Keeps the public /get-movie edge cache warm for every stored movie.
  // Runs entirely inside this Durable Object on its own daily alarm — first
  // scheduled the moment a movie is added — so no Cron Trigger is used.
  async alarm() {
    let cursor = null;
    for (;;) {
      const page = await this.list(cursor);
      for (const id of page.ids) {
        const data = await this.get(id);
        if (!data) continue;
        const res = new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
        });
        await caches.default.put(movieCacheKey(id), res);
      }
      cursor = page.cursor;
      if (!cursor) break;
    }
    await this.ctx.storage.setAlarm(Date.now() + WARM_INTERVAL_MS);
  }
}
