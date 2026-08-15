// ============================================================================
// index.js — single entry point for the combined Movie Manager worker.
//
// This file ONLY does routing:
//   - one Telegram webhook, one bot token, one root menu
//   - decides whether an admin's message belongs to the "Movie Data" module
//     (data.js) or the "Post Manager" module (post.js), and hands it off
//   - re-exports every Durable Object class both modules need
//
// All the actual feature logic lives in data.js and post.js untouched, so
// neither module can conflict with the other's state or DOs. There is no KV
// namespace and no Cron Trigger anywhere in this worker: every piece of
// state lives in a Durable Object, and the two periodic maintenance tasks
// (movie cache warm-up, stale-session sweep) run on their own DO alarms.
// ============================================================================

export { MovieStoreDO } from "./movie-store-do.js";
export { AdminSessionDO } from "./admin-session-do.js";
export { PostStateDO, ScheduleDO, CacheQueueDO } from "./post.js";

import {
  handleDataUpdate,
  handleGetMovie,
  sendMoviesMenu,
  clearDataSession,
  corsHeaders,
} from "./data.js";

import {
  handlePostUpdate,
  handlePostCallback,
} from "./post.js";

function isAdmin(env, id) {
  const list = (env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(String(id));
}

async function tgSend(env, chatId, text, markup) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: markup }),
  });
  const data = await res.json();
  if (!data.ok) console.error("tgSend error:", data);
  return data;
}

function rootKeyboard() {
  return { keyboard: [["🎬 Movie Data", "📨 Post Manager"]], resize_keyboard: true, one_time_keyboard: false };
}

// The admin's current top-level module ("root" | "data" | "post") lives in
// the same Durable Object post.js uses for its own drafts/session/menu state
// (PostStateDO) — one more small, TTL'd key under a "route:" prefix. No KV,
// no separate binding needed just for this.
function postState(env) {
  return env.POST_STATE.get(env.POST_STATE.idFromName("global"));
}
async function getRoute(env, uid) {
  const val = await postState(env).get(`route:${uid}`);
  return val || "root";
}
async function setRoute(env, uid, route) {
  await postState(env).put(`route:${uid}`, route, 2592000);
}

async function sendRootMenu(env, uid) {
  await setRoute(env, uid, "root");
  await tgSend(
    env, uid,
    `<b>🏠 Movie Manager — Main Menu</b>\n\nChoose a module:\n\n` +
      `<code>🎬 Movie Data</code> — Add / Edit / Delete / List movies (powers your /get-movie API).\n` +
      `<code>📨 Post Manager</code> — Compose and publish posts to Blogger / Telegram, manage the auto-post cache, and Live Edit.`,
    rootKeyboard()
  );
}

async function enterDataModule(env, uid) {
  await setRoute(env, uid, "data");
  await clearDataSession(env, uid);
  await sendMoviesMenu(env, uid);
}

async function enterPostModule(env, uid) {
  await setRoute(env, uid, "post");
  // Reuse post.js's own /start handling so its menu + session reset exactly
  // the way it always has — no duplicated logic to keep in sync.
  await handlePostUpdate(
    { message: { from: { id: Number(uid) }, chat: { id: Number(uid) }, text: "/start" } },
    env
  );
}

async function handleMessage(update, env) {
  const msg = update.message;
  if (!msg || !msg.from) return;
  const uid = String(msg.from.id);
  if (!isAdmin(env, uid)) return;
  const text = (msg.text || "").trim();

  // Global commands: recognized no matter which module the admin is
  // currently in (guards against a stale reply-keyboard button tap after
  // Telegram hasn't redrawn the keyboard yet, or a manually typed label).
  if (text === "/start" || text === "🏠 Main Menu") return sendRootMenu(env, uid);
  if (text === "🎬 Movie Data") return enterDataModule(env, uid);
  if (text === "📨 Post Manager") return enterPostModule(env, uid);

  const route = await getRoute(env, uid);

  if (route === "data") {
    const result = await handleDataUpdate(update, env);
    if (result === "GO_ROOT") return sendRootMenu(env, uid);
    return;
  }

  if (route === "post") {
    return handlePostUpdate(update, env);
  }

  // route === "root" and text matched none of the known buttons/commands.
  return sendRootMenu(env, uid);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    // Public JSON API used by your Blogger templates — unchanged from the
    // standalone movie-data worker.
    if (url.pathname === "/get-movie") return handleGetMovie(request, env, ctx);

    // Single Telegram webhook for the single bot.
    if (request.method === "POST" && url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
      let update;
      try { update = await request.json(); }
      catch { return new Response("Bad Request", { status: 400 }); }

      ctx.waitUntil((async () => {
        try {
          if (update.callback_query) await handlePostCallback(update.callback_query, env);
          else if (update.message) await handleMessage(update, env);
        } catch (e) {
          console.error("Webhook handling error:", e);
        }
      })());

      return new Response("OK");
    }

    return new Response("Movie Manager Worker is running.");
  },

  // No `scheduled` handler and no Cron Triggers at all — the two jobs that
  // used to run on a cron (warming the movie cache, sweeping expired
  // session/draft state) now run on their own Durable Object alarms:
  // see MovieStoreDO.alarm() and PostStateDO.alarm().
};
