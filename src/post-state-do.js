import { DurableObject } from "cloudflare:workers";

/**
 * Small, key-sharded Durable Object used instead of KV for Share Movie's
 * short-lived drafts, sessions, menus, and forwarded-post metadata.
 *
 * Each logical key gets its own DO instance, so unrelated users/records do
 * not serialize behind one global state object.
 */
export class PostStateDO extends DurableObject {
  async get(key = "value") {
    const record = await this.ctx.storage.get(key);
    if (!record) return null;
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      await this.ctx.storage.delete(key);
      return null;
    }
    return record.value;
  }

  async put(key = "value", value, options = {}) {
    const ttl = Number(options?.expirationTtl || 0);
    const record = {
      value,
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
    };
    await this.ctx.storage.put(key, record);
    if (record.expiresAt) {
      await this.ctx.storage.setAlarm(record.expiresAt);
    }
    return true;
  }

  async delete(key = "value") {
    await this.ctx.storage.delete(key);
    return true;
  }

  async alarm() {
    const now = Date.now();
    const entries = await this.ctx.storage.list();
    let next = null;

    for (const [key, record] of entries) {
      if (record?.expiresAt && record.expiresAt <= now) {
        await this.ctx.storage.delete(key);
      } else if (record?.expiresAt && (!next || record.expiresAt < next)) {
        next = record.expiresAt;
      }
    }

    if (next) await this.ctx.storage.setAlarm(next);
  }
}
