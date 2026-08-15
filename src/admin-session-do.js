import { DurableObject } from "cloudflare:workers";

export class AdminSessionDO extends DurableObject {
  async get(adminId) { return (await this.ctx.storage.get(`s:${adminId}`)) || null; }
  async set(adminId, value) { await this.ctx.storage.put(`s:${adminId}`, value); return true; }
  async clear(adminId) { await this.ctx.storage.delete(`s:${adminId}`); return true; }
}