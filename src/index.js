import { DurableObject } from "cloudflare:workers";
import {
  handleShareUpdate,
  handleShareScheduled,
  openShareMenu,
  shareHasSession,
  clearShareSession,
} from "./share-movie.js";
import {
  handleUpdate as handleMovieDataUpdate,
  openMovieData,
  movieDataHasSession,
  clearMovieDataSession,
} from "./movie-data.js";

export { ScheduleDO, CacheQueueDO } from "./share-movie.js";
export { MovieStoreDO } from "./movie-store-do.js";
export { AdminSessionDO } from "./admin-session-do.js";
export { PostStateDO } from "./post-state-do.js";

function adminIds(env) {
  return (env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function isAdmin(env, uid) {
  return adminIds(env).includes(String(uid));
}

async function tg(env, method, payload) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) throw new Error("Telegram bot token is not configured");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}

function unifiedKeyboard() {
  return {
    keyboard: [["Movie Data", "Share Movie"]],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

async function sendUnifiedMenu(env, chatId) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "<b>🎬 Movie Manager</b>\n\nChoose what you want to manage:",
    parse_mode: "HTML",
    reply_markup: unifiedKeyboard(),
  });
}

async function routeMessage(update, env) {
  const msg = update.message;
  if (!msg || !msg.from) return false;
  const uid = String(msg.from.id);
  if (!isAdmin(env, uid)) return true;
  const text = String(msg.text || "").trim();

  // Global navigation always wins. This prevents the two modules from
  // competing for the same message when the user switches modes.
  if (text === "/start") {
    await clearMovieDataSession(env, uid);
    await clearShareSession(env, uid);
    await sendUnifiedMenu(env, msg.chat.id);
    return true;
  }
  if (text === "Movie Data") {
    await clearShareSession(env, uid);
    await openMovieData(env, msg.chat.id);
    return true;
  }
  if (text === "Share Movie") {
    await clearMovieDataSession(env, uid);
    await openShareMenu(env, uid);
    return true;
  }

  // If Movie Data is in an active input step, keep the message inside that
  // module. Otherwise, if Share Movie has an active input step, keep it there.
  if (await movieDataHasSession(env, uid)) {
    await handleMovieDataUpdate(update, env);
    return true;
  }
  if (await shareHasSession(env, uid)) {
    await handleShareUpdate(update, env);
    return true;
  }

  // Movie Data submenu labels. The module owns the complete existing flow.
  const movieLabels = new Set([
    "🎬 Movies", "➕ Add", "✏️ Edit", "🗑 Delete", "📋 List",
    "❓ Help", "Confirm Delete", "Cancel",
  ]);
  if (text === "⬅️ Back") {
    await clearMovieDataSession(env, uid);
    await sendUnifiedMenu(env, msg.chat.id);
    return true;
  }
  if (movieLabels.has(text) || text === "⬅️ Main Menu") {
    if (text === "⬅️ Main Menu") {
      await clearMovieDataSession(env, uid);
      await sendUnifiedMenu(env, msg.chat.id);
    } else {
      await handleMovieDataUpdate(update, env);
    }
    return true;
  }

  // Share Movie's existing top-level/menu/input/callback handling remains
  // untouched and isolated in share-movie.js.
  await handleShareUpdate(update, env);
  return true;
}

async function handleMovieDataHttp(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
    try {
      const update = await request.json();
      ctx.waitUntil(handleMovieDataUpdate(update, env));
    } catch (e) {
      console.error("movie-data webhook parse error", e);
    }
    return new Response("OK");
  }
  if (request.method === "GET" && url.pathname === "/get-movie") {
    const id = url.searchParams.get("id");
    if (!id) return new Response(JSON.stringify({ error: "NO_ID_PROVIDED" }), { status: 400, headers: { "Content-Type": "application/json" } });
    try {
      const cacheKey = new Request(`https://cache.internal/get-movie?id=${encodeURIComponent(id)}`);
      const cached = await caches.default.match(cacheKey);
      if (cached) return cached;

      const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
      const data = await stub.get(id);
      if (!data) return new Response(JSON.stringify({ error: "MOVIE_NOT_FOUND" }), { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

      const response = new Response(JSON.stringify(data), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=600",
        },
      });
      ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
      return response;
    } catch (e) {
      console.error("get-movie error:", e);
      return new Response(JSON.stringify({ error: "INTERNAL_ERROR" }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const httpResult = await handleMovieDataHttp(request, env, ctx);
    if (httpResult) return httpResult;
    if (request.method !== "POST") {
      return new Response("Unified Movie Manager Worker is running.");
    }
    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    try {
      if (update.message) {
        await routeMessage(update, env);
      } else {
        // Callback queries belong to Share Movie's existing automation UI.
        // Movie Data currently uses reply keyboards, so there is no callback
        // namespace collision.
        await handleShareUpdate(update, env);
      }
    } catch (e) {
      console.error("Unified worker update error:", e);
    }
    return new Response("OK");
  },

  async scheduled(event, env, ctx) {
    // Share Movie keeps its existing scheduled automation. Movie Data no
    // longer scans the entire Durable Object just to warm the edge cache;
    // cache entries are populated on write and on cache-miss reads.
    await handleShareScheduled(event, env, ctx);
  },
};
