export { MovieStoreDO } from "./movie-store-do.js";
export { AdminSessionDO } from "./admin-session-do.js";

async function tg(env, method, params) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) console.error(`tg ${method} error:`, data);
  return data;
}
function isAdmin(env, id) {
  const list = (env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(String(id));
}
function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
}
function errRes(status, code, headers) {
  return new Response(JSON.stringify({ error: code }), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

function balancedChunk(arr, maxSize = 3) {
  const rows = [];
  let i = 0;
  const n = arr.length;
  while (i < n) {
    const remaining = n - i;
    let size = Math.min(maxSize, remaining);
    if (remaining - size === 1 && size === maxSize) size = maxSize - 1;
    rows.push(arr.slice(i, i + size));
    i += size;
  }
  return rows;
}
const MENU_DEFS = {
  main: { title: "🏠 <b>Admin Menu</b>\nChoose an option:", buttons: ["🎬 Movies", "❓ Help"], back: false },
  movies: { title: "🎬 <b>Movies Menu</b>\nChoose an action:", buttons: ["➕ Add", "✏️ Edit", "🗑 Delete", "📋 List"], back: true },
};
function buildMenuKeyboard(menuKey) {
  const def = MENU_DEFS[menuKey];
  const all = def.back ? [...def.buttons, "⬅️ Back"] : def.buttons;
  const keyboard = balancedChunk(all, 3).map((row) => row.map((t) => ({ text: t })));
  return { keyboard, resize_keyboard: true, one_time_keyboard: false };
}
function backOnlyKeyboard() {
  return { keyboard: [[{ text: "⬅️ Back" }]], resize_keyboard: true, one_time_keyboard: false };
}
function confirmDeleteKeyboard() {
  return { keyboard: [[{ text: "✅ Confirm Delete" }, { text: "❌ Cancel" }]], resize_keyboard: true, one_time_keyboard: false };
}
async function sendMenu(env, chatId, menuKey) {
  const def = MENU_DEFS[menuKey];
  await tg(env, "sendMessage", { chat_id: chatId, text: def.title, parse_mode: "HTML", reply_markup: buildMenuKeyboard(menuKey) });
}

function movieCacheKey(id) {
  return new Request(`https://cache.internal/get-movie?id=${encodeURIComponent(id)}`);
}
async function cacheMovie(id, data) {
  const res = new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" } });
  await caches.default.put(movieCacheKey(id), res);
}
async function uncacheMovie(id) {
  await caches.default.delete(movieCacheKey(id));
}

async function handleHelp(message, env) {
  const text = '<b>Admin Bot Help</b>\n\n🎬 <b>Movies</b> → Add / Edit / Delete / List\n\nAdd expects a JSON object (or a JSON <b>array</b> of objects for bulk add) — each must have a string "id" field, which is the lookup key used by <code>/get-movie?id=...</code>. Edit expects a single JSON object and replaces the whole entry, so send the full JSON again with your changes included.';
  await tg(env, "sendMessage", { chat_id: message.chat.id, text, parse_mode: "HTML" });
}

async function handleList(message, env) {
  const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
  const page = await stub.list(null);
  if (!page.ids.length) {
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: "📭 No movies stored yet." });
    return;
  }
  const lines = [`📋 <b>Movies</b> (${page.ids.length}${page.cursor ? "+" : ""}):`, ""];
  page.ids.forEach((id, i) => lines.push(`${i + 1}. <code>${escHtml(id)}</code>`));
  if (page.cursor) lines.push("", "<i>More exist — use Edit/Delete with the specific ID you need.</i>");
  await tg(env, "sendMessage", { chat_id: message.chat.id, text: lines.join("\n"), parse_mode: "HTML" });
}

async function handleAddJson(message, env, sessionStub) {
  const text = (message.text || "").trim();
  const userId = String(message.from.id);
  if (text === "⬅️ Back") {
    await sessionStub.clear(userId);
    await sendMenu(env, message.chat.id, "movies");
    return;
  }
  let data;
  try { data = JSON.parse(text); }
  catch (e) {
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: `⚠️ Invalid JSON: ${escHtml(e.message)}\nTry again, or press Back.` });
    return;
  }

  // Accept either a single movie object, or an array of movie objects for bulk add.
  const items = Array.isArray(data) ? data : [data];
  if (!items.length) {
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: "⚠️ Empty JSON array. Try again, or press Back." });
    return;
  }

  const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
  const added = [];
  const failed = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object" || !item.id || typeof item.id !== "string") {
      failed.push(`#${i + 1}`);
      continue;
    }
    await stub.put(item.id, item);
    await cacheMovie(item.id, item);
    added.push(item.id);
  }

  await sessionStub.clear(userId);

  const lines = [];
  if (added.length) {
    lines.push(`✅ Added ${added.length} movie(s):`);
    added.forEach((id) => lines.push(`• <code>${escHtml(id)}</code>`));
  }
  if (failed.length) {
    lines.push(`⚠️ Skipped ${failed.length} item(s) missing a valid string "id": ${failed.join(", ")}`);
  }
  if (!lines.length) lines.push("⚠️ Nothing was added.");

  await tg(env, "sendMessage", { chat_id: message.chat.id, text: lines.join("\n"), parse_mode: "HTML" });
  await sendMenu(env, message.chat.id, "movies");
}

async function handleEditId(message, env, sessionStub) {
  const text = (message.text || "").trim();
  const userId = String(message.from.id);
  if (text === "⬅️ Back") {
    await sessionStub.clear(userId);
    await sendMenu(env, message.chat.id, "movies");
    return;
  }
  const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
  const data = await stub.get(text);
  if (!data) {
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: `⚠️ No movie found with ID <code>${escHtml(text)}</code>. Try again, or press Back.`, parse_mode: "HTML" });
    return;
  }
  await sessionStub.set(userId, { step: "awaiting_edit_json", id: text });
  await tg(env, "sendMessage", {
    chat_id: message.chat.id,
    text: `<b>Current data:</b>\n<pre>${escHtml(JSON.stringify(data, null, 2))}</pre>\n\nSend the new JSON to replace it, or press Back.`,
    parse_mode: "HTML", reply_markup: backOnlyKeyboard(),
  });
}

async function handleEditJson(message, env, sessionStub, id) {
  const text = (message.text || "").trim();
  const userId = String(message.from.id);
  if (text === "⬅️ Back") {
    await sessionStub.clear(userId);
    await sendMenu(env, message.chat.id, "movies");
    return;
  }
  let data;
  try { data = JSON.parse(text); }
  catch (e) {
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: `⚠️ Invalid JSON: ${escHtml(e.message)}\nTry again, or press Back.` });
    return;
  }
  data.id = id;
  const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
  await stub.put(id, data);
  await cacheMovie(id, data);
  await sessionStub.clear(userId);
  await tg(env, "sendMessage", { chat_id: message.chat.id, text: `✅ Updated <code>${escHtml(id)}</code>.`, parse_mode: "HTML" });
  await sendMenu(env, message.chat.id, "movies");
}

async function handleDeleteId(message, env, sessionStub) {
  const text = (message.text || "").trim();
  const userId = String(message.from.id);
  if (text === "⬅️ Back") {
    await sessionStub.clear(userId);
    await sendMenu(env, message.chat.id, "movies");
    return;
  }
  const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
  const data = await stub.get(text);
  if (!data) {
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: `⚠️ No movie found with ID <code>${escHtml(text)}</code>. Try again, or press Back.`, parse_mode: "HTML" });
    return;
  }
  await sessionStub.set(userId, { step: "awaiting_delete_confirm", id: text });
  await tg(env, "sendMessage", { chat_id: message.chat.id, text: `Delete <code>${escHtml(text)}</code>?`, parse_mode: "HTML", reply_markup: confirmDeleteKeyboard() });
}

async function handleDeleteConfirm(message, env, sessionStub, id) {
  const text = (message.text || "").trim();
  const userId = String(message.from.id);
  await sessionStub.clear(userId);
  if (text !== "✅ Confirm Delete") {
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: "✖️ Cancelled." });
    await sendMenu(env, message.chat.id, "movies");
    return;
  }
  const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
  await stub.delete(id);
  await uncacheMovie(id);
  await tg(env, "sendMessage", { chat_id: message.chat.id, text: `🗑 Deleted <code>${escHtml(id)}</code>.`, parse_mode: "HTML" });
  await sendMenu(env, message.chat.id, "movies");
}

async function handleMessage(message, env) {
  if (message.chat.type !== "private") return;
  const userId = message.from.id;
  if (!isAdmin(env, userId)) return;
  const text = (message.text || "").trim();

  const sessionStub = env.ADMIN_SESSION.get(env.ADMIN_SESSION.idFromName("global"));
  const pending = await sessionStub.get(String(userId));

  if (pending && pending.step === "awaiting_add_json") return handleAddJson(message, env, sessionStub);
  if (pending && pending.step === "awaiting_edit_id") return handleEditId(message, env, sessionStub);
  if (pending && pending.step === "awaiting_edit_json") return handleEditJson(message, env, sessionStub, pending.id);
  if (pending && pending.step === "awaiting_delete_id") return handleDeleteId(message, env, sessionStub);
  if (pending && pending.step === "awaiting_delete_confirm") return handleDeleteConfirm(message, env, sessionStub, pending.id);

  if (text === "/start") return sendMenu(env, message.chat.id, "main");
  if (text === "🎬 Movies") return sendMenu(env, message.chat.id, "movies");
  if (text === "❓ Help") return handleHelp(message, env);
  if (text === "⬅️ Back") return sendMenu(env, message.chat.id, "main");
  if (text === "📋 List") return handleList(message, env);

  if (text === "➕ Add") {
    await sessionStub.set(String(userId), { step: "awaiting_add_json" });
    const example = '{\n  "id": "movie123",\n  "title": "Movie Title",\n  "quality": "1080p",\n  "link": "https://..."\n}\n\nOR for multiple movies at once:\n[\n  { "id": "movie1", "title": "..." },\n  { "id": "movie2", "title": "..." }\n]';
    await tg(env, "sendMessage", {
      chat_id: message.chat.id,
      text: `<b>Add Movie</b>\nSend one movie JSON, or a JSON array to add several at once (each item must include "id"):\n\n<pre>${escHtml(example)}</pre>`,
      parse_mode: "HTML", reply_markup: backOnlyKeyboard(),
    });
    return;
  }

  if (text === "✏️ Edit") {
    await sessionStub.set(String(userId), { step: "awaiting_edit_id" });
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: "Send the movie ID to edit.", reply_markup: backOnlyKeyboard() });
    return;
  }

  if (text === "🗑 Delete") {
    await sessionStub.set(String(userId), { step: "awaiting_delete_id" });
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: "Send the movie ID to delete.", reply_markup: backOnlyKeyboard() });
    return;
  }
}


export async function movieDataHasSession(env, uid) {
  const stub = env.ADMIN_SESSION.get(env.ADMIN_SESSION.idFromName("global"));
  const pending = await stub.get(String(uid));
  return !!pending;
}

export async function clearMovieDataSession(env, uid) {
  const stub = env.ADMIN_SESSION.get(env.ADMIN_SESSION.idFromName("global"));
  await stub.clear(String(uid));
}

export async function openMovieData(env, chatId) {
  await sendMenu(env, chatId, "movies");
}
export async function handleUpdate(update, env) {
  if (update.message) await handleMessage(update.message, env);
}

async function warmCache(env) {
  const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
  let cursor = null;
  for (;;) {
    const page = await stub.list(cursor);
    for (const id of page.ids) {
      const data = await stub.get(id);
      if (data) await cacheMovie(id, data);
    }
    cursor = page.cursor;
    if (!cursor) break;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = corsHeaders();
    if (request.method === "OPTIONS") return new Response(null, { headers });

    if (url.pathname === "/get-movie") {
      if (request.method !== "GET") return errRes(405, "METHOD_NOT_ALLOWED", headers);
      const id = url.searchParams.get("id");
      if (!id) return errRes(400, "NO_ID_PROVIDED", headers);
      const cache = caches.default;
      const cacheKey = movieCacheKey(id);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      try {
        const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
        const data = await stub.get(id);
        if (!data) return errRes(404, "MOVIE_NOT_FOUND", headers);
        const res = new Response(JSON.stringify(data), { headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "public, max-age=600" } });
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      } catch (e) {
        return errRes(500, "INTERNAL_ERROR", headers);
      }
    }

    if (request.method === "POST" && url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
      try {
        const update = await request.json();
        ctx.waitUntil(handleUpdate(update, env));
      } catch (e) {
        console.error("webhook parse error", e);
      }
      return new Response("OK");
    }

    return errRes(404, "NOT_FOUND", headers);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(warmCache(env));
  },
};