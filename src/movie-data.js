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

  const items = Array.isArray(data) ? data : [data];
  if (!items.length) {
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: "⚠️ Empty JSON array. Try again, or press Back." });
    return;
  }

  const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
  const added = [];
  const failed = [];

  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== "object" || !item.id || typeof item.id !== "string") {
        failed.push(`#${i + 1}`);
        continue;
      }
      try {
        await stub.put(item.id, item);
        await cacheMovie(item.id, item);
        added.push(item.id);
      } catch (e) {
        console.error("handleAddJson item failed:", item.id, e);
        failed.push(`#${i + 1}`);
      }
    }
  } finally {
    await sessionStub.clear(userId);
  }

  const lines = [];
  if (added.length) {
    lines.push(`✅ Added ${added.length} movie(s):`);
    added.forEach((id) => lines.push(`• <code>${escHtml(id)}</code>`));
  }
  if (failed.length) {
    lines.push(`⚠️ Skipped ${failed.length} item(s) missing a valid string "id" or failed to save: ${failed.join(", ")}`);
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
  try {
    const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
    await stub.put(id, data);
    await cacheMovie(id, data);
  } finally {
    await sessionStub.clear(userId);
  }
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
  try {
    if (text !== "✅ Confirm Delete") return;
    const stub = env.MOVIE_STORE.get(env.MOVIE_STORE.idFromName("global"));
    await stub.delete(id);
    await uncacheMovie(id);
  } finally {
    await sessionStub.clear(userId);
  }
  if (text !== "✅ Confirm Delete") {
    await tg(env, "sendMessage", { chat_id: message.chat.id, text: "✖️ Cancelled." });
    await sendMenu(env, message.chat.id, "movies");
    return;
  }
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
    const example = '{\n  "id": "arjunsonofvyjayanthi2025",\n  "title": "Arjun S/O Vyjayanthi (2025) Hindi Dual Audio WEBRip 1080p & 720p | Full Movie on Mov4KHub",\n  "meta": {\n    "imdb": "7.8/10",\n    "lang": "Hindi",\n    "genre": "Action",\n    "year": "2025",\n    "audio": "Hindi + Telugu",\n    "quality": "WEBRip 1080p"\n  },\n  "stream": "https://mov8khub.blogspot.com/2026/08/arjunsonofvyjayanthi2025.html",\n  "tele": [\n    {\n      "label": "HEVC AMZN WEBRip 1080p",\n      "url": "https://t.me/TG_Downlad_bot?start=arjunsopvZ"\n    },\n    {\n      "label": "HEVC AMZN WEBRip 720p",\n      "url": "https://t.me/TG_Downlad_bot?start=6a778aeaHM"\n    }\n  ],\n  "terabox": [\n    {\n      "label": "HEVC AMZN WEBRip 1080p",\n      "url": "https://1024terabox.com/s/1uStH7Q4H_eHy3_4PJkUhsA"\n    },\n    {\n      "label": "HEVC AMZN WEBRip 720p",\n      "url": "https://1024terabox.com/s/12ZlkKr86VmMVzZagxp2x3Q"\n    }\n  ],\n  "screenshots": [\n    "https://i.ibb.co.com/5xjydyXw/vlcsnap-2026-07-07-07h16m31s124-th.jpg",\n    "https://i.ibb.co.com/YHNhyxS/vlcsnap-2026-07-07-079h20m42s206-th.jpg",\n    "https://i.ibb.co.com/ZpRDknyh/vlcsnap-2026-0-7-07-07h22m10s794-th.jpg",\n    "https://i.ibb.co.com/fGxt0yVY/vlcsnap-2026-07-07-07h23m18s075-th.jpg",\n    "https://i.ibb.co.com/BV9f3Pn6/vlcsnap-2026-07-07-07h259m45s912-th.jpg",\n    "https://i.ibb.co.com/xSMFjQ0V/vlcsnap-2026-07-07-07h249m32s993-th.jpg"\n  ]\n}\n\nOR for multiple movies at once (send an array; every item uses the same full movie-data structure):\n[\n  {\n    "id": "arjunsonofvyjayanthi2025",\n    "title": "Arjun S/O Vyjayanthi (2025) Hindi Dual Audio WEBRip 1080p & 720p | Full Movie on Mov4KHub",\n    "meta": { "imdb": "7.8/10", "lang": "Hindi", "genre": "Action", "year": "2025", "audio": "Hindi + Telugu", "quality": "WEBRip 1080p" },\n    "stream": "https://mov8khub.blogspot.com/2026/08/arjunsonofvyjayanthi2025.html",\n    "tele": [\n      { "label": "HEVC AMZN WEBRip 1080p", "url": "https://t.me/TG_Downlad_bot?start=arjunsopvZ" },\n      { "label": "HEVC AMZN WEBRip 720p", "url": "https://t.me/TG_Downlad_bot?start=6a778aeaHM" }\n    ],\n    "terabox": [\n      { "label": "HEVC AMZN WEBRip 1080p", "url": "https://1024terabox.com/s/1uStH7Q4H_eHy3_4PJkUhsA" },\n      { "label": "HEVC AMZN WEBRip 720p", "url": "https://1024terabox.com/s/12ZlkKr86VmMVzZagxp2x3Q" }\n    ],\n    "screenshots": [\n      "https://i.ibb.co.com/5xjydyXw/vlcsnap-2026-07-07-07h16m31s124-th.jpg",\n      "https://i.ibb.co.com/YHNhyxS/vlcsnap-2026-07-07-079h20m42s206-th.jpg"\n    ]\n  },\n  {\n    "id": "anothermovie2025",\n    "title": "Another Movie (2025)",\n    "meta": { "imdb": "8.0/10", "lang": "Hindi", "genre": "Action", "year": "2025", "audio": "Hindi + Telugu", "quality": "WEBRip 1080p" },\n    "stream": "https://mov8khub.blogspot.com/2026/08/anothermovie2025.html",\n    "tele": [\n      { "label": "HEVC AMZN WEBRip 1080p", "url": "https://t.me/TG_Downlad_bot?start=example1080" },\n      { "label": "HEVC AMZN WEBRip 720p", "url": "https://t.me/TG_Downlad_bot?start=example720" }\n    ],\n    "terabox": [\n      { "label": "HEVC AMZN WEBRip 1080p", "url": "https://1024terabox.com/s/example1080" },\n      { "label": "HEVC AMZN WEBRip 720p", "url": "https://1024terabox.com/s/example720" }\n    ],\n    "screenshots": []\n  }\n]';
    const marker = "\n\nOR for multiple movies at once (send an array; every item uses the same full movie-data structure):\n";
    const splitAt = example.indexOf(marker);
    const singleExample = splitAt >= 0 ? example.slice(0, splitAt) : example;
    const bulkExample = splitAt >= 0 ? example.slice(splitAt + marker.length) : "[]";

    const addMovieText =
      `<b>➕ Add Movie</b>\n` +
      `Send one movie JSON, or a JSON array to add several at once. Each item must include <code>id</code>.\n\n` +
      `<b>Single Movie JSON</b>\n` +
      `<pre>${escHtml(singleExample)}</pre>\n\n` +
      `<b>OR — Multiple Movies</b>\n` +
      `Send a JSON array. Every item uses the same full movie-data structure.\n\n` +
      `<pre>${escHtml(bulkExample)}</pre>`;

    await tg(env, "sendMessage", {
      chat_id: message.chat.id,
      text: addMovieText,
      parse_mode: "HTML",
      reply_markup: backOnlyKeyboard(),
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

export async function warmCache(env) {
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
