import { DurableObject } from "cloudflare:workers";

export class MovieStoreDO extends DurableObject {
  async get(id) { return (await this.ctx.storage.get(`m:${id}`)) || null; }
  async put(id, data) { await this.ctx.storage.put(`m:${id}`, data); return true; }
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
}
