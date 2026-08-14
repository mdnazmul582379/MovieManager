import { DurableObject } from "cloudflare:workers";

function getChannels(env) {
  try {
    const raw = JSON.parse(env.TG_CHANNELS || "{}");
    const out = {};
    for (const [name, value] of Object.entries(raw || {})) {
      if (typeof value === "string") out[name] = value;
      else if (value && typeof value.id !== "undefined") out[name] = String(value.id);
    }
    return out;
  } catch {
    return {};
  }
}

const KNOWN_PREFIXES = ["drafts:", "session:", "schedule:", "fwd:", "menu:"];

const CACHE_CHANNELS = {
  "Check": { id: "-1004412508133", hour: 20, minute: 0, count: 1 },
  // Neutral cache pool. It is not a Telegram destination and never auto-posts.
  "Random": { id: null, manualOnly: true },
};

const E = {
  movie: "&#127908;",
  language: "&#128266;",
  quality: "&#128190;",
  release: "&#127941;",
  watch: "&#128421;",
  download: "&#128640;",
  check: "&#9989;",
  cross: "&#10060;",
  warning: "&#9888;",
  info: "&#8505;",
  trash: "&#128465;",
  edit: "&#9999;",
  cancel: "&#10060;",
  send: "&#128640;",
  upload: "&#128228;",
  view: "&#128065;",
  download_data: "&#128229;",
  delete: "&#128465;",
  clear: "&#129689;",
  back: "&#128281;",
  add: "&#10133;",
  preview: "&#128064;",
  schedule: "&#128197;",
  time: "&#128336;",
  link: "&#128279;",
  photo: "&#128247;",
  video: "&#127909;",
  doc: "&#128196;",
  csv: "&#128202;",
  folder: "&#128193;",
  settings: "&#9881;",
  done: "&#9989;",
  post: "&#128231;",
  cache: "&#128190;",
  live: "&#128309;",
  edit_live: "&#9999;",
  confirm: "&#9989;",
  denied: "&#10060;",
  wait: "&#9203;",
  success: "&#9989;",
  error: "&#10060;",
  star: "&#11088;",
  heart: "&#10084;",
  fire: "&#128293;",
  new: "&#128252;",
  update: "&#128260;",
  save: "&#128190;",
  load: "&#128187;",
  refresh: "&#128260;",
  close: "&#10060;",
  menu: "&#128203;",
  help: "&#10067;",
  question: "&#10067;",
  exclamation: "&#10071;",
  bulb: "&#128161;",
  gear: "&#9881;",
  pencil: "&#9999;",
  paperclip: "&#128206;",
  lock: "&#128274;",
  unlock: "&#128275;",
  key: "&#128273;",
  calendar: "&#128197;",
  clock: "&#128336;",
  hourglass: "&#9203;",
  alarm: "&#128277;",
  bell: "&#128276;",
  volume: "&#128266;",
  mic: "&#127908;",
  headphones: "&#127911;",
  music: "&#127925;",
  film: "&#127902;",
  camera: "&#128247;",
  video_camera: "&#128249;",
  tv: "&#128250;",
  sparkles: "&#10024;",
  star2: "&#127775;",
  moon: "&#127769;",
  sun: "&#9728;",
  cloud: "&#9729;",
  rain: "&#127783;",
  snow: "&#10052;",
  thunder: "&#9889;",
  rainbow: "&#127752;",
  flower: "&#127800;",
  rose: "&#127801;",
  leaf: "&#127811;",
  coffee: "&#9749;",
  tea: "&#127861;",
  cake: "&#127874;",
  pizza: "&#127829;",
  burger: "&#127828;",
  fries: "&#127839;",
  apple: "&#127822;",
  beer: "&#127866;",
  wine: "&#127863;",
  popcorn: "&#127871;",
  sushi: "&#127843;",
  ramen: "&#127836;",
  curry: "&#127835;",
  noodles: "&#127836;",
};

function getEmoji(key) {
  return E[key] || "&#10067;";
}

function removeKeyboard() {
  return { remove_keyboard: true };
}

function doneCancelKeyboard(prefix) {
  return {
    inline_keyboard: [[
      { text: `${getEmoji('cancel')} Cancel`, callback_data: `${prefix}::cancel` },
      { text: `${getEmoji('done')} Done`, callback_data: `${prefix}::done` },
    ]],
  };
}

function decodeHtmlEntities(value) {
  return String(value ?? "").replace(
    /&#(x[0-9a-f]+|[0-9]+);/gi,
    (_, code) => {
      const cp = code.toLowerCase().startsWith("x")
        ? parseInt(code.slice(1), 16)
        : parseInt(code, 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : _;
    }
  );
}

function decodeKeyboardEmoji(markup) {
  if (!markup || typeof markup !== "object") return markup;
  const result = { ...markup };
  if (Array.isArray(result.inline_keyboard)) {
    result.inline_keyboard = result.inline_keyboard.map(row =>
      Array.isArray(row)
        ? row.map(button => {
            if (!button || typeof button !== "object") return button;
            const copy = { ...button };
            if (typeof copy.text === "string") {
              copy.text = decodeHtmlEntities(copy.text);
            }
            return copy;
          })
        : row
    );
  }
  return result;
}

const FIELD_PROMPTS = {
  tg_title: `${getEmoji('movie')} Send the new <b>TG Title</b>:\n<i>e.g. Spider-Man: No Way Home (2021)</i>`,
  bg_title: `${getEmoji('pencil')} Send the new <b>BG Title</b> (long, SEO-friendly Blogger title):\n<i>e.g. Spider-Man: No Way Home (2021) 1080p BluRay [Hindi-Eng] | Full Movie</i>`,
  language: `${getEmoji('language')} Send the new <b>Language</b>:\n<i>e.g. English / Hindi Dubbed</i>`,
  quality: `${getEmoji('quality')} Send the new <b>Quality</b>:\n<i>e.g. 1080p BluRay / 4K HDR</i>`,
  duration: `${getEmoji('time')} Send the new <b>Duration</b>:\n<i>e.g. 2h 28m</i>`,
  release_year: `${getEmoji('release')} Send the new <b>Release Year</b>:\n<i>e.g. 2021</i>`,
  bg_thumbnail: `${getEmoji('photo')} Send the new <b>BG Thumbnail</b> URL (hidden image used inside the Blogger post).\nSend <code>none</code> to remove it.`,
  tg_thumbnail: `${getEmoji('camera')} Send the new <b>TG Thumbnail</b>.\nAttach a photo, or send a direct image URL.\nSend <code>none</code> to remove it.`,
  video_url: `${getEmoji('video')} Send the new <b>Video URL</b> (hidden in the Blogger post, read by your template).\nSend <code>none</code> to clear it.`,
  permalink: `${getEmoji('link')} Send the new <b>Permalink</b> slug, or send <code>N/A</code> to auto-generate it from TG Title + Release Year.`,
  labels: `${getEmoji('folder')} Send comma separated <b>Labels</b> (Blogger categories):\n<i>e.g. Adult,Drama,Erotic,ESubs,K-Movie,Korean,Romance</i>`,
  synopsis: `${getEmoji('doc')} Send the new <b>Synopsis</b> (used on the second Blogger site's synopsis section):\n<i>e.g. A short plot summary...</i>`,
  movie_id: `${getEmoji('key')} Send the new <b>Movie ID</b> (used for the gallery + download page on the second Blogger site).\nSend <code>N/A</code> to fall back to the Permalink.`,
  links: `${getEmoji('link')} Send updated buttons as a JSON <b>array</b>:\n\n<code>[{"text":"How To Download","url":"https://t.me/backup2k24/72"}]</code>\n\nThe "Download" button pointing at the Blogger post is added automatically when publishing to both - don't include it here.\nTo <b>remove all extra buttons</b> send <code>[]</code>.`,
};

const EDIT_FIELDS = [
  ["TG Title", "tg_title"],
  ["BG Title", "bg_title"],
  ["Language", "language"],
  ["Quality", "quality"],
  ["Duration", "duration"],
  ["Release Year", "release_year"],
  ["BG Thumbnail", "bg_thumbnail"],
  ["TG Thumbnail", "tg_thumbnail"],
  ["Video URL", "video_url"],
  ["Permalink", "permalink"],
  ["Labels", "labels"],
  ["Synopsis", "synopsis"],
  ["Movie ID", "movie_id"],
  ["Buttons", "links"],
];

const CACHE_EDIT_FIELDS = [
  ["TG Title", "tg_title"],
  ["Language", "language"],
  ["Quality", "quality"],
  ["Duration", "duration"],
  ["Release Year", "release_year"],
  ["TG Thumbnail", "tg_thumbnail"],
  ["Buttons", "links"],
];

export async function handleShareUpdate(update, env) {
  return handleUpdate(update, env);
}

export async function handleShareScheduled(event, env, ctx) {
  if (event.cron === "0 0 * * *") ctx.waitUntil(cleanupUnknownKeys(env));
}

export async function openShareMenu(env, uid) {
  await setMenu(env, uid, "main");
  await clearSession(env, uid);
  await sendMessage(env, uid, `<b>Share Movie</b> - Automation Panel`, mainKeyboard());
}

async function handleUpdate(update, env) {
  const adminIds = (env.ADMIN_IDS || "").split(",").map((s) => s.trim());
  if (update.callback_query) return handleCallback(update.callback_query, env, adminIds);
  const msg = update.message;
  if (!msg || !msg.from) return;
  const uid = String(msg.from.id);
  if (!adminIds.includes(uid)) return;
  const text = msg.text || "";
  if (text === "/start") return cmdStart(env, uid);
  if (text.startsWith("/help")) return cmdHelp(env, uid);
  if (text.startsWith("/cancel")) return cmdCancel(env, uid);
  if (text === "Post Movie" || text === "🎬 Post Movie") return enterPostMovieMenu(env, uid);
  if (text === "Movie Cache" || text === "💾 Movie Cache") return enterMovieCacheMenu(env, uid);
  if (text === "Live Edit" || text === "✏️ Live Edit") return btnLiveEdit(env, uid);
  if (text === "Back" || text === "⬅️ Back") return handleBack(env, uid);
  const menu = await getMenu(env, uid);
  const session = await getSession(env, uid);
  if (menu === "post_movie") {
    if (text === "Add Post") return btnAddPost(env, uid);
    if (text === "Preview") return showPreviews(env, uid);
    if (text === "Send Post") return btnSendPosts(env, uid);
    if (text === "Clear All") return btnClearAll(env, uid);
  }
  if (menu === "movie_cache") {
    if (text === "Upload Data") return cacheBtnUpload(env, uid);
    if (text === "View Data") return cacheBtnView(env, uid);
    if (text === "Download Data") return cacheBtnDownloadMenu(env, uid);
    if (text === "Post From Data") return cacheBtnPostFrom(env, uid);
    if (text === "Edit Data") return cacheBtnEdit(env, uid);
    if (text === "Delete Data") return cacheBtnDelete(env, uid);
    if (text === "Clear All") return cacheBtnClearAllAsk(env, uid);
  }
  if (session.state === "awaiting_schedule_time") return receiveScheduleTime(msg, env, uid, session);
  if (session.state === "edit_field") return receiveEditedField(msg, env, uid, session);
  if (session.state === "cache_upload_wait_data" || session.state === "cache_upload_collecting") return cacheReceiveUploadData(msg, env, uid, session);
  if (session.state === "cache_post_wait_permalink") return cacheReceivePostPermalink(msg, env, uid, session);
  if (session.state === "cache_preview_edit_field") return cachePreviewReceiveEditedField(msg, env, uid, session);
  if (session.state === "cache_edit_wait_permalink") return cacheReceiveEditPermalink(msg, env, uid, session);
  if (session.state === "cache_edit_field") return cacheReceiveEditedField(msg, env, uid, session);
  if (session.state === "cache_delete_wait_permalink") return cacheReceiveDeletePermalink(msg, env, uid, session);
  if (session.state === "live_edit") {
    if (msg.forward_origin || msg.forward_from_chat) return receiveForwarded(msg, env, uid);
    const t = String(msg.caption || msg.text || "").trim();
    if (t.includes("channel_id")) return receiveLiveJson(t, msg, env, uid);
    const liveUrl = parseTelegramChannelMessageLink(t);
    if (liveUrl) return receiveLiveLink(liveUrl, env, uid);
    return;
  }
  if (session.state === "composing") return receivePost(msg, env, uid);
}

export async function shareHasSession(env, uid) {
  const s = await getSession(env, uid);
  return !!(s && s.state);
}

export async function clearShareSession(env, uid) {
  await clearSession(env, uid);
  await setMenu(env, uid, "main");
}

async function handleCallback(cq, env, adminIds) {
  const uid = String(cq.from.id);
  if (!adminIds.includes(uid)) return;
  const data = cq.data;
  if (data.startsWith("dest::")) return cbDestSelect(cq, env, uid, data.split("::")[1]);
  if (data.startsWith("ch::")) return cbChannelSelect(cq, env, uid, data.split("::")[1]);
  if (data.startsWith("dp_")) return cbDraftAction(cq, env, uid);
  if (data.startsWith("ef::")) {
    const [, field, postId] = data.split("::");
    return cbEditField(cq, env, uid, field, postId);
  }
  if (data.startsWith("lv_prep::")) return cbLivePrepare(cq, env, data.split("::")[1]);
  if (data.startsWith("lv_confirm::")) return cbLiveConfirm(cq, env, uid);
  if (data.startsWith("cud::")) return cbCacheUploadDone(cq, env, uid, data.split("::")[1]);
  if (data.startsWith("cud1::")) return cbCacheUploadConflict1(cq, env, uid, data);
  if (data.startsWith("cud2::")) return cbCacheUploadConflict2(cq, env, uid, data);
  if (data.startsWith("cu::")) return cbCacheUploadChannel(cq, env, uid, data.split("::")[1]);
  if (data.startsWith("cv::")) { const [, ch, page] = data.split("::"); return cbCacheView(cq, env, uid, decodeURIComponent(ch || ""), page || "0"); }
  if (data.startsWith("cd::")) return cbCacheDownload(cq, env, uid, decodeURIComponent(data.split("::")[1] || ""));
  if (data.startsWith("cp::")) return cbCachePostChannel(cq, env, uid, decodeURIComponent(data.split("::")[1] || ""));
  if (data.startsWith("cpt::")) return cbCacheRandomTarget(cq, env, uid, decodeURIComponent(data.split("::")[1] || ""));
  if (data.startsWith("ce::")) return cbCacheEditChannel(cq, env, uid, decodeURIComponent(data.split("::")[1] || ""));
  if (data.startsWith("cxdel::")) return cbCacheDeleteConfirm(cq, env, uid, data);
  if (data.startsWith("cx::")) return cbCacheDeleteChannel(cq, env, uid, decodeURIComponent(data.split("::")[1] || ""));
  if (data.startsWith("ccch::")) return cbCacheClearChannel(cq, env, uid, decodeURIComponent(data.split("::")[1] || ""));
  if (data.startsWith("cc1::")) return cbCacheClearConfirm1(cq, env, uid, data);
  if (data.startsWith("cc2::")) return cbCacheClearConfirm2(cq, env, uid, data);
  if (data.startsWith("cef::")) return cbCacheEditField(cq, env, uid, data);
  if (data.startsWith("cpf::")) return cbCachePreviewField(cq, env, uid, data);
  if (data.startsWith("cps::")) return cbCachePreviewSend(cq, env, uid, data);
}

async function cmdStart(env, uid) {
  await setMenu(env, uid, "main");
  await clearSession(env, uid);
  await sendMessage(env, uid, `<b>Channel Manager</b> - Admin Panel\n\nUse the keyboard below to manage your channel posts.\nSend /help for full command reference.`, mainKeyboard());
}

async function cmdHelp(env, uid) {
  const text =
    `<b>Command Reference</b>\n-------------------------\n\n<b>Main Menu</b>\n` +
    `  <code>Post Movie</code> - Compose, preview, and publish posts to Blogger/Telegram.\n` +
    `  <code>Movie Cache</code> - Manage the per-channel auto-post queues.\n` +
    `  <code>Live Edit</code>  - Edit an already-published Telegram post.\n\n` +
    `<b>Post Movie submenu</b>\n  Add Post, Preview, Send Post, Clear All, Back.\n\n` +
    `<b>Movie Cache submenu</b>\n  Upload Data, View Data, Download Data, Post From Data, Edit Data, Delete Data, Clear All, Back.\n\n` +
    `<b>Auto-post schedule (Bangladesh time)</b>\n` +
    `  Check - 8:00 PM, 1 post/day\n\n` +
    `<b>Post Movie - JSON format</b>\n<code>{\n  "TGTitle":         "Movie Name (2024)",\n  "BGTitle":         "Movie Name (2024) 1080p BluRay | Full Movie",\n  "Language":        "English / Hindi",\n  "Quality":         "1080p BluRay",\n  "Duration":        "2h 15m",\n  "Release_year":    "2024",\n  "BGThumbnail":     "https://.../poster.jpg",\n  "TGTitlehumbnail": "https://.../poster.jpg",\n  "Video_Url":       "https://.../video",\n  "Permalink":       "N/A",\n  "Labels":          "Adult,Drama,Erotic,ESubs,K-Movie,Korean,Romance",\n  "Synopsis":        "Short plot summary...",\n  "MovieId":         "movie_name_2024",\n  "links": [\n    { "text": "How To Download", "url": "https://t.me/backup2k24/72" }\n  ]\n}</code>\n\n` +
    `<b>Permalink</b> = <code>N/A</code> -> auto-built from TGTitle + Release_year.\n<b>Synopsis</b> / <b>MovieId</b> are used for the second Blogger site (gallery + download page); MovieId falls back to Permalink if omitted.\n<b>Long JSON / multiple posts:</b> upload a <b>.txt</b> or <b>.json</b> file instead of typing it (avoids Telegram's text length limit). A JSON <b>array</b> in the file/message adds multiple drafts at once.\n\n<b>Commands</b>\n  /start - Main menu.\n  /help  - This reference.\n  /cancel - Cancel current operation.\n`;
  const menu = await getMenu(env, uid);
  await sendMessage(env, uid, text, keyboardForMenu(menu));
}

async function cmdCancel(env, uid) {
  await clearSession(env, uid);
  const menu = await getMenu(env, uid);
  await sendMessage(env, uid, `Operation cancelled.`, keyboardForMenu(menu));
}

async function handleBack(env, uid) {
  await clearSession(env, uid);
  await setMenu(env, uid, "main");
  await sendMessage(env, uid, `Main menu.`, mainKeyboard());
}

async function enterPostMovieMenu(env, uid) {
  await setMenu(env, uid, "post_movie");
  await setSession(env, uid, { state: "composing" });
  await sendMessage(env, uid, `<b>Post Movie</b>\n\nAdd, preview, and publish posts to Blogger and/or Telegram.`, postMovieMenuKeyboard());
}

async function enterMovieCacheMenu(env, uid) {
  await setMenu(env, uid, "movie_cache");
  await clearSession(env, uid);
  await sendMessage(
    env, uid,
    `<b>Movie Cache</b>\n\nEach channel has its own daily auto-post queue (Bangladesh time):\n\n` +
      `<b>Check</b> - 8:00 PM, 1 post/day\n\n` +
      `Use the buttons below to upload, view, download, edit, delete, or post from the cache.`,
    movieCacheMenuKeyboard()
  );
}

async function btnAddPost(env, uid) {
  await setSession(env, uid, { state: "composing" });
  const text =
    `<b>Add a New Post</b>\n\nSend a JSON message with movie details.\nYou can also attach a photo and put the JSON as its caption (the photo becomes the TG Thumbnail).\n\n` +
    `<b>Need the file_id separately</b> (e.g. to put it inside a .txt/.json file)? Send the photo <b>alone, with no caption</b> - the bot will reply with its file_id. Copy that into <code>TGTitlehumbnail</code>.\n\n` +
    `<b>Long JSON / hitting Telegram's text limit?</b> Send it as a <b>.txt</b> or <b>.json</b> file instead - upload the file with the JSON as its content (no caption needed). You can also send a JSON <b>array</b> of items (single file or array = multiple drafts added at once).\n\n` +
    '<b>Example:</b>\n<code>{\n  "TGTitle":         "Inception (2010)",\n  "BGTitle":         "Inception (2010) 1080p BluRay | Full Movie",\n  "Language":        "English",\n  "Quality":         "1080p BluRay",\n  "Duration":        "2h 28m",\n  "Release_year":    "2010",\n  "BGThumbnail":     "https://.../poster.jpg",\n  "TGTitlehumbnail": "https://.../poster.jpg",\n  "Video_Url":       "https://.../video",\n  "Permalink":       "N/A",\n  "Labels":          "Adult,Drama,Erotic,ESubs,K-Movie,Korean,Romance",\n  "Synopsis":        "Short plot summary...",\n  "MovieId":         "inception_2010",\n  "links": [\n    { "text": "How To Download", "url": "https://t.me/backup2k24/72" }\n  ]\n}</code>';
  await sendMessage(env, uid, text, postMovieMenuKeyboard());
}

function buildDraftPostFromJson(d, photoFileId) {
  if (!d || !d["TGTitle"]) return null;
  const postId = crypto.randomUUID();
  const rawLinks = Array.isArray(d.links) ? d.links : [];
  const links = rawLinks.filter((l) => l && typeof l.text === "string" && typeof l.url === "string" && (l.url.startsWith("http://") || l.url.startsWith("https://")));
  const post = {
    post_id: postId, preview_msg_id: null,
    tg_title: d["TGTitle"] || "Untitled",
    bg_title: d["BGTitle"] || d["TGTitle"] || "Untitled",
    language: d["Language"] || "N/A",
    quality: d["Quality"] || "N/A",
    duration: d["Duration"] || "N/A",
    release_year: d["Release_year"] || "N/A",
    bg_thumbnail: d["BGThumbnail"] || "",
    tg_thumbnail: null,
    video_url: d["Video_Url"] || "",
    permalink: d["Permalink"] || "N/A",
    labels: d["Labels"] || "",
    synopsis: d["Synopsis"] || "",
    movie_id: d["MovieId"] || "",
    links,
  };
  if (photoFileId) post.tg_thumbnail = photoFileId;
  else if (d["TGTitlehumbnail"]) post.tg_thumbnail = d["TGTitlehumbnail"];
  return { post, skippedLinks: rawLinks.length - links.length };
}

async function receivePost(msg, env, uid) {
  if (msg.photo && !(msg.caption && msg.caption.includes("TGTitle"))) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await sendMessage(
      env, uid,
      `${getEmoji('photo')} <b>Photo File ID</b>\n<code>${fileId}</code>\n\nTap to copy, then paste it into your JSON's <b>TGTitlehumbnail</b> field and send the JSON as usual (text, or a .txt/.json file).`,
      postMovieMenuKeyboard()
    );
    return;
  }
  let raw = null;
  let photoFileId = null;
  if (msg.document) {
    try {
      raw = await getTelegramFileText(env, msg.document.file_id);
    } catch (exc) {
      await sendMessage(env, uid, `<b>File read error:</b>\n<code>${exc.message}</code>`, postMovieMenuKeyboard());
      return;
    }
  } else {
    raw = msg.photo ? msg.caption : msg.text;
    if (msg.photo) photoFileId = msg.photo[msg.photo.length - 1].file_id;
  }
  if (!raw || !raw.trim() || !raw.includes("TGTitle")) {
    await sendMessage(env, uid, `<b>Invalid input.</b>\n\nSend a properly formatted JSON (text, photo caption, or a .txt/.json file).\nPress <b>Add Post</b> again to see the example.`, postMovieMenuKeyboard());
    return;
  }
  let data;
  try { data = JSON.parse(raw); }
  catch (exc) {
    await sendMessage(env, uid, `<b>JSON Error</b>\n\n<code>${exc.message}</code>\n\nFix and resend.`, postMovieMenuKeyboard());
    return;
  }
  const rawItems = Array.isArray(data) ? data : [data];
  const drafts = await getDrafts(env, uid);
  let added = 0, invalid = 0, skippedLinksTotal = 0;
  for (const d of rawItems) {
    const built = buildDraftPostFromJson(d, rawItems.length === 1 ? photoFileId : null);
    if (!built) { invalid++; continue; }
    drafts[built.post.post_id] = built.post;
    added++;
    skippedLinksTotal += built.skippedLinks;
  }
  if (!added) {
    await sendMessage(env, uid, `No valid items found. Every item must contain <code>TGTitle</code>.`, postMovieMenuKeyboard());
    return;
  }
  await setDrafts(env, uid, drafts);
  const count = Object.keys(drafts).length;
  const lines = [added > 1 ? `<b>${added}</b> post(s) added from the file.` : `<b>Post added!</b>`];
  if (invalid > 0) lines.push(`${invalid} item(s) skipped - missing TGTitle.`);
  if (skippedLinksTotal > 0) lines.push(`${skippedLinksTotal} link(s) skipped - need a "text" and a valid http(s) "url".`);
  lines.push(`You now have <b>${count}</b> draft(s).`);
  await sendMessage(env, uid, lines.join("\n") + `\n\nSend another post, press <b>Preview</b>, or <b>Send Post</b>.`, postMovieMenuKeyboard());
}

async function showPreviews(env, uid) {
  const drafts = await getDrafts(env, uid);
  const posts = Object.values(drafts);
  if (!posts.length) {
    await sendMessage(env, uid, `No drafts yet.  Use <b>Add Post</b> first.`, postMovieMenuKeyboard());
    return;
  }
  for (const post of posts) {
    await safeDelete(env, uid, post.preview_msg_id);
    post.preview_msg_id = null;
  }
  for (const post of posts) {
    const markup = postActionKeyboard(post.post_id, post.links);
    const sent = await sendPostMessage(env, uid, post, markup, true);
    post.preview_msg_id = sent.message_id;
  }
  await setDrafts(env, uid, drafts);
}

async function btnClearAll(env, uid) {
  const drafts = await getDrafts(env, uid);
  for (const post of Object.values(drafts)) await safeDelete(env, uid, post.preview_msg_id);
  await deleteDrafts(env, uid);
  await setSession(env, uid, { state: "composing" });
  await sendMessage(env, uid, `All drafts cleared.`, postMovieMenuKeyboard());
}

async function btnSendPosts(env, uid) {
  const drafts = await getDrafts(env, uid);
  if (!Object.keys(drafts).length) {
    await sendMessage(env, uid, `No drafts to send.  Use <b>Add Post</b> first.`, postMovieMenuKeyboard());
    return;
  }
  await setSession(env, uid, { state: "select_destination" });
  await sendMessage(env, uid, `<b>Where do you want to publish?</b>`, destinationKeyboard());
}

async function cbDestSelect(cq, env, uid, dest) {
  await answerCallback(env, cq.id);
  if (dest === "cancel") {
    await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Sending cancelled.`);
    await sendMessage(env, uid, `Drafts are still available.`, postMovieMenuKeyboard());
    await setSession(env, uid, { state: "composing" });
    return;
  }
  await setSession(env, uid, { state: "select_channel", destination: dest });
  const label = dest === "blogger" ? "Blogger Only" : dest === "telegram" ? "Telegram Only" : "Blogger + Telegram";
  await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Destination: <b>${label}</b>`);
  await sendMessage(env, uid, `<b>Select a channel to publish this post:</b>`, sendOptionsKeyboard(env, dest, "select"));
}

async function cbChannelSelect(cq, env, uid, chName) {
  await answerCallback(env, cq.id);
  const session = await getSession(env, uid);
  const destination = session.destination || "both";
  if (chName === "cancel") {
    await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Sending cancelled.`);
    await sendMessage(env, uid, `Drafts are still available.`, postMovieMenuKeyboard());
    await setSession(env, uid, { state: "composing" });
    return;
  }
  if (chName === "set_time" || chName === "edit_time") {
    await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Waiting for schedule time...`);
    await setSession(env, uid, { state: "awaiting_schedule_time", destination });
    await sendMessage(
      env, uid,
      `<b>Send the schedule date & time</b> (Bangladesh time) in this format:\n<code>YYYY-MM-DD HH:MM</code>\n\n<i>Current time:</i> <code>${formatBDNow()}</code>\n\nTime must be in the future. Type <code>cancel</code> to abort.`,
      postMovieMenuKeyboard()
    );
    return;
  }
  let chId = null, chLabel = "Blogger";
  if (destination !== "blogger") {
    chId = getChannels(env)[chName] || null;
    if (!chId) {
      await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Channel '${chName}' not found.`);
      await setSession(env, uid, { state: "composing" });
      return;
    }
    chLabel = chName;
  }
  const targetLabel = destination === "blogger" ? "Blogger" : destination === "telegram" ? chLabel : `${chLabel} + Blogger`;
  if (session.schedule_time) {
    const drafts = await getDrafts(env, uid);
    const posts = Object.values(drafts);
    if (!posts.length) {
      await editMessageText(env, cq.message.chat.id, cq.message.message_id, `No drafts left to schedule.`);
      await setSession(env, uid, { state: "composing" });
      return;
    }
    const target = parseBDTime(session.schedule_time);
    const stub = env.SCHEDULE.get(env.SCHEDULE.idFromName("global"));
    await stub.schedule({
      uid, destination, channel_name: chLabel, channel_id: chId,
      posts, schedule_time: session.schedule_time,
    }, target.getTime());
    for (const post of posts) await safeDelete(env, uid, post.preview_msg_id);
    await deleteDrafts(env, uid);
    await setSession(env, uid, { state: "composing" });
    await editMessageText(env, cq.message.chat.id, cq.message.message_id, `<b>Scheduled</b> for <b>${session.schedule_time}</b> (BD time) -> <b>${targetLabel}</b>.`);
    await sendMessage(env, uid, `All done!  Use <b>Add Post</b> to create more.`, postMovieMenuKeyboard());
    return;
  }
  await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Publishing to <b>${targetLabel}</b>...`);
  const drafts = await getDrafts(env, uid);
  const posts = Object.values(drafts);
  const total = posts.length;
  for (const post of posts) {
    await safeDelete(env, uid, post.preview_msg_id);
    post.preview_msg_id = null;
  }
  const status = await sendMessage(env, uid, `Sending 0 / ${total}...`);
  let sentCount = 0;
  const publishedPosts = [];
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    try {
      await publishPost(env, destination, chId, post);
      sentCount++;
      publishedPosts.push(post);
      await editMessageText(env, status.chat.id, status.message_id, `Sending ${sentCount} / ${total}...`);
    } catch (exc) {
      await sendMessage(env, uid, `Post ${i + 1} ("${post.tg_title}") failed: ${exc.message}`);
    }
  }
  const cacheTarget = destination === "blogger" ? defaultCacheChannel() : chLabel;
  if (cacheTarget) await addPublishedToCache(env, cacheTarget, publishedPosts);
  for (const post of posts) await safeDelete(env, uid, post.preview_msg_id);
  await deleteDrafts(env, uid);
  await setSession(env, uid, { state: "composing" });
  await editMessageText(env, status.chat.id, status.message_id, `Published <b>${sentCount}/${total}</b> to <b>${targetLabel}</b>.`);
  await sendMessage(env, uid, `All done!  Use <b>Add Post</b> to create more.`, postMovieMenuKeyboard());
}

async function receiveScheduleTime(msg, env, uid, session) {
  const text = (msg.text || "").trim();
  if (text.toLowerCase() === "cancel") {
    await setSession(env, uid, { state: "composing" });
    await sendMessage(env, uid, `Scheduling cancelled.`, postMovieMenuKeyboard());
    return;
  }
  const target = parseBDTime(text);
  if (!target) {
    await sendMessage(env, uid, `Invalid format. Use <code>YYYY-MM-DD HH:MM</code>, e.g. <code>${formatBDNow()}</code>.`, postMovieMenuKeyboard());
    return;
  }
  if (target.getTime() <= Date.now()) {
    await sendMessage(env, uid, `This time has already passed. Please choose a future date & time.`, postMovieMenuKeyboard());
    return;
  }
  const destination = session.destination || "both";
  await setSession(env, uid, { state: "select_channel", schedule_time: text, destination });
  await sendMessage(env, uid, `<b>Select a channel to publish this post:</b>\n<i>Scheduled for ${text} (BD time)</i>`, sendOptionsKeyboard(env, destination, "schedule"));
}

async function cbDraftAction(cq, env, uid) {
  const [action, postId] = cq.data.split("::");
  const drafts = await getDrafts(env, uid);
  if (action === "dp_del_ask") {
    await answerCallback(env, cq.id);
    await editMessageReplyMarkup(env, cq.message.chat.id, cq.message.message_id, postConfirmDeleteKeyboard(postId));
    return;
  }
  if (action === "dp_del_no") {
    await answerCallback(env, cq.id, "Cancelled.");
    const post = drafts[postId];
    await editMessageReplyMarkup(env, cq.message.chat.id, cq.message.message_id, postActionKeyboard(postId, post ? post.links : []));
    return;
  }
  if (action === "dp_del") {
    await answerCallback(env, cq.id, "Deleted!");
    const post = drafts[postId];
    delete drafts[postId];
    await setDrafts(env, uid, drafts);
    await deleteMessage(env, cq.message.chat.id, cq.message.message_id);
    const remaining = Object.keys(drafts).length;
    await sendMessage(env, uid, `<b>"${post ? post.tg_title : "Unknown"}"</b> deleted.\n<i>${remaining} draft(s) remaining.</i>`, postMovieMenuKeyboard());
    return;
  }
  if (action === "dp_edit") {
    await answerCallback(env, cq.id);
    if (!drafts[postId]) {
      await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Post not found.`);
      return;
    }
    await safeDelete(env, uid, drafts[postId].preview_msg_id);
    drafts[postId].preview_msg_id = null;
    await setDrafts(env, uid, drafts);
    const sent = await sendMessage(env, uid, `<b>Edit Post</b>\n\nSelect the field you want to change:`, editFieldKeyboard(postId));
    await setSession(env, uid, { state: "composing", edit_menu_msg_id: sent.message_id });
  }
}

async function cbEditField(cq, env, uid, field, postId) {
  await answerCallback(env, cq.id);
  if (field === "cancel") {
    await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Edit cancelled.`);
    await sendMessage(env, uid, `Back to Post Movie menu.`, postMovieMenuKeyboard());
    await setSession(env, uid, { state: "composing" });
    return;
  }
  await setSession(env, uid, { state: "edit_field", editing_field: field, editing_post_id: postId });
  await editMessageText(env, cq.message.chat.id, cq.message.message_id, FIELD_PROMPTS[field]);
}

async function receiveEditedField(msg, env, uid, session) {
  const { editing_field: field, editing_post_id: postId } = session;
  const text = msg.text || "";
  if (!field || !postId) {
    await sendMessage(env, uid, `No active edit session.\nUse <b>Preview</b> -> Edit.`, postMovieMenuKeyboard());
    await setSession(env, uid, { state: "composing" });
    return;
  }
  if (text.toLowerCase() === "cancel") {
    await setSession(env, uid, { state: "composing" });
    await sendMessage(env, uid, `Editing cancelled.`, postMovieMenuKeyboard());
    return;
  }
  const drafts = await getDrafts(env, uid);
  if (!drafts[postId]) {
    await sendMessage(env, uid, `Draft not found.`, postMovieMenuKeyboard());
    await setSession(env, uid, { state: "composing" });
    return;
  }
  const post = drafts[postId];
  if (field === "tg_thumbnail") {
    if (msg.photo) post.tg_thumbnail = msg.photo[msg.photo.length - 1].file_id;
    else if (text.toLowerCase() === "none") post.tg_thumbnail = null;
    else if (text.startsWith("http://") || text.startsWith("https://")) post.tg_thumbnail = text;
    else {
      await sendMessage(env, uid, `Send a photo, a URL, or <code>none</code> to remove.`, postMovieMenuKeyboard());
      return;
    }
  } else if (field === "bg_thumbnail") {
    if (text.toLowerCase() === "none") post.bg_thumbnail = "";
    else if (text.startsWith("http://") || text.startsWith("https://")) post.bg_thumbnail = text;
    else {
      await sendMessage(env, uid, `Send a valid image URL, or <code>none</code> to remove.`, postMovieMenuKeyboard());
      return;
    }
  } else if (field === "video_url") {
    if (text.toLowerCase() === "none") post.video_url = "";
    else post.video_url = text.trim();
  } else if (field === "links") {
    let raw;
    try { raw = JSON.parse(text || "[]"); }
    catch (exc) {
      await sendMessage(env, uid, `<b>JSON Error</b>\n\n<code>${exc.message}</code>\n\nPlease try again.`, postMovieMenuKeyboard());
      return;
    }
    if (!Array.isArray(raw)) {
      await sendMessage(env, uid, `Must be a JSON <b>array</b>, e.g. <code>[{"text":"How To Download","url":"https://..."}]</code>`, postMovieMenuKeyboard());
      return;
    }
    const newLinks = raw.filter((l) => l && typeof l.text === "string" && typeof l.url === "string" && (l.url.startsWith("http://") || l.url.startsWith("https://")));
    const skipped = raw.length - newLinks.length;
    post.links = newLinks;
    if (skipped > 0) await sendMessage(env, uid, `Skipped ${skipped} invalid entr${skipped === 1 ? "y" : "ies"} (need "text" + valid http(s) "url").`);
  } else {
    const val = text.trim();
    if (!val) {
      await sendMessage(env, uid, `No value received. Please try again.`, postMovieMenuKeyboard());
      return;
    }
    post[field] = val;
  }
  await setDrafts(env, uid, drafts);
  await setSession(env, uid, { state: "composing" });
  const fieldLabel = field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  await sendMessage(env, uid, `<b>${fieldLabel}</b> updated successfully!`, postMovieMenuKeyboard());
  await showPreviews(env, uid);
}

async function btnLiveEdit(env, uid) {
  await setMenu(env, uid, "live_edit");
  await setSession(env, uid, { state: "live_edit" });
  await sendMessage(env, uid, `<b>Live Edit Mode</b>\n\nForward the channel post you want to edit to this chat.`, mainKeyboard());
}

function parseTelegramChannelMessageLink(text) {
  const m = String(text || "").match(/^https?:\/\/t\.me\/c\/(\d+)\/(\d+)(?:[?#].*)?$/i);
  if (!m) return null;
  return { channel_id: Number(`-100${m[1]}`), message_id: Number(m[2]), url: text };
}

async function receiveLiveLink(link, env, uid) {
  const key = `${link.channel_id}_${link.message_id}`;
  await statePut(env, `fwd:${key}`, JSON.stringify({
    media_id: null,
    media_type: null,
    caption: "",
    source_url: link.url,
  }), 86400);
  const template = {
    channel_id: link.channel_id,
    message_id: link.message_id,
    media: "keep",
    caption: "",
    buttons: []
  };
  await setSession(env, uid, { state: "live_edit" });
  await sendMessage(
    env, uid,
    `<b>Live Edit Link Accepted</b>\n\n<b>Channel ID:</b> <code>${link.channel_id}</code>\n<b>Message ID:</b> <code>${link.message_id}</code>\n\nSend the JSON below after adding the new caption/buttons.\n\n<code>${escapeHtml(JSON.stringify(template, null, 2))}</code>`,
    mainKeyboard()
  );
}

async function receiveForwarded(msg, env, uid) {
  let chId, mId, chName;
  const o = msg.forward_origin;
  if (o && o.type === "channel") { chId = o.chat.id; mId = o.message_id; chName = o.chat.title; }
  else if (msg.forward_from_chat) { chId = msg.forward_from_chat.id; mId = msg.forward_from_message_id; chName = msg.forward_from_chat.title; }
  else {
    await sendMessage(env, uid, `Could not identify source channel.\nForward the post directly from the channel.`, mainKeyboard());
    return;
  }
  let mediaId = null, mediaType = null;
  if (msg.photo) { mediaId = msg.photo[msg.photo.length - 1].file_id; mediaType = "photo"; }
  else if (msg.video) { mediaId = msg.video.file_id; mediaType = "video"; }
  const key = `${chId}_${mId}`;
  await statePut(env, `fwd:${key}`, JSON.stringify({ media_id: mediaId, media_type: mediaType, caption: msg.caption || "" }), 86400);
  const info = `<b>Post Identified</b>\n\n<b>Channel:</b>    ${chName}\n<b>Channel ID:</b> <code>${chId}</code>\n<b>Message ID:</b> <code>${mId}</code>\n<b>File ID:</b>    <code>${mediaId || "none"}</code>`;
  const markup = { inline_keyboard: [[{ text: `${getEmoji('edit')} Edit This Post`, callback_data: `lv_prep::${key}` }]] };
  if (mediaId && mediaType === "photo") await sendPhoto(env, uid, mediaId, info, markup);
  else if (mediaId && mediaType === "video") await sendVideo(env, uid, mediaId, info, markup);
  else await sendMessage(env, uid, info, markup);
}

async function cbLivePrepare(cq, env, key) {
  await answerCallback(env, cq.id);
  const ids = key.split("_");
  const raw = await stateGet(env, `fwd:${key}`);
  const stored = raw ? JSON.parse(raw) : {};
  const template = {
    channel_id: Number(ids[0]), message_id: Number(ids[1]), media: "keep",
    caption: stored.caption || "New caption here",
    buttons: [{ text: "How To Download", url: "https://t.me/example" }, { text: "Download", url: "https://t.me/example" }],
  };
  const js = JSON.stringify(template, null, 4);
  await sendMessage(env, cq.message.chat.id, `<b>Copy, edit, and send back this JSON:</b>\n\n<code>${js}</code>\n\nSet <code>media</code> to <code>change</code> and attach a photo/video to replace media.`);
}

async function receiveLiveJson(text, msg, env, uid) {
  let data;
  try { data = JSON.parse(text); }
  catch (exc) {
    await sendMessage(env, uid, `JSON error: ${exc.message}`, mainKeyboard());
    return;
  }
  const key = `${data.channel_id}_${data.message_id}`;
  const raw = await stateGet(env, `fwd:${key}`);
  const stored = raw ? JSON.parse(raw) : {};
  let finalMediaId, finalMediaType;
  if (data.media === "change") {
    if (msg.photo) { finalMediaId = msg.photo[msg.photo.length - 1].file_id; finalMediaType = "photo"; }
    else if (msg.video) { finalMediaId = msg.video.file_id; finalMediaType = "video"; }
    else {
      await sendMessage(env, uid, `media='change' but no file attached.`, mainKeyboard());
      return;
    }
  } else { finalMediaId = stored.media_id; finalMediaType = stored.media_type; }
  const links = (data.buttons || []).filter((b) => b.text && b.url);
  const markup = liveConfirmKeyboard(key, links);
  data._media_id = finalMediaId; data._media_type = finalMediaType;
  await setSession(env, uid, { state: "live_edit", live_edit: data });
  if (finalMediaId && finalMediaType === "photo") await sendPhoto(env, uid, finalMediaId, data.caption, markup);
  else if (finalMediaId && finalMediaType === "video") await sendVideo(env, uid, finalMediaId, data.caption, markup);
  else await sendMessage(env, uid, data.caption, markup);
}

async function cbLiveConfirm(cq, env, uid) {
  await answerCallback(env, cq.id);
  const session = await getSession(env, uid);
  const data = session.live_edit;
  if (!data) {
    await sendMessage(env, uid, `Session expired. Start again.`, mainKeyboard());
    return;
  }
  const links = (data.buttons || []).filter((b) => b.text && b.url);
  const markup = links.length ? { inline_keyboard: linkRows(links) } : undefined;
  try {
    if (data.media === "change") {
      await editMessageMedia(env, data.channel_id, data.message_id, { type: data._media_type, media: data._media_id, caption: data.caption }, markup);
    } else {
      // For a direct t.me/c/... link we do not know whether the target is a
      // media message or a text message. Try caption first, then text.
      try {
        await editMessageCaption(env, data.channel_id, data.message_id, data.caption, markup);
      } catch (captionErr) {
        await tg(env, "editMessageText", { chat_id: data.channel_id, message_id: data.message_id, text: data.caption, parse_mode: "HTML", reply_markup: markup });
      }
    }
    await deleteMessage(env, cq.message.chat.id, cq.message.message_id);
    await setSession(env, uid, { state: "live_edit" });
    await sendMessage(env, uid, `Post updated successfully.`, mainKeyboard());
  } catch (exc) {
    await sendMessage(env, cq.message.chat.id, `Update failed: ${exc.message}`, mainKeyboard());
  }
}

function cacheStub(env, channelName) {
  return env.CACHE_QUEUE.get(env.CACHE_QUEUE.idFromName(channelName));
}

function defaultCacheChannel() {
  // Blogger-only posts are stored in the neutral Random cache.
  return "Random";
}

function toCacheItem(post) {
  return {
    tg_title: post.tg_title, bg_title: post.bg_title, language: post.language,
    quality: post.quality, duration: post.duration, release_year: post.release_year,
    bg_thumbnail: post.bg_thumbnail, tg_thumbnail: post.tg_thumbnail, video_url: post.video_url,
    permalink: resolvePermalink(post), labels: post.labels, links: post.links,
  };
}

async function addPublishedToCache(env, channelName, posts) {
  if (!channelName || !CACHE_CHANNELS[channelName] || !posts.length) return;
  await cacheStub(env, channelName).upload(channelName, posts.map(toCacheItem));
}

function cacheChannelKeyboard(prefix, includeAll = false) {
  const names = Object.keys(CACHE_CHANNELS).filter((n) => n !== "Random");
  const rows = [];
  let row = [];
  for (const name of names) {
    row.push({ text: `${getEmoji('cache')} ${name}`, callback_data: `${prefix}::${encodeURIComponent(name)}` });
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: `${getEmoji('sparkles')} Random`, callback_data: `${prefix}::Random` }]);
  if (includeAll) rows.push([{ text: `${getEmoji('download_data')} Download All`, callback_data: `${prefix}::all` }]);
  return { inline_keyboard: rows };
}

function randomCacheTargetKeyboard(env, prefix = "cpt") {
  const names = Object.keys(getChannels(env));
  const rows = [];
  let row = [];
  for (const name of names) {
    row.push({ text: `${getEmoji('send')} ${name}`, callback_data: `${prefix}::${encodeURIComponent(name)}` });
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: `${getEmoji('back')} Back`, callback_data: `${prefix}::back` }]);
  return { inline_keyboard: rows };
}

const CACHE_HOW_TO_DOWNLOAD_URL = "https://t.me/backup2k24/72";

const DOWNLOAD_LINK_PLACEHOLDER = "YOUR_DOWNLOAD_LINK_HERE";

function stripTelegramFormatting(value) {
  return decodeHtmlEntities(String(value ?? ""))
    .replace(/<[^>]*>/g, "")
    .replace(/\r/g, "");
}

function extractPostFromMessage(msg) {
  const raw = String(msg.caption || msg.text || "");
  const plain = stripTelegramFormatting(raw).trim();
  const boldTitle = raw.match(/<b>\s*([^<]+?)\s*<\/b>/i);
  let title = boldTitle
    ? stripTelegramFormatting(boldTitle[1]).trim()
    : (plain.split("\n").map(s => s.trim()).find(Boolean) || "Untitled");
  title = title.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const grab = (patterns) => {
    for (const re of patterns) {
      const m = plain.match(re);
      if (m) return m[1].trim();
    }
    return "";
  };
  const language = grab([
    /(?:^|\n)\s*Language\s*:\s*([^\n]+)/i,
  ]);
  const quality = grab([
    /(?:^|\n)\s*Movie\s+Quality\s*:\s*([^\n]+)/i,
    /(?:^|\n)\s*Quality\s*:\s*([^\n]+)/i,
  ]);
  const duration = grab([
    /(?:^|\n)\s*Duration\s*:\s*([^\n]+)/i,
  ]);
  const releaseYear = grab([
    /(?:^|\n)\s*Movie\s+Release\s*:\s*([^\n]+)/i,
    /(?:^|\n)\s*Release\s*:\s*([^\n]+)/i,
  ]);
  let thumbnail = null;
  let mediaId = null;
  let mediaType = null;
  if (msg.photo && msg.photo.length) {
    thumbnail = msg.photo[msg.photo.length - 1].file_id;
    mediaId = thumbnail;
    mediaType = "photo";
  } else if (msg.video) {
    mediaId = msg.video.file_id;
    thumbnail = mediaId;
    mediaType = "video";
  }
  let sourceKey = null;
  const origin = msg.forward_origin;
  if (origin && origin.type === "channel" && origin.chat && origin.message_id != null) {
    sourceKey = `channel:${origin.chat.id}:${origin.message_id}`;
  } else if (msg.forward_from_chat && msg.forward_from_message_id != null) {
    sourceKey = `channel:${msg.forward_from_chat.id}:${msg.forward_from_message_id}`;
  }
  return {
    title: title || "Untitled",
    language,
    quality,
    duration,
    releaseYear,
    thumbnail,
    mediaId,
    mediaType,
    source_key: sourceKey,
  };
}

function buildUploadTemplateItem(extracted) {
  return {
    TGTitle: extracted.title || "Untitled",
    Language: extracted.language || "N/A",
    Quality: extracted.quality || "N/A",
    Duration: extracted.duration || "N/A",
    Release_year: extracted.releaseYear || "N/A",
    TGTitlehumbnail: extracted.thumbnail || "",
    Permalink: "N/A",
    links: [
      {
        text: "How To Download",
        url: CACHE_HOW_TO_DOWNLOAD_URL,
      },
      {
        text: "Download",
        url: DOWNLOAD_LINK_PLACEHOLDER,
      },
    ],
  };
}

function buildCacheItem(data, photoFileId, channelName) {
  const rawLinks = Array.isArray(data.links) ? data.links : [];
  const links = rawLinks.filter((l) => l && typeof l.text === "string" && typeof l.url === "string" && (l.url.startsWith("http://") || l.url.startsWith("https://")));
  let permalink = String(data["Permalink"] || "").trim();
  if (!permalink || permalink.toUpperCase() === "N/A") {
    permalink = buildSlug(data["TGTitle"], data["Release_year"]);
  }
  const explicitFileId =
    data["File_ID"] ||
    data["file_id"] ||
    data["FileId"] ||
    data["TGFileID"] ||
    data["TGFileId"] ||
    data["TGFile_ID"] ||
    null;
  const item = {
    tg_title: data["TGTitle"] || "Untitled",
    language: data["Language"] || "N/A",
    quality: data["Quality"] || "N/A",
    duration: data["Duration"] || "N/A",
    release_year: data["Release_year"] || "N/A",
    tg_thumbnail: photoFileId || explicitFileId || data["TGTitlehumbnail"] || null,
    file_id: photoFileId || explicitFileId || null,
    permalink,
    links,
    channel: channelName,
  };
  return {
    item,
    skippedLinks: rawLinks.length - links.length
  };
}

function csvEscape(v) {
  const s = v === undefined || v === null ? "" : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildCsv(items) {
  const headers = ["channel", "permalink", "tg_title", "language", "quality", "duration", "release_year", "tg_thumbnail", "links"];
  const rows = [headers.join(",")];
  for (const it of items) {
    const row = headers.map((h) => (h === "links" ? csvEscape(JSON.stringify(it.links || [])) : csvEscape(it[h])));
    rows.push(row.join(","));
  }
  return "\uFEFF" + rows.join("\n");
}

async function sendDocument(env, chatId, filename, content, mimeType) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([content], { type: mimeType }), filename);
  const res = await fetch(`https://api.telegram.org/bot${(env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN)}/sendDocument`, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram sendDocument error");
  return data.result;
}

async function getTelegramFileText(env, fileId) {
  const info = await tg(env, "getFile", { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${(env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN)}/${info.file_path}`;
  const res = await fetch(url);
  return await res.text();
}

function cacheEditFieldKeyboard() {
  const rows = []; let row = [];
  for (const [label, key] of CACHE_EDIT_FIELDS) {
    row.push({ text: label, callback_data: `cef::${key}` });
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: `${getEmoji('cancel')} Cancel Edit`, callback_data: "cef::cancel" }]);
  return { inline_keyboard: rows };
}

function cachePreviewActionKeyboard(item) {
  const rows = linkRows((item && item.links) || []);
  rows.push([
    { text: `${getEmoji('edit')} Edit Post`, callback_data: "cps::edit" },
    { text: `${getEmoji('send')} Send Post`, callback_data: "cps::go" },
    { text: `${getEmoji('cancel')} Cancel`, callback_data: "cps::cancel" },
  ]);
  return { inline_keyboard: rows };
}

function cachePreviewFieldKeyboard() {
  const rows = []; let row = [];
  for (const [label, key] of CACHE_EDIT_FIELDS) {
    row.push({ text: label, callback_data: `cpf::${key}` });
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: `${getEmoji('back')} < Back`, callback_data: "cps::back" }]);
  return { inline_keyboard: rows };
}

async function sendPreviewPost(env, uid, item, markup) {
  const caption = formatPost(item, {});
  if (item.tg_thumbnail) return sendPhoto(env, uid, item.tg_thumbnail, caption, markup);
  return sendMessage(env, uid, caption, markup);
}

async function cacheBtnUpload(env, uid) {
  await sendMessage(
    env,
    uid,
    `Select the channel to upload cache data for:`,
    cacheChannelKeyboard("cu")
  );
}

async function cbCacheUploadChannel(cq, env, uid, channel) {
  await answerCallback(env, cq.id);
  const single = JSON.stringify({
    TGTitle: "Your Movie Name (2026)",
    Language: "Your Movie Language",
    Quality: "Your Quality",
    Duration: "Your Duration",
    Release_year: "Your Release Year",
    TGTitlehumbnail: "your_thumbnail_url_or_telegram_file_id",
    Permalink: "N/A",
    links: [
      { text: "How To Download", url: CACHE_HOW_TO_DOWNLOAD_URL },
      { text: "Download", url: "your_download_link" },
    ],
  }, null, 2);
  const bulk = JSON.stringify([
    JSON.parse(single),
    JSON.parse(single),
  ], null, 2);
  await setSession(env, uid, {
    state: "cache_upload_wait_data",
    cache_channel: channel,
    cache_upload_pending: [],
    cache_upload_control_msg_id: null,
  });
  const text =
    `Uploading to: <b>${channel}</b>\n\n` +
    `Send a single item as JSON, or a JSON array for bulk. You can also attach a .txt file containing the JSON.\n\n` +
    `<b>Or forward channel posts:</b> forward one or more existing posts here. ` +
    `The bot will collect them and, after <b>Done</b>, generate one editable bulk JSON. ` +
    `The <b>How To Download</b> link is filled automatically; only the per-post <b>Download</b> links need to be replaced.\n\n` +
    `<b>Single item example</b>:\n<code>${escapeHtml(single)}</code>\n\n` +
    `<b>Bulk example</b>:\n<code>${escapeHtml(bulk)}</code>`;
  await sendMessage(env, uid, text, movieCacheMenuKeyboard());
}

async function uploadJsonToCache(msg, env, uid, session) {
  const channel = session.cache_channel;
  if (!channel) {
    await setSession(env, uid, {});
    await sendMessage(env, uid, `Upload session expired.`, movieCacheMenuKeyboard());
    return;
  }
  let raw = null;
  let photoFileId = null;
  if (msg.document) {
    try {
      raw = await getTelegramFileText(env, msg.document.file_id);
    } catch (exc) {
      await sendMessage(env, uid, `File read error: ${exc.message}`, movieCacheMenuKeyboard());
      return;
    }
  } else {
    raw = msg.photo ? msg.caption : (msg.text || msg.caption || "");
    if (msg.photo) photoFileId = msg.photo[msg.photo.length - 1].file_id;
  }
  if (!raw || !raw.trim()) {
    await sendMessage(
      env,
      uid,
      `No JSON data received. Send JSON text, a JSON photo caption, or a .txt file.`,
      movieCacheMenuKeyboard()
    );
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (exc) {
    await sendMessage(
      env,
      uid,
      `JSON Error: ${exc.message}\n\nSend the corrected JSON again.`,
      movieCacheMenuKeyboard()
    );
    return;
  }
  const rawItems = Array.isArray(data) ? data : [data];
  const items = [];
  let invalid = 0;
  let linkWarnings = 0;
  for (const d of rawItems) {
    if (!d || !d["TGTitle"]) {
      invalid++;
      continue;
    }
    const { item, skippedLinks } = buildCacheItem(
      d,
      rawItems.length === 1 ? photoFileId : null,
      channel
    );
    items.push(item);
    linkWarnings += skippedLinks;
  }
  if (!items.length) {
    await sendMessage(
      env,
      uid,
      `No valid items found. Every item must contain <code>TGTitle</code>.`,
      movieCacheMenuKeyboard()
    );
    return;
  }
  const seen = new Map();
  let batchDupes = 0;
  for (const it of items) {
    if (it.permalink && seen.has(it.permalink)) batchDupes++;
    seen.set(it.permalink, it);
  }
  const dedupedItems = [...seen.values()];
  try {
    const result = await cacheStub(env, channel).upload(channel, dedupedItems);
    const idsList = (result.permalinks || [])
      .map((p, i) => `${i + 1}. <code>${escapeHtml(p)}</code>`)
      .join("\n");
    let message =
      `Uploaded to <b>${channel}</b>: ${result.added} added.\n` +
      `Total pending: ${result.total}.`;
    if (invalid) message += `\n${invalid} invalid item(s) skipped.`;
    if (linkWarnings) message += `\n${linkWarnings} invalid link(s) skipped.`;
    if (batchDupes) message += `\n${batchDupes} duplicate permalink(s) in this JSON were merged (last one kept).`;
    if (idsList) message += `\n\n<b>ID(s):</b>\n${idsList}`;
    if (result.conflicts.length) {
      const conflictItems = dedupedItems.filter((it) => result.conflicts.includes(it.permalink));
      await setSession(env, uid, {
        state: "cache_upload_conflict_wait",
        cache_channel: channel,
        cache_upload_conflict_items: conflictItems,
      });
      const list = result.conflicts.map((p, i) => `${i + 1}. <code>${escapeHtml(p)}</code>`).join("\n");
      message += `\n\n<b>${result.conflicts.length} item(s)</b> already exist in the cache with this Permalink:\n${list}\n\nUpdate them with the new JSON details?`;
      const markup = { inline_keyboard: [[
        { text: `${getEmoji("cancel")} No`, callback_data: `cud1::no` },
        { text: `${getEmoji("done")} Yes`, callback_data: `cud1::yes` },
      ]] };
      await sendMessage(env, uid, message, markup);
      return;
    }
    await setSession(env, uid, {});
    await sendMessage(env, uid, message, movieCacheMenuKeyboard());
  } catch (exc) {
    await sendMessage(
      env,
      uid,
      `Upload failed: ${exc.message}`,
      movieCacheMenuKeyboard()
    );
  }
}

async function cacheReceiveUploadData(msg, env, uid, session) {
  const channel = session.cache_channel;
  if (!(msg.forward_origin || msg.forward_from_chat)) {
    return uploadJsonToCache(msg, env, uid, session);
  }
  const pending = Array.isArray(session.cache_upload_pending)
    ? session.cache_upload_pending
    : [];
  const extracted = extractPostFromMessage(msg);
  if (!extracted.title || extracted.title === "Untitled") {
    await sendMessage(
      env,
      uid,
      `Could not read the post title. Forward a normal channel post containing the movie caption.`,
      movieCacheMenuKeyboard()
    );
    return;
  }
  if (extracted.source_key && pending.some((p) => p && p.source_key === extracted.source_key)) {
    return;
  }
  pending.push(extracted);
  const oldControlId = session.cache_upload_control_msg_id;
  if (oldControlId) {
    await deleteMessage(env, uid, oldControlId);
  }
  const control = await sendMessage(
    env,
    uid,
    `<b>${pending.length}</b> post(s) collected.\n\nForward more posts or press <b>Done</b> to generate the bulk JSON.`,
    doneCancelKeyboard("cud")
  );
  await setSession(env, uid, {
    state: "cache_upload_collecting",
    cache_channel: channel,
    cache_upload_pending: pending,
    cache_upload_control_msg_id: control.message_id,
  });
}

async function cbCacheUploadDone(cq, env, uid, action) {
  await answerCallback(env, cq.id);
  const session = await getSession(env, uid);
  const channel = session.cache_channel;
  const pending = Array.isArray(session.cache_upload_pending)
    ? session.cache_upload_pending
    : [];
  if (action === "cancel") {
    if (session.cache_upload_control_msg_id) {
      await deleteMessage(env, uid, session.cache_upload_control_msg_id);
    }
    await setSession(env, uid, {});
    await sendMessage(
      env,
      uid,
      `Back to Movie Cache.`,
      movieCacheMenuKeyboard()
    );
    return;
  }
  if (action !== "done") return;
  if (!channel || !pending.length) {
    if (session.cache_upload_control_msg_id) {
      await deleteMessage(env, uid, session.cache_upload_control_msg_id);
    }
    await setSession(env, uid, {});
    await sendMessage(env, uid, `Back to Movie Cache.`, movieCacheMenuKeyboard());
    return;
  }
  const templateItems = pending.map(buildUploadTemplateItem);
  const jsonData = templateItems.length === 1
    ? templateItems[0]
    : templateItems;
  const jsonText = JSON.stringify(jsonData, null, 2);
  if (session.cache_upload_control_msg_id) {
    await deleteMessage(env, uid, session.cache_upload_control_msg_id);
  }
  await setSession(env, uid, {
    state: "cache_upload_wait_data",
    cache_channel: channel,
    cache_upload_pending: [],
    cache_upload_control_msg_id: null,
  });
  const instruction =
    `<b>Bulk JSON ready</b>\n\n` +
    `Replace every <code>${DOWNLOAD_LINK_PLACEHOLDER}</code> with its real Download URL, then send this JSON back to the bot. ` +
    `It will be uploaded directly to <b>${escapeHtml(channel)}</b>.\n\n` +
    `<code>${escapeHtml(jsonText)}</code>`;
  if (instruction.length > 3900) {
    await sendDocument(
      env,
      uid,
      "movie_cache_bulk.json",
      jsonText,
      "application/json"
    );
    await sendMessage(
      env,
      uid,
      `JSON is ready as <code>movie_cache_bulk.json</code>. Replace the Download URLs and send the JSON file back.`,
      movieCacheMenuKeyboard()
    );
  } else {
    await sendMessage(
      env,
      uid,
      instruction,
      movieCacheMenuKeyboard()
    );
  }
}

async function cacheBtnView(env, uid) {
  const names = Object.keys(CACHE_CHANNELS).filter((n) => n !== "Random");
  const rows = [];
  let row = [];
  for (const name of names) {
    row.push({ text: `${getEmoji('cache')} ${name}`, callback_data: `cv::${encodeURIComponent(name)}::0` });
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([
    { text: `${getEmoji('sparkles')} Random`, callback_data: `cv::Random::0` },
    { text: `${getEmoji('back')} Back`, callback_data: "cv::back" },
  ]);
  await sendMessage(env, uid, `<b>View Data</b>\n\nSelect a cache to view its IDs:`, { inline_keyboard: rows });
}

async function sendCacheIdsPage(env, uid, channel, page) {
  const items = await cacheStub(env, channel).getAll(channel);
  const total = items.length;
  const pageSize = 50;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const safePage = Math.min(Math.max(Number(page) || 0, 0), maxPage);
  const start = safePage * pageSize;
  const visible = items.slice(start, start + pageSize);
  const end = visible.length ? start + visible.length : start;
  let text = `<b>View Data — ${escapeHtml(channel)}</b>\n\n`;
  text += `<b>Showing ${total ? `${start + 1}-${end}` : "0"}/${total} keys</b>\n\n`;
  if (!visible.length) {
    text += `<i>No keys set yet.</i>`;
  } else {
    text += visible.map((it, i) => `${start + i + 1}. <code>${escapeHtml(it.permalink || "N/A")}</code>`).join("\n");
  }
  const rows = [];
  if (safePage > 0) rows.push([{ text: `${getEmoji('back')} Previous`, callback_data: `cv::${encodeURIComponent(channel)}::${safePage - 1}` }]);
  if (safePage < maxPage) rows.push([{ text: `Next ${getEmoji('send')}`, callback_data: `cv::${encodeURIComponent(channel)}::${safePage + 1}` }]);
  rows.push([{ text: `${getEmoji('back')} Back`, callback_data: "cv::back" }]);
  await sendMessage(env, uid, text, { inline_keyboard: rows });
}

async function cbCacheView(cq, env, uid, channel, page) {
  await answerCallback(env, cq.id);
  if (channel === "back") {
    await deleteMessage(env, cq.message.chat.id, cq.message.message_id);
    await sendMessage(env, uid, `<b>Movie Cache</b>`, movieCacheMenuKeyboard());
    return;
  }
  await deleteMessage(env, cq.message.chat.id, cq.message.message_id);
  await sendCacheIdsPage(env, uid, channel, Number(page) || 0);
}

async function cacheBtnDownloadMenu(env, uid) {
  await sendMessage(env, uid, `Select a channel to download its cache as CSV, or download all:`, cacheChannelKeyboard("cd", true));
}

async function cbCacheDownload(cq, env, uid, channel) {
  await answerCallback(env, cq.id);
  let items = [];
  if (channel === "all") {
    for (const name of Object.keys(CACHE_CHANNELS)) {
      const list = await cacheStub(env, name).getAll(name);
      items.push(...list.map((it) => ({ ...it, channel: name })));
    }
  } else {
    items = (await cacheStub(env, channel).getAll(channel)).map((it) => ({ ...it, channel }));
  }
  if (!items.length) {
    await sendMessage(env, uid, `No cache data to export.`, movieCacheMenuKeyboard());
    return;
  }
  const csv = buildCsv(items);
  const filename = channel === "all" ? "movie_cache_all.csv" : `movie_cache_${channel.replace(/\s+/g, "_")}.csv`;
  await sendDocument(env, uid, filename, csv, "text/csv");
}

async function cacheBtnPostFrom(env, uid) {
  await sendMessage(env, uid, `Select the channel:`, cacheChannelKeyboard("cp"));
}

async function cbCachePostChannel(cq, env, uid, channel) {
  await answerCallback(env, cq.id);
  if (channel === "Random") {
    await setSession(env, uid, { state: "cache_post_wait_target", cache_channel: "Random" });
    await sendMessage(env, uid, `<b>Random Cache</b>\n\nSelect the Telegram channel where the selected Random-cache movie should be posted:`, randomCacheTargetKeyboard(env));
    return;
  }
  await setSession(env, uid, { state: "cache_post_wait_permalink", cache_channel: channel, cache_target_channel: channel });
  await sendMessage(env, uid, `Send the Permalink (ID) of the item from <b>${channel}</b> you want to post now:`, movieCacheMenuKeyboard());
}

async function cbCacheRandomTarget(cq, env, uid, target) {
  await answerCallback(env, cq.id);
  if (target === "back") {
    await setSession(env, uid, {});
    await sendMessage(env, uid, `<b>Movie Cache</b>`, movieCacheMenuKeyboard());
    return;
  }
  const channels = getChannels(env);
  const channelId = channels[target];
  if (!channelId) {
    await sendMessage(env, uid, `Channel not found.`, movieCacheMenuKeyboard());
    return;
  }
  await setSession(env, uid, { state: "cache_post_wait_permalink", cache_channel: "Random", cache_target_channel: target });
  await sendMessage(env, uid, `Send the Permalink (ID) of the item from <b>Random</b> cache to post in <b>${escapeHtml(target)}</b>:`, movieCacheMenuKeyboard());
}

async function cacheReceivePostPermalink(msg, env, uid, session) {
  const channel = session.cache_channel;
  const permalink = (msg.text || "").trim();
  const item = await cacheStub(env, channel).getItem(channel, permalink);
  if (!item) {
    await sendMessage(env, uid, `No item found with Permalink "${permalink}" in ${channel}.`, movieCacheMenuKeyboard());
    return;
  }
  await setSession(env, uid, {
    ...session,
    state: "cache_preview",
    cache_channel: channel,
    cache_preview: item,
  });
  await sendPreviewPost(env, uid, item, cachePreviewActionKeyboard(item));
}

async function cbCachePreviewField(cq, env, uid, data) {
  await answerCallback(env, cq.id);
  const field = data.split("::")[1];
  const session = await getSession(env, uid);
  await setSession(env, uid, { ...session, state: "cache_preview_edit_field", editing_field: field });
  await sendMessage(env, uid, FIELD_PROMPTS[field], movieCacheMenuKeyboard());
}

async function cachePreviewReceiveEditedField(msg, env, uid, session) {
  const field = session.editing_field;
  const text = msg.text || "";
  const item = session.cache_preview;
  if (!item) { await sendMessage(env, uid, `Preview expired. Start again from Post From Data.`, movieCacheMenuKeyboard()); return; }
  if (text.toLowerCase() === "cancel") {
    await setSession(env, uid, { cache_channel: session.cache_channel, cache_preview: item });
    await sendMessage(env, uid, `Editing cancelled.`, movieCacheMenuKeyboard());
    return;
  }
  if (field === "tg_thumbnail") {
    if (msg.photo) item.tg_thumbnail = msg.photo[msg.photo.length - 1].file_id;
    else if (text.toLowerCase() === "none") item.tg_thumbnail = null;
    else if (text.startsWith("http://") || text.startsWith("https://")) item.tg_thumbnail = text;
    else { await sendMessage(env, uid, `Send a photo, a URL, or none.`, movieCacheMenuKeyboard()); return; }
  } else if (field === "links") {
    let raw;
    try { raw = JSON.parse(text || "[]"); }
    catch (exc) { await sendMessage(env, uid, `JSON Error: ${exc.message}`, movieCacheMenuKeyboard()); return; }
    if (!Array.isArray(raw)) { await sendMessage(env, uid, `Must be a JSON array.`, movieCacheMenuKeyboard()); return; }
    item.links = raw.filter((l) => l && typeof l.text === "string" && typeof l.url === "string" && (l.url.startsWith("http://") || l.url.startsWith("https://")));
  } else {
    const val = text.trim();
    if (!val) { await sendMessage(env, uid, `No value received.`, movieCacheMenuKeyboard()); return; }
    item[field] = val;
  }
  await setSession(env, uid, { cache_channel: session.cache_channel, cache_preview: item });
  await sendMessage(env, uid, `Updated. Preview refreshed below.`, movieCacheMenuKeyboard());
  await sendPreviewPost(env, uid, item, cachePreviewActionKeyboard(item));
}

async function cbCachePreviewSend(cq, env, uid, data) {
  await answerCallback(env, cq.id);
  const action = data.split("::")[1];
  const session = await getSession(env, uid);
  const item = session.cache_preview;
  const channel = session.cache_channel;
  if (!item) {
    await setSession(env, uid, {});
    await sendMessage(env, uid, `Preview expired. Start again.`, movieCacheMenuKeyboard());
    return;
  }
  if (action === "cancel") {
    await setSession(env, uid, {});
    await sendMessage(env, uid, `Cancelled.`, movieCacheMenuKeyboard());
    return;
  }
  if (action === "edit") {
    await editMessageReplyMarkup(env, cq.message.chat.id, cq.message.message_id, cachePreviewFieldKeyboard());
    return;
  }
  if (action === "back") {
    await editMessageReplyMarkup(env, cq.message.chat.id, cq.message.message_id, cachePreviewActionKeyboard(item));
    return;
  }
  const targetName = session.cache_target_channel || channel;
  const chId = channel === "Random"
    ? getChannels(env)[targetName]
    : (CACHE_CHANNELS[channel] || {}).id;
  if (!chId) {
    await sendMessage(env, uid, `No Telegram destination is selected for this cache item.`, movieCacheMenuKeyboard());
    return;
  }
  const markup = item.links && item.links.length ? { inline_keyboard: linkRows(item.links) } : undefined;
  try {
    await deleteMessage(env, cq.message.chat.id, cq.message.message_id);
    await sendPostMessage(env, chId, item, markup);
    await cacheStub(env, channel).resetCycle(channel, item.permalink);
    await setSession(env, uid, {});
    await sendMessage(env, uid, `Posted to <b>${escapeHtml(targetName)}</b> from <b>${escapeHtml(channel)}</b> cache. Its 10-day auto-post cycle has been reset.`, movieCacheMenuKeyboard());
  } catch (exc) {
    await sendMessage(env, uid, `Send failed: ${exc.message}`, movieCacheMenuKeyboard());
  }
}

async function cacheBtnEdit(env, uid) {
  await sendMessage(env, uid, `Select the channel:`, cacheChannelKeyboard("ce"));
}

async function cbCacheEditChannel(cq, env, uid, channel) {
  await answerCallback(env, cq.id);
  await setSession(env, uid, { state: "cache_edit_wait_permalink", cache_channel: channel });
  await sendMessage(env, uid, `Send the Permalink (ID) of the item in <b>${channel}</b> you want to edit:`, movieCacheMenuKeyboard());
}

async function cacheReceiveEditPermalink(msg, env, uid, session) {
  const channel = session.cache_channel;
  const permalink = (msg.text || "").trim();
  const item = await cacheStub(env, channel).getItem(channel, permalink);
  if (!item) {
    await sendMessage(env, uid, `No item found with Permalink "${permalink}" in ${channel}.`, movieCacheMenuKeyboard());
    return;
  }
  await setSession(env, uid, { cache_channel: channel, editing_permalink: permalink });
  await sendMessage(env, uid, `Editing "<b>${escapeHtml(item.tg_title)}</b>"\nSelect the field to change:`, cacheEditFieldKeyboard());
}

async function cbCacheEditField(cq, env, uid, data) {
  await answerCallback(env, cq.id);
  const field = data.split("::")[1];
  if (field === "cancel") {
    await setSession(env, uid, {});
    await sendMessage(env, uid, `Edit cancelled.`, movieCacheMenuKeyboard());
    return;
  }
  const session = await getSession(env, uid);
  await setSession(env, uid, { ...session, state: "cache_edit_field", editing_field: field });
  await sendMessage(env, uid, FIELD_PROMPTS[field], movieCacheMenuKeyboard());
}

async function cacheReceiveEditedField(msg, env, uid, session) {
  const { editing_field: field, editing_permalink: permalink, cache_channel: channel } = session;
  const text = msg.text || "";
  if (text.toLowerCase() === "cancel") {
    await setSession(env, uid, {});
    await sendMessage(env, uid, `Editing cancelled.`, movieCacheMenuKeyboard());
    return;
  }
  let value;
  if (field === "tg_thumbnail") {
    if (msg.photo) value = msg.photo[msg.photo.length - 1].file_id;
    else if (text.toLowerCase() === "none") value = null;
    else if (text.startsWith("http://") || text.startsWith("https://")) value = text;
    else { await sendMessage(env, uid, `Send a photo, a URL, or none.`, movieCacheMenuKeyboard()); return; }
  } else if (field === "links") {
    let raw;
    try { raw = JSON.parse(text || "[]"); }
    catch (exc) { await sendMessage(env, uid, `JSON Error: ${exc.message}`, movieCacheMenuKeyboard()); return; }
    if (!Array.isArray(raw)) { await sendMessage(env, uid, `Must be a JSON array.`, movieCacheMenuKeyboard()); return; }
    value = raw.filter((l) => l && typeof l.text === "string" && typeof l.url === "string" && (l.url.startsWith("http://") || l.url.startsWith("https://")));
  } else {
    value = text.trim();
    if (!value) { await sendMessage(env, uid, `No value received.`, movieCacheMenuKeyboard()); return; }
  }
  const ok = await cacheStub(env, channel).editItem(channel, permalink, field, value);
  await setSession(env, uid, {});
  if (!ok) { await sendMessage(env, uid, `Item not found (it may have been posted or deleted).`, movieCacheMenuKeyboard()); return; }
  await sendMessage(env, uid, `Updated successfully.`, movieCacheMenuKeyboard());
}

async function cacheBtnDelete(env, uid) {
  await sendMessage(env, uid, `Select the channel:`, cacheChannelKeyboard("cx"));
}

async function cbCacheDeleteChannel(cq, env, uid, channel) {
  await answerCallback(env, cq.id);
  await setSession(env, uid, { state: "cache_delete_wait_permalink", cache_channel: channel });
  await sendMessage(env, uid, `Send the Permalink (ID) of the item in <b>${channel}</b> you want to delete:`, movieCacheMenuKeyboard());
}

async function cacheReceiveDeletePermalink(msg, env, uid, session) {
  const channel = session.cache_channel;
  const permalink = (msg.text || "").trim();
  const item = await cacheStub(env, channel).getItem(channel, permalink);
  if (!item) {
    await sendMessage(env, uid, `No item found with Permalink "${permalink}" in ${channel}.`, movieCacheMenuKeyboard());
    return;
  }
  await setSession(env, uid, {});
  const markup = { inline_keyboard: [[{ text: `${getEmoji('cancel')} Cancel`, callback_data: `cxdel::no::${channel}::${permalink}` }, { text: `${getEmoji('trash')} Confirm Delete`, callback_data: `cxdel::yes::${channel}::${permalink}` }]] };
  await sendMessage(env, uid, `Delete "<b>${escapeHtml(item.tg_title)}</b>" from ${channel}?`, markup);
}

async function cbCacheDeleteConfirm(cq, env, uid, data) {
  await answerCallback(env, cq.id);
  const [, ans, channel, permalink] = data.split("::");
  if (ans === "no") {
    await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Cancelled.`);
    return;
  }
  const removed = await cacheStub(env, channel).deleteItem(channel, permalink);
  await editMessageText(env, cq.message.chat.id, cq.message.message_id, removed ? `Deleted "${escapeHtml(removed.tg_title)}" from ${channel}.` : `Item not found (already removed).`);
}

async function cacheBtnClearAllAsk(env, uid) {
  await sendMessage(env, uid, `Select which cache to clear:`, cacheChannelKeyboard("ccch", true));
}

async function cbCacheClearChannel(cq, env, uid, channel) {
  await answerCallback(env, cq.id);
  const markup = { inline_keyboard: [[
    { text: `${getEmoji('cancel')} Cancel`, callback_data: `cc1::no::${channel}` },
    { text: `${getEmoji('trash')} Clear All`, callback_data: `cc1::yes::${channel}` }
  ]] };
  const label = channel === "all" ? "ALL channels" : channel;
  await sendMessage(env, uid, `Clear cache for <b>${label}</b>? This cannot be undone.`, markup);
}

async function cbCacheClearConfirm1(cq, env, uid, data) {
  await answerCallback(env, cq.id);
  const [, ans, channel] = data.split("::");
  if (ans === "no") {
    await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Cancelled.`);
    return;
  }
  const markup = { inline_keyboard: [[
    { text: `${getEmoji('cancel')} Cancel`, callback_data: `cc2::no::${channel}` },
    { text: `${getEmoji('trash')} Clear All`, callback_data: `cc2::yes::${channel}` }
  ]] };
  const label = channel === "all" ? "ALL channels" : channel;
  await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Are you 100% sure? This will permanently clear <b>${label}</b>.`, markup);
}

async function cbCacheClearConfirm2(cq, env, uid, data) {
  await answerCallback(env, cq.id);
  const [, ans, channel] = data.split("::");
  if (ans === "no") {
    await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Cancelled.`);
    return;
  }
  if (channel === "all") {
    for (const name of Object.keys(CACHE_CHANNELS)) await cacheStub(env, name).clearAll(name);
  } else {
    await cacheStub(env, channel).clearAll(channel);
  }
  const label = channel === "all" ? "ALL channels" : channel;
  await editMessageText(env, cq.message.chat.id, cq.message.message_id, `Cache cleared for ${label}.`);
}

async function cbCacheUploadConflict1(cq, env, uid, data) {
  await answerCallback(env, cq.id);
  const ans = data.split("::")[1];
  const session = await getSession(env, uid);
  if (ans !== "yes" || !Array.isArray(session.cache_upload_conflict_items) || !session.cache_upload_conflict_items.length) {
    await setSession(env, uid, {});
    await editMessageReplyMarkup(env, cq.message.chat.id, cq.message.message_id, { inline_keyboard: [] });
    await sendMessage(env, uid, `Okay, existing item(s) were left unchanged.`, movieCacheMenuKeyboard());
    return;
  }
  const markup = { inline_keyboard: [[
    { text: `${getEmoji("cancel")} Back`, callback_data: `cud2::back` },
    { text: `${getEmoji("done")} Confirm Update`, callback_data: `cud2::confirm` },
  ]] };
  await editMessageReplyMarkup(env, cq.message.chat.id, cq.message.message_id, markup);
}

async function cbCacheUploadConflict2(cq, env, uid, data) {
  await answerCallback(env, cq.id);
  const ans = data.split("::")[1];
  const session = await getSession(env, uid);
  const channel = session.cache_channel;
  const items = Array.isArray(session.cache_upload_conflict_items) ? session.cache_upload_conflict_items : [];
  if (ans !== "confirm" || !channel || !items.length) {
    await setSession(env, uid, {});
    await editMessageReplyMarkup(env, cq.message.chat.id, cq.message.message_id, { inline_keyboard: [] });
    await sendMessage(env, uid, `Okay, existing item(s) were left unchanged.`, movieCacheMenuKeyboard());
    return;
  }
  const result = await cacheStub(env, channel).updateItems(channel, items);
  await setSession(env, uid, {});
  await editMessageReplyMarkup(env, cq.message.chat.id, cq.message.message_id, { inline_keyboard: [] });
  await sendMessage(env, uid, `Updated ${result.updated} item(s) in <b>${channel}</b> with the new JSON details.`, movieCacheMenuKeyboard());
}


function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSlug(title, releaseYear) {
  let s = (title || "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
  const yr = releaseYear && String(releaseYear).toUpperCase() !== "N/A" ? String(releaseYear).replace(/[^a-zA-Z0-9]/g, "") : "";
  return s + yr;
}

function resolvePermalink(post) {
  const p = (post.permalink || "").trim();
  if (!p || p.toUpperCase() === "N/A") return buildSlug(post.tg_title, post.release_year);
  return p;
}

function buildBloggerHtml(post) {
  const thumb = post.bg_thumbnail && post.bg_thumbnail.toUpperCase?.() !== "N/A" ? post.bg_thumbnail : "";
  const video = post.video_url && post.video_url.toUpperCase?.() !== "N/A" ? post.video_url : "";
  return (
    `<img src="${escapeHtml(thumb)}" style="display:none;"/>\n\n` +
    `<div id="video-url" style="display:none;">${escapeHtml(video)}</div>`
  );
}

function resolveMovieId(post) {
  const id = (post.movie_id || "").trim();
  if (!id || id.toUpperCase() === "N/A") return resolvePermalink(post);
  return id;
}

function buildBloggerHtmlV2(post) {
  const thumb = post.bg_thumbnail && post.bg_thumbnail.toUpperCase?.() !== "N/A" ? post.bg_thumbnail : "";
  const title = post.tg_title || post.bg_title || "Untitled";
  const synopsis = post.synopsis || "";
  const movieId = resolveMovieId(post);
  return (
    `<div class="bottom-container">\n` +
    `  <a href="${escapeHtml(thumb)}">\n` +
    `    <img class="ms-poster-img" alt="${escapeHtml(title)} Movie Poster" src="${escapeHtml(thumb)}"/>\n` +
    `  </a>\n` +
    `</div>\n\n` +
    `<div class="ms-movie-meta" id="ms-meta-load"></div>\n\n` +
    `<div class="ms-synopsis-section">\n` +
    ` <h2 class="ms-header">SYNOPSIS</h2>\n` +
    `  <p class="ms-para-text">${escapeHtml(synopsis)}</p>\n` +
    `</div>\n\n` +
    `<div class="ms-gallery" id="ms-gallery-load" data-id="${escapeHtml(movieId)}"></div>\n\n` +
    `<div class="ms-post-section">\n` +
    `  <div class="ms-dl-card">\n` +
    `    <div class="ms-dl-icon">\n` +
    `      <i class="fa-solid fa-film"></i>\n` +
    `    </div>\n` +
    `    <div class="ms-dl-info">\n` +
    `      <h4>DOWNLOAD FULL MOVIE</h4>\n` +
    `      <p>Available in 480p, 720p, and 1080p Quality.</p>\n` +
    `    </div>\n` +
    `    <a href="/p/download.html?id=${escapeHtml(movieId)}" class="ms-dl-btn">\n` +
    `      <i class="fa-solid fa-circle-down" style="margin-right: 5px;"></i> GET MOVIE\n` +
    `    </a>\n` +
    `  </div>\n` +
    `</div>`
  );
}

async function getBloggerAccessToken(env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.BLOGGER_CLIENT_ID,
      client_secret: env.BLOGGER_CLIENT_SECRET,
      refresh_token: env.BLOGGER_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Blogger token refresh failed: " + JSON.stringify(data));
  return data.access_token;
}

async function publishToBlogger(env, post) {
  const accessToken = await getBloggerAccessToken(env);
  const slug = resolvePermalink(post);
  const bloggerTitle = post.bg_title || post.tg_title || "Untitled";
  const content = buildBloggerHtml(post);
  const labels = (post.labels || "").split(",").map((s) => s.trim()).filter(Boolean);
  const createBody = { kind: "blogger#post", title: slug, content };
  if (labels.length) createBody.labels = labels;
  const createRes = await fetch(
    `https://www.googleapis.com/blogger/v3/blogs/${env.BLOG_ID}/posts/`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(createBody) }
  );
  const created = await createRes.json();
  if (!createRes.ok) throw new Error("Blogger create failed: " + JSON.stringify(created));
  const patchRes = await fetch(
    `https://www.googleapis.com/blogger/v3/blogs/${env.BLOG_ID}/posts/${created.id}`,
    { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: bloggerTitle }) }
  );
  const patched = await patchRes.json();
  if (!patchRes.ok) throw new Error("Blogger title update failed: " + JSON.stringify(patched));
  return patched;
}

async function publishToBloggerV2(env, post) {
  const accessToken = await getBloggerAccessToken(env);
  const slug = resolvePermalink(post);
  const bloggerTitle = post.bg_title || post.tg_title || "Untitled";
  const content = buildBloggerHtmlV2(post);
  const labels = (post.labels || "").split(",").map((s) => s.trim()).filter(Boolean);
  const createBody = { kind: "blogger#post", title: slug, content };
  if (labels.length) createBody.labels = labels;
  const createRes = await fetch(
    `https://www.googleapis.com/blogger/v3/blogs/${env.BLOG_ID_2}/posts/`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(createBody) }
  );
  const created = await createRes.json();
  if (!createRes.ok) throw new Error("Blogger (2) create failed: " + JSON.stringify(created));
  const patchRes = await fetch(
    `https://www.googleapis.com/blogger/v3/blogs/${env.BLOG_ID_2}/posts/${created.id}`,
    { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: bloggerTitle }) }
  );
  const patched = await patchRes.json();
  if (!patchRes.ok) throw new Error("Blogger (2) title update failed: " + JSON.stringify(patched));
  return patched;
}

async function publishPost(env, destination, chId, post) {
  let blogUrl = null;
  let blogUrl2 = null;
  if (destination !== "telegram") {
    const blogged = await publishToBlogger(env, post);
    blogUrl = blogged.url;
    if (env.BLOG_ID_2) {
      try {
        const blogged2 = await publishToBloggerV2(env, post);
        blogUrl2 = blogged2.url;
      } catch (exc) {
        console.error("Blog ID 2 publish failed:", exc);
      }
    }
  }
  if (destination !== "blogger") {
    const downloadUrl = blogUrl2 || blogUrl;
    if (destination === "both" && downloadUrl) {
      const existing = Array.isArray(post.links) ? post.links : [];
      post.links = [...existing, { text: "Download", url: downloadUrl }];
    }
    const markup = post.links && post.links.length ? { inline_keyboard: linkRows(post.links) } : undefined;
    await sendPostMessage(env, chId, post, markup);
  }
  return blogUrl;
}

function formatPost(p, opts = {}) {
  const lines = [
    `${getEmoji('movie')} <b>${escapeHtml(p.tg_title || "Untitled")}</b>\n`
  ];
  const fields = [
    [`${getEmoji('language')} Language`, p.language],
    [`${getEmoji('quality')} Movie Quality`, p.quality],
    [`${getEmoji('time')} Duration`, p.duration],
    [`${getEmoji('release')} Movie Release`, p.release_year],
  ];
  for (const [label, val] of fields) if (val && val !== "N/A") lines.push(`<b>${label} :</b>  ${escapeHtml(val)}`);
  lines.push(`\n${getEmoji('watch')} 𝗪𝗮𝘁𝗰𝗵 𝗢𝗻𝗹𝗶𝗻𝗲 / 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱 ${getEmoji('download')}`);
  if (opts.note) lines.push(`\n${getEmoji('info')} <i>Note: A "Download" button linking to the Blogger post is added automatically when publishing to Both.</i>`);
  return lines.join("\n");
}

function mainKeyboard() {
  return { keyboard: [["🎬 Post Movie", "💾 Movie Cache", "✏️ Live Edit"], ["⬅️ Back"]], resize_keyboard: true, one_time_keyboard: false };
}

function postMovieMenuKeyboard() {
  return { keyboard: [["Add Post", "Preview", "Send Post"], ["Clear All", "Back"]], resize_keyboard: true, one_time_keyboard: false };
}

function movieCacheMenuKeyboard() {
  return { keyboard: [["Upload Data", "View Data", "Download Data"], ["Post From Data", "Edit Data", "Delete Data"], ["Clear All", "Back"]], resize_keyboard: true, one_time_keyboard: false };
}

function keyboardForMenu(menu) {
  if (menu === "post_movie") return postMovieMenuKeyboard();
  if (menu === "movie_cache") return movieCacheMenuKeyboard();
  return mainKeyboard();
}

function destinationKeyboard() {
  return {
    inline_keyboard: [
      [{ text: `${getEmoji('doc')} Blogger`, callback_data: "dest::blogger" }, { text: `${getEmoji('send')} Telegram`, callback_data: "dest::telegram" }, { text: `${getEmoji('link')} Both`, callback_data: "dest::both" }],
      [{ text: `${getEmoji('cancel')} Cancel`, callback_data: "dest::cancel" }],
    ],
  };
}

function sendOptionsKeyboard(env, destination, mode) {
  const rows = [];
  if (destination === "blogger") {
    rows.push([{ text: `${getEmoji('send')} Publish to Blogger`, callback_data: "ch::bg_publish" }]);
  } else {
    const names = Object.keys(getChannels(env));
    let row = [];
    for (const name of names) {
      row.push({ text: name, callback_data: `ch::${name}` });
      if (row.length === 2) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
  }
  if (mode === "schedule") {
    rows.push([{ text: `${getEmoji('cancel')} Cancel`, callback_data: "ch::cancel" }, { text: `${getEmoji('edit')} Edit Time`, callback_data: "ch::edit_time" }]);
  } else {
    rows.push([{ text: `${getEmoji('cancel')} Cancel`, callback_data: "ch::cancel" }, { text: `${getEmoji('schedule')} Set Time`, callback_data: "ch::set_time" }]);
  }
  return { inline_keyboard: rows };
}

function formatBDNow() {
  const now = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

function parseBDTime(text) {
  const m = (text || "").trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const yr = Number(y), mon = Number(mo), day = Number(d), hr = Number(h), min = Number(mi);
  if (mon < 1 || mon > 12 || day < 1 || day > 31 || hr > 23 || min > 59) return null;
  const dateCheck = new Date(Date.UTC(yr, mon - 1, day));
  if (dateCheck.getUTCFullYear() !== yr || dateCheck.getUTCMonth() !== mon - 1 || dateCheck.getUTCDate() !== day) return null;
  return new Date(Date.UTC(yr, mon - 1, day, hr, min) - 6 * 60 * 60 * 1000);
}

function nextBDAlarmTime(hour, minute) {
  const bdNow = new Date(Date.now() + 6 * 3600 * 1000);
  const y = bdNow.getUTCFullYear(), mo = bdNow.getUTCMonth(), d = bdNow.getUTCDate();
  let target = new Date(Date.UTC(y, mo, d, hour, minute));
  if (target.getTime() <= bdNow.getTime()) target = new Date(target.getTime() + 24 * 3600 * 1000);
  return target.getTime() - 6 * 3600 * 1000;
}

function postActionKeyboard(postId, links) {
  const rows = linkRows(links || []);
  rows.push([{ text: `${getEmoji('edit')} Edit`, callback_data: `dp_edit::${postId}` }, { text: `${getEmoji('trash')} Delete`, callback_data: `dp_del_ask::${postId}` }]);
  return { inline_keyboard: rows };
}

function postConfirmDeleteKeyboard(postId) {
  return { inline_keyboard: [[{ text: `${getEmoji('cancel')} Cancel`, callback_data: `dp_del_no::${postId}` }, { text: `${getEmoji('trash')} Yes, Delete`, callback_data: `dp_del::${postId}` }]] };
}

function editFieldKeyboard(postId) {
  const rows = []; let row = [];
  for (const [label, key] of EDIT_FIELDS) {
    row.push({ text: label, callback_data: `ef::${key}::${postId}` });
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: `${getEmoji('cancel')} Cancel Edit`, callback_data: `ef::cancel::${postId}` }]);
  return { inline_keyboard: rows };
}

function liveConfirmKeyboard(key, links) {
  const rows = linkRows(links);
  rows.push([{ text: `${getEmoji('edit')} Edit Again`, callback_data: `lv_prep::${key}` }, { text: `${getEmoji('confirm')} Confirm Update`, callback_data: `lv_confirm::${key}` }]);
  return { inline_keyboard: rows };
}

function linkRows(links) {
  const rows = []; let row = [];
  links.forEach((lnk, i) => {
    row.push({ text: lnk.text, url: lnk.url });
    if (row.length === 2 || i === links.length - 1) { rows.push(row); row = []; }
  });
  return rows;
}

async function cleanupUnknownKeys(env) {
  // Legacy KV cleanup is intentionally gone. Share Movie state now lives in
  // sharded Durable Objects and does not require a global scan.
  return;
}

function stateStub(env, scope) {
  return env.POST_STATE.get(env.POST_STATE.idFromName(String(scope)));
}

async function stateGet(env, key) {
  return stateStub(env, key).get("value");
}

async function statePut(env, key, value, ttlSeconds = 0) {
  return stateStub(env, key).put("value", value, ttlSeconds);
}

async function stateDelete(env, key) {
  return stateStub(env, key).delete("value");
}

async function getDrafts(env, uid) {
  const raw = await stateGet(env, `user:${uid}:drafts`);
  return raw ? JSON.parse(raw) : {};
}

async function setDrafts(env, uid, drafts) {
  await statePut(env, `user:${uid}:drafts`, JSON.stringify(drafts), 1209600);
}

async function deleteDrafts(env, uid) {
  await stateDelete(env, `user:${uid}:drafts`);
}

async function getSession(env, uid) {
  const raw = await stateGet(env, `user:${uid}:session`);
  return raw ? JSON.parse(raw) : {};
}

async function setSession(env, uid, session) {
  await statePut(env, `user:${uid}:session`, JSON.stringify(session), 21600);
}

async function clearSession(env, uid) {
  await stateDelete(env, `user:${uid}:session`);
}

async function getMenu(env, uid) {
  const raw = await stateGet(env, `user:${uid}:menu`);
  return raw || "main";
}

async function setMenu(env, uid, menu) {
  await statePut(env, `user:${uid}:menu`, menu, 2592000);
}

async function tg(env, method, payload) {
  const finalPayload = {
    ...payload,
    reply_markup: decodeKeyboardEmoji(payload && payload.reply_markup),
  };
  const res = await fetch(`https://api.telegram.org/bot${(env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(finalPayload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}

function sendMessage(env, chatId, text, markup) { return tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: markup }); }

function sendPhoto(env, chatId, photo, caption, markup) { return tg(env, "sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", reply_markup: markup }); }

function sendVideo(env, chatId, video, caption, markup) { return tg(env, "sendVideo", { chat_id: chatId, video, caption, parse_mode: "HTML", reply_markup: markup }); }

function editMessageText(env, chatId, messageId, text, markup) { return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: markup }).catch(() => {}); }

function editMessageReplyMarkup(env, chatId, messageId, markup) { return tg(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: markup }).catch(() => {}); }

function editMessageCaption(env, chatId, messageId, caption, markup) { return tg(env, "editMessageCaption", { chat_id: chatId, message_id: messageId, caption, reply_markup: markup }); }

function editMessageMedia(env, chatId, messageId, media, markup) { return tg(env, "editMessageMedia", { chat_id: chatId, message_id: messageId, media, reply_markup: markup }); }

function deleteMessage(env, chatId, messageId) { return tg(env, "deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {}); }

function answerCallback(env, id, text) { return tg(env, "answerCallbackQuery", { callback_query_id: id, text }); }

async function safeDelete(env, chatId, msgId) { if (msgId) await deleteMessage(env, chatId, msgId); }

async function sendPostMessage(env, chatId, post, markup, isPreview = false) {
  const caption = formatPost(post, { note: isPreview });
  if (post.tg_thumbnail) {
    try {
      return await sendPhoto(env, chatId, post.tg_thumbnail, caption, markup);
    } catch (photoErr) {
      // Telegram file_ids belong to the bot that created them. A file_id copied
      // from an older bot cannot be reused by a newly created bot. Fall back to
      // a text preview/post so one stale thumbnail never blocks the operation.
      console.warn("Thumbnail send failed; falling back to text:", photoErr?.message || photoErr);
    }
  }
  return sendMessage(env, chatId, caption, markup);
}

export class ScheduleDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.jobs = [];
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get("jobs");
      if (Array.isArray(saved)) this.jobs = saved;
    });
  }
  async schedule(job, whenMs) {
    const id = crypto.randomUUID();
    this.jobs.push({ id, job, whenMs });
    await this.ctx.storage.put("jobs", this.jobs);
    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm || alarm > whenMs) await this.ctx.storage.setAlarm(whenMs);
    return id;
  }
  async alarm() {
    const now = Date.now();
    const due = this.jobs.filter((j) => j.whenMs <= now);
    this.jobs = this.jobs.filter((j) => j.whenMs > now);
    await this.ctx.storage.put("jobs", this.jobs);
    for (const { job } of due) {
      let sentCount = 0;
      const publishedPosts = [];
      for (const post of job.posts) {
        try {
          await publishPost(this.env, job.destination || "both", job.channel_id, post);
          sentCount++;
          publishedPosts.push(post);
        } catch (exc) {
          await sendMessage(this.env, job.uid, `Scheduled post ("${post.tg_title}") failed: ${exc.message}`);
        }
      }
      const cacheTarget = (job.destination || "both") === "blogger" ? defaultCacheChannel() : job.channel_name;
      if (cacheTarget) await addPublishedToCache(this.env, cacheTarget, publishedPosts);
      await sendMessage(this.env, job.uid, `Scheduled batch published (${sentCount}/${job.posts.length}) to <b>${job.channel_name}</b>.`, mainKeyboard());
    }
    if (this.jobs.length) {
      const next = Math.min(...this.jobs.map((j) => j.whenMs));
      await this.ctx.storage.setAlarm(next);
    }
  }
}

export class CacheQueueDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = [];
    this.postedLog = [];
    this.skippedLog = [];
    this.channelName = null;
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get("state");
      if (saved) {
        this.queue = saved.queue || [];
        this.postedLog = saved.postedLog || [];
        this.skippedLog = saved.skippedLog || [];
        this.channelName = saved.channelName || null;
      }
    });
  }
  async _save() {
    const weekAndMore = Date.now() - 30 * 24 * 3600 * 1000;
    this.postedLog = this.postedLog.filter((t) => t >= weekAndMore);
    this.skippedLog = this.skippedLog.filter((t) => t >= weekAndMore);
    await this.ctx.storage.put("state", {
      queue: this.queue, postedLog: this.postedLog, skippedLog: this.skippedLog, channelName: this.channelName,
    });
  }
  async _ensureChannel(channelName) {
    if (this.channelName !== channelName) {
      this.channelName = channelName;
      await this._save();
    }
    const cfg = CACHE_CHANNELS[this.channelName];
    if (!cfg || cfg.manualOnly || !Number.isFinite(cfg.hour) || !Number.isFinite(cfg.minute)) return;
    const current = await this.ctx.storage.getAlarm();
    if (!current) await this.ctx.storage.setAlarm(nextBDAlarmTime(cfg.hour, cfg.minute));
  }
  async upload(channelName, items) {
    await this._ensureChannel(channelName);
    let added = 0;
    const addedPermalinks = [];
    const conflicts = [];
    const now = Date.now();
    for (const it of items) {
      if (!it.permalink) continue;
      if (this.queue.some((q) => q.permalink === it.permalink)) {
        conflicts.push(it.permalink);
        continue;
      }
      this.queue.push({ ...it, added_at: now, next_auto_at: now + 10 * 24 * 3600 * 1000 });
      added++;
      addedPermalinks.push(it.permalink);
    }
    await this._save();
    return { added, total: this.queue.length, permalinks: addedPermalinks, conflicts };
  }
  async updateItems(channelName, items) {
    await this._ensureChannel(channelName);
    let updated = 0;
    for (const it of items) {
      const existing = this.queue.find((q) => q.permalink === it.permalink);
      if (!existing) continue;
      const { added_at, next_auto_at, posted_at } = existing;
      Object.assign(existing, it, { added_at, next_auto_at, posted_at });
      updated++;
    }
    await this._save();
    return { updated };
  }
  async resetCycle(channelName, permalink) {
    await this._ensureChannel(channelName);
    const item = this.queue.find((q) => q.permalink === permalink);
    if (!item) return null;
    const now = Date.now();
    item.posted_at = now;
    item.next_auto_at = now + 10 * 24 * 3600 * 1000;
    await this._save();
    return item;
  }

  async getStats(channelName) {
    await this._ensureChannel(channelName);
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    return {
      total: this.queue.length,
      posted7: this.postedLog.filter((t) => t >= weekAgo).length,
      skipped7: this.skippedLog.filter((t) => t >= weekAgo).length,
    };
  }
  async getAll(channelName) {
    await this._ensureChannel(channelName);
    return this.queue;
  }
  async getItem(channelName, permalink) {
    await this._ensureChannel(channelName);
    return this.queue.find((q) => q.permalink === permalink) || null;
  }
  async editItem(channelName, permalink, field, value) {
    await this._ensureChannel(channelName);
    const item = this.queue.find((q) => q.permalink === permalink);
    if (!item) return false;
    item[field] = value;
    await this._save();
    return true;
  }
  async deleteItem(channelName, permalink) {
    await this._ensureChannel(channelName);
    const idx = this.queue.findIndex((q) => q.permalink === permalink);
    if (idx === -1) return null;
    const [removed] = this.queue.splice(idx, 1);
    await this._save();
    return removed;
  }
  async clearAll(channelName) {
    await this._ensureChannel(channelName);
    this.queue = [];
    await this._save();
  }
  async alarm() {
    const cfg = CACHE_CHANNELS[this.channelName];
    if (!cfg || cfg.manualOnly || !Number.isFinite(cfg.hour) || !Number.isFinite(cfg.minute)) return;
    const admins = (this.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const now = Date.now();
    const TEN_DAYS = 10 * 24 * 3600 * 1000;
    let migrated = false;
    for (const q of this.queue) {
      if (!Number.isFinite(q.next_auto_at)) {
        q.next_auto_at = now + TEN_DAYS;
        migrated = true;
      }
    }
    if (migrated) await this._save();
    const pool = this.queue.filter((q) => Number.isFinite(q.next_auto_at) && q.next_auto_at <= now);
    if (!pool.length) {
      this.skippedLog.push(now);
      await this._save();
      for (const a of admins) {
        await sendMessage(this.env, a, `Auto-post skipped for <b>${this.channelName}</b> - no cache item is 10+ days old yet.`);
      }
    } else {
      const picks = [];
      const remaining = [...pool];
      for (let i = 0; i < cfg.count && remaining.length; i++) {
        const oldest = remaining.reduce((a, b) => (a.next_auto_at <= b.next_auto_at ? a : b));
        const pick = Math.random() < 0.6 ? oldest : remaining[Math.floor(Math.random() * remaining.length)];
        picks.push(pick);
        remaining.splice(remaining.indexOf(pick), 1);
      }
      let sent = 0;
      for (const post of picks) {
        try {
          const markup = post.links && post.links.length ? { inline_keyboard: linkRows(post.links) } : undefined;
          if (!post.tg_thumbnail && post.file_id) post.tg_thumbnail = post.file_id;
          await sendPostMessage(this.env, cfg.id, post, markup);
          const postedAt = Date.now();
          post.posted_at = postedAt;
          post.next_auto_at = postedAt + TEN_DAYS;
          this.postedLog.push(postedAt);
          sent++;
        } catch (exc) {
          for (const a of admins) {
            await sendMessage(this.env, a, `Auto-post failed for <b>${this.channelName}</b> ("${post.tg_title}"): ${exc.message}`);
          }
        }
      }
      await this._save();
      for (const a of admins) {
        await sendMessage(this.env, a, `Auto-posted ${sent}/${picks.length} to <b>${this.channelName}</b>.`);
      }
    }
    await this.ctx.storage.setAlarm(nextBDAlarmTime(cfg.hour, cfg.minute));
  }
}