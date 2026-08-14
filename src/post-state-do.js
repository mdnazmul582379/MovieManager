import { DurableObject } from "cloudflare:workers";

/**
 * Sharded Share Movie state.
 * Each logical scope (user drafts/session/menu or forwarded-post key)
 * is mapped to its own Durable Object instance by the caller.
 */
export class PostStateDO extends DurableObject {
  async get(key) {
    const record = await this.ctx.storage.get(key);
    if (!record) return null;
    if (record && typeof record === "object" && Number.isFinite(record.expiresAt)) {
      if (record.expiresAt <= Date.now()) {
        await this.ctx.storage.delete(key);
        return null;
      }
      return record.value ?? null;
    }
    return record;
  }

  async put(key, value, ttlSeconds = 0) {
    const expiresAt = Number(ttlSeconds) > 0 ? Date.now() + Number(ttlSeconds) * 1000 : 0;
    await this.ctx.storage.put(key, { value, expiresAt });
    return true;
  }

  async delete(key) {
    await this.ctx.storage.delete(key);
    return true;
  }
}
