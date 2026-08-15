// ============================================================================
// data.js — "Movie Data" module (Add / Edit / Delete / List + public
// /get-movie JSON endpoint). Everything here is namespaced to its own
// Durable Objects (MOVIE_STORE, ADMIN_SESSION) so it can never collide with
// the "Post Movie" module in post.js. The combined src/index.js router is
// the only thing that decides *when* these functions get called.
// ============================================================================

export { MovieStoreDO } from "./movie-store-do.js";
export { AdminSessionDO } from "./admin-session-do.js";

async function tg(env, method, params) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
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

export function corsHeaders() {
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

// Exactly the 5 buttons requested: Add, Edit, Delete, List, Back.
// This IS the entry screen of the "Movie Data" module — there is no extra
// "Movies / Help" screen in front of it anymore.
function moviesMenuKeyboard() {
  const buttons = ["➕ Add", "✏️ Edit", "🗑 Delete", "📋 List", "⬅️ Back"];
  const keyboard = balancedChunk(buttons, 3).map((row) => row.map((t) => ({ text: t })));
  return { keyboard, resize_keyboard: true, one_time_keyboard: false };
}
function backOnlyKeyboard() {
  return { keyboard: [[{ text: "⬅️ Back" }]], resize_keyboard: true, one_time_keyboard: false };
}
function confirmDeleteKeyboard() {
  return { keyboard: [[{ text: "✅ Confirm Delete" }, { text: "❌ Cancel" }]], resize_keyboard: true, one_time_keyboard: false };
}

// Called by index.js whenever the admin enters this module from the root
// menu, and internally whenever we return to the top of it.
export async function sendMoviesMenu(env, chatId) {
  await tg(env, "sendMessage", { chat_id: chatId, text: "🎬 <b>Movie Data</b>\nChoose an action:", parse_mode: "HTML", reply_markup: moviesMenuKeyboard() });
}

// Called by index.js right before entering this module, so a stale
// in-progress Add/Edit/Delete step never leaks into a fresh session.
export async function clearDataSession(env, userId) {
  const sessionStub = env.ADMIN_SESSION.get(env.ADMIN_SESSION.idFromName("global"));
  await sessionStub.clear(String(userId));
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
  const text = '<b>Movie Data Help</b>\n\n🎬 <b>Movie Data</b> → Add / Edit / Delete / List\n\nAdd expects a JSON object (or a JSON <b>array</b> of objects for bulk add) — each must have a string "id" field, which is the lookup key used by <code>/get-movie?id=...</code>. Edit expects a single JSON object and replaces the whole entry, so send the full JSON again with your changes included.';
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
    await sendMoviesMenu(env, message.chat.id);
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
  await sendMoviesMenu(env, message.chat.id);
}

async function handleEditId(message, env, sessionStub) {
  const text = (message.text || "").trim();
  const userId = String(message.from.id);
  if (text === "⬅️ Back") {
    await sessionStub.clear(userId);
    await sendMoviesMenu(env, message.chat.id);
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
    await sendMoviesMenu(env, message.chat.id);
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
  await sendMoviesMenu(env, message.chat.id);
}

async function handleDeleteId(message, env, sessionStub) {
  const text = (message.text || "").trim();
  const userId = String(message.from.id);
  if (text === "⬅️ Back") {
    await sessionStub.clear(userId);
    await sendMoviesMenu(env, message.chat.id);
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
    await sendMoviesMenu(env, message.chat.id);
    return;
  }
  const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
  await stub.delete(id);
  await uncacheMovie(id);
  await tg(env, "sendMessage", { chat_id: message.chat.id, text: `🗑 Deleted <code>${escHtml(id)}</code>.`, parse_mode: "HTML" });
  await sendMoviesMenu(env, message.chat.id);
}

// Called by index.js for every `message` update while the admin is inside
// the "Movie Data" module (route === "data").
// Returns the string "GO_ROOT" when the admin pressed Back at the very top
// of this module (i.e. nothing was pending) — index.js reads that signal
// and switches them back to the combined root menu. Every other Back press
// (mid Add/Edit/Delete) is handled locally above and never bubbles up.
export async function handleDataUpdate(update, env) {
  const message = update.message;
  if (!message || !message.from) return;
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

  if (text.startsWith("/help")) return handleHelp(message, env);
  if (text === "📋 List") return handleList(message, env);
  if (text === "⬅️ Back") return "GO_ROOT";

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

  // Anything unrecognized while idle in this module: just re-show the menu.
  await sendMoviesMenu(env, message.chat.id);
}

// Public JSON endpoint used by your Blogger templates: GET /get-movie?id=...
// Called directly by index.js's fetch handler.
export async function handleGetMovie(request, env, ctx) {
  const url = new URL(request.url);
  const headers = corsHeaders();
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
