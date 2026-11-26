/**
 * CSS Platform API — the Discord #tasks channel.
 *
 * Set in Apps Script → Project Settings → Script Properties (never in the code, never sent to a page):
 *
 *   DISCORD_BOT_TOKEN    The @taskbot bot. Reads #tasks and posts there as itself (replies, reminders, new tasks).
 *   DISCORD_CHANNEL_ID   The #tasks channel id (right-click the channel → Copy Channel ID, with Developer Mode on).
 *   DISCORD_WEBHOOK_URL  Optional: a webhook for #tasks. Only used to post when the bot isn't set up.
 *
 * Written by the system (don't edit): DISCORD_LAST_SEEN (newest message already read; delete it to re-read the latest 100),
 * DISCORD_BOT_ID / DISCORD_BOT_NAME (who the bot is), DISCORD_BOT_ROLES (the bot's own role, so "@taskbot" picked as a role
 * also counts; delete it to ask Discord again), NEXT_TASK_REMINDER (when the next reminder is due), TASKBOT_LAST_TICK (when
 * the timer last ran).
 *
 * One rule for posting, everywhere: the bot when its token and the channel are set, otherwise the webhook.
 * Discord being down, slow or not set up never stops a task from being saved or the Tasks list from showing.
 * Discord is never called while the script lock is held: changes are saved first, the posts go out after.
 */

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_SYNC_SECONDS = 20;        // the Tasks tab reads replies at most this often, however many people open it
const DISCORD_SYNC_PAGES = 5;           // at most 5 × 100 new messages per read; the rest come on the next one
const DISCORD_NEW_TASK_HOURS = 24;      // an @taskbot message older than this is never turned into a task

/** What is set up. Callers only ever pass on the true/false parts: the secrets never go into a reply. */
function discordSetup_() {
  const props = PropertiesService.getScriptProperties();
  const webhook = String(props.getProperty("DISCORD_WEBHOOK_URL") || "").trim();
  const token = String(props.getProperty("DISCORD_BOT_TOKEN") || "").trim();
  const channel = String(props.getProperty("DISCORD_CHANNEL_ID") || "").trim();
  const reading = !!(token && channel);
  return { webhook: webhook, token: token, channel: channel, reading: reading, posting: reading || !!webhook };
}

/** Plain words about a failure, with any web address removed (a webhook address is itself a password). */
function discordSafeError_(err) {
  return String(err && err.message || err || "").replace(/https?:\/\/\S+/g, "(Discord)").slice(0, 200);
}

/** Stops a title from turning into bold/strike-through/spoiler text on Discord. */
function discordEscape_(text) {
  return String(text || "").replace(/([\\*_~`|>])/g, "\\$1");
}

/** How a person shows in a message: an @mention when their Discord ID is known, otherwise their name. */
function discordWho_(owner, discordId) {
  if (discordId) return "<@" + discordId + ">";
  return owner ? discordEscape_(owner) : "no owner yet";
}

/** Plain English for a Discord error code. what: "webhook" | "bot" (posting as the bot) | "read". */
function discordHttpError_(code, what) {
  if (code === 429) return "Discord asked us to slow down. Try again in a minute.";
  if (what === "webhook" && (code === 401 || code === 403 || code === 404)) return "Discord refused the message. The DISCORD_WEBHOOK_URL may have been deleted or changed.";
  if (code === 401) return "Discord didn't accept the bot. Check DISCORD_BOT_TOKEN.";
  if (code === 403) return what === "bot" ? "The bot can't post in #tasks. Give it Send Messages there." : "The bot can't read #tasks. Give it View Channel and Read Message History there.";
  if (code === 404) return "Discord couldn't find the #tasks channel. Check DISCORD_CHANNEL_ID.";
  return (what === "read" ? "Couldn't read Discord replies" : "Couldn't post to Discord") + " right now (error " + code + ").";
}

/** Keeps only real Discord user ids, once each (at most 100, Discord's limit). */
function discordUserIds_(ids) {
  return (ids || []).map(String).filter(function (id, i, all) { return /^\d{17,20}$/.test(id) && all.indexOf(id) === i; }).slice(0, 100);
}

/**
 * Posts one message to #tasks: as the bot (optionally as a reply to `replyTo`) when it is set up, otherwise through the webhook.
 * Only the listed people can be pinged: allowed_mentions.parse is empty, so @everyone, @here and role pings in a title never fire.
 * Returns { ok, id } or { ok: false, error }. Never throws.
 */
function discordSend_(content, userIds, replyTo) {
  const setup = discordSetup_();
  if (!setup.posting) return { ok: false, error: "Discord posting isn't set up yet." };
  const body = { content: String(content).slice(0, 2000), allowed_mentions: { parse: [], users: discordUserIds_(userIds) } };
  let url, options, what;
  if (setup.reading) {
    what = "bot";
    body.allowed_mentions.replied_user = false;
    if (replyTo) body.message_reference = { message_id: String(replyTo), fail_if_not_exists: false };
    url = DISCORD_API + "/channels/" + encodeURIComponent(setup.channel) + "/messages";
    options = { method: "post", contentType: "application/json", headers: { Authorization: "Bot " + setup.token }, payload: JSON.stringify(body), muteHttpExceptions: true };
  } else {
    what = "webhook";
    url = setup.webhook + (setup.webhook.indexOf("?") === -1 ? "?" : "&") + "wait=true";   // wait=true: the reply holds the new message's id
    options = { method: "post", contentType: "application/json", payload: JSON.stringify(body), muteHttpExceptions: true };
  }
  try {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) return { ok: false, error: discordHttpError_(code, what) };
    let reply = {};
    try { reply = JSON.parse(res.getContentText() || "{}"); } catch (e) { /* posted, but no id came back */ }
    return { ok: true, id: String(reply.id || "") };
  } catch (err) {
    return { ok: false, error: "Couldn't reach Discord: " + discordSafeError_(err) };
  }
}

/** The bot's own user id and name (asked once, then kept in Script Properties). { id, name }, or blanks when unknown. */
function discordBotUser_(setup) {
  const props = PropertiesService.getScriptProperties();
  const known = { id: String(props.getProperty("DISCORD_BOT_ID") || ""), name: String(props.getProperty("DISCORD_BOT_NAME") || "") };
  if ((known.id && known.name) || !setup.reading) return known;
  try {
    const res = UrlFetchApp.fetch(DISCORD_API + "/users/@me", { method: "get", headers: { Authorization: "Bot " + setup.token }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return known;
    const me = JSON.parse(res.getContentText() || "{}");
    if (!me.id) return known;
    props.setProperties({ DISCORD_BOT_ID: String(me.id), DISCORD_BOT_NAME: String(me.global_name || me.username || "taskbot") });
    return { id: String(me.id), name: String(me.global_name || me.username || "taskbot") };
  } catch (err) { return known; }
}

/**
 * The bot's own role ids (Discord gives every bot a role with its name, and people often pick that "@taskbot" instead of the
 * bot). Asked once (which server #tasks is in, then that server's roles), then kept in DISCORD_BOT_ROLES ("none" = it has none).
 * Returns a list, or null when Discord couldn't be asked (try again later). Never throws.
 */
function discordBotRoles_(setup, botId) {
  const props = PropertiesService.getScriptProperties();
  const known = String(props.getProperty("DISCORD_BOT_ROLES") || "");
  if (known) return known === "none" ? [] : known.split(",");
  if (!setup.reading || !botId) return null;
  const get = function (path) {
    const res = UrlFetchApp.fetch(DISCORD_API + path, { method: "get", headers: { Authorization: "Bot " + setup.token }, muteHttpExceptions: true });
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText() || "null") : null;
  };
  try {
    const channel = get("/channels/" + encodeURIComponent(setup.channel));
    if (!channel) return null;
    let roles = [];
    if (channel.guild_id) {
      const all = get("/guilds/" + encodeURIComponent(channel.guild_id) + "/roles");
      if (!Array.isArray(all)) return null;
      roles = all.filter(function (r) { return r && r.tags && String(r.tags.bot_id || "") === String(botId); }).map(function (r) { return String(r.id); });
    }
    props.setProperty("DISCORD_BOT_ROLES", roles.length ? roles.join(",") : "none");
    return roles;
  } catch (err) { return null; }
}

/** The message for a brand-new task made in the portal, @mentioning its assignees. */
function discordTaskMessage_(task, ownerDiscordId) {
  return "📌 **" + discordEscape_(task.title) + "** — " + taskDiscordWho_(task) +
    " · due " + taskDayText_(task.due, "no due date") + " · " + discordEscape_(task.department || "General") +
    "\nReply to this message with how it's going. Say **done** when it's finished.";
}

/** Snowflake ids are big numbers written as text: a longer one is newer, then compare letter by letter. */
function discordIdCompare_(a, b) {
  a = String(a); b = String(b);
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

const DISCORD_STATUS_WORDS = 6;   // "done"/"blocked" only count in a reply this short (mentions, emoji and punctuation left out)
const DISCORD_NOT_DONE = ["not", "no", "never", "almost", "nearly", "about", "half", "mostly", "partly", "will", "should", "shall", "would",
  "by", "until", "till", "before", "after", "yet", "soon", "if", "when", "once", "maybe", "might", "isnt", "arent", "wasnt", "hasnt",
  "havent", "hadnt", "wont", "cant", "dont", "didnt"];
const DISCORD_NOT_BLOCKED = ["not", "no", "never", "isnt", "arent", "wasnt", "werent", "dont", "didnt", "wont", "will", "should",
  "might", "maybe", "if", "unless", "anymore", "longer"];

/**
 * What a reply means for the task: done, blocked, or (for a task nobody started) doing. "" = leave it.
 * Careful on purpose, so "almost done" or "should be done by friday" don't close a task: done = ✅ anywhere, or a short reply
 * (6 words or fewer) saying done/finished/completed with no word like not, almost, by or until. Blocked works the same way
 * (⛔, or a short reply with blocked/stuck/waiting on).
 */
function discordReplyStatus_(text, current) {
  const raw = String(text || "");
  const words = raw.replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>/g, " ").toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+/g) || [];
  const short = words.length > 0 && words.length <= DISCORD_STATUS_WORDS;
  const has = function (list) { return words.some(function (w) { return list.indexOf(w) !== -1; }); };
  if (/✅|✔|☑/.test(raw)) return "done";
  if (short && has(["done", "finished", "completed", "complete"]) && !has(DISCORD_NOT_DONE)) return "done";
  if (/⛔/.test(raw)) return "blocked";
  if (short && (has(["blocked", "stuck"]) || /\bwaiting on\b/.test(words.join(" "))) && !has(DISCORD_NOT_BLOCKED)) return "blocked";
  if (current === "todo") return "doing";
  return "";
}

/** Reads one page of #tasks. Returns { ok, messages } (oldest first) or { ok: false, error }. Never throws. */
function discordReadPage_(setup, after) {
  const url = DISCORD_API + "/channels/" + encodeURIComponent(setup.channel) + "/messages?limit=100" + (after ? "&after=" + encodeURIComponent(after) : "");
  try {
    const res = UrlFetchApp.fetch(url, { method: "get", headers: { Authorization: "Bot " + setup.token }, muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) return { ok: false, error: discordHttpError_(code, "read") };
    const list = JSON.parse(res.getContentText() || "[]");
    if (!Array.isArray(list)) return { ok: false, error: "Discord sent something unexpected. Try again later." };
    return { ok: true, messages: list.slice().sort(function (a, b) { return discordIdCompare_(a.id, b.id); }) };
  } catch (err) {
    return { ok: false, error: "Couldn't reach Discord: " + discordSafeError_(err) };
  }
}

/**
 * A message the bot may act on: written by a person (not a bot or webhook), a normal message (type 0) or a reply (type 19),
 * and not a forwarded message. Pins, joins, thread notices and the like are left alone.
 */
function discordCandidate_(m) {
  if (!m || (m.author || {}).bot || m.webhook_id) return false;
  const type = Number(m.type || 0);
  if (type !== 0 && type !== 19) return false;
  return !(m.message_reference && Number(m.message_reference.type) === 1);   // message_reference.type 1 = forwarded
}

/** True when a message @mentions someone or a role (so it might be talking to the bot). */
function discordHasMentions_(m) {
  return String(m.content || "").indexOf("<@") !== -1 || (m.mentions || []).length > 0 || (m.mention_roles || []).length > 0;
}

/** True when a message @mentions a role. */
function discordHasRoleMention_(m) {
  return (m.mention_roles || []).length > 0 || /<@&\d+>/.test(String(m.content || ""));
}

/**
 * Reads the messages posted since the last read (the very first read: the latest 100). Nothing is saved yet.
 * Returns { ok, error, messages, newest, firstRun, relevant, botId, botRoles, hold } where relevant = some message needs the
 * sheet (a reply from a person, or a person mentioning the bot), and hold = someone @mentioned somebody but Discord couldn't
 * say who the bot is right now, so these messages must be read again next time (DISCORD_LAST_SEEN is not moved). Asks
 * Discord who the bot is only when needed; never while holding the lock. Never throws.
 */
function discordPull_(setup, pages) {
  const props = PropertiesService.getScriptProperties();
  let after = String(props.getProperty("DISCORD_LAST_SEEN") || "").trim();
  if (!/^\d+$/.test(after)) after = "";
  const out = { ok: true, error: "", messages: [], newest: "", firstRun: !after, relevant: false };
  for (let page = 0; page < (pages || DISCORD_SYNC_PAGES); page++) {
    const read = discordReadPage_(setup, after);
    if (!read.ok) { out.error = read.error; out.ok = out.messages.length > 0; break; }
    if (!read.messages.length) break;
    out.messages = out.messages.concat(read.messages);
    after = out.newest = String(read.messages[read.messages.length - 1].id);
    if (out.firstRun || read.messages.length < 100) break;   // the very first read only looks at the latest 100
  }
  out.botId = String(props.getProperty("DISCORD_BOT_ID") || "");
  out.botRoles = [];
  const people = out.messages.filter(discordCandidate_);
  const mentioning = people.filter(discordHasMentions_);
  if (mentioning.length) {   // only then ask who the bot is (kept after the first time)
    out.botId = discordBotUser_(setup).id;
    if (!out.botId) out.hold = true;
    else if (mentioning.some(discordHasRoleMention_)) {
      const roles = discordBotRoles_(setup, out.botId);
      if (roles) out.botRoles = roles; else out.hold = true;
    }
  }
  out.relevant = people.some(function (m) { return m.message_reference && m.message_reference.message_id; }) ||
    (!out.hold && people.some(function (m) { return discordMentions_(m, out.botId, out.botRoles); }));
  return out;
}

/** True when a message @mentions the bot, or the bot's own role. */
function discordMentions_(msg, botId, botRoles) {
  if (!botId) return false;
  const text = String(msg.content || "");
  if ((msg.mentions || []).some(function (u) { return String(u.id) === String(botId); }) ||
    text.indexOf("<@" + botId + ">") !== -1 || text.indexOf("<@!" + botId + ">") !== -1) return true;
  const roles = (msg.mention_roles || []).map(String);
  return (botRoles || []).some(function (r) { return roles.indexOf(String(r)) !== -1 || text.indexOf("<@&" + r + ">") !== -1; });
}

/** After a read that needed nothing from the sheet: remember it was read, unless it has to be read again (pull.hold). */
function discordMoveOn_(pull) {
  if (!pull.hold) discordSaveLastSeen_(pull.newest);
}

/** Remembers that everything up to `newest` has been read. */
function discordSaveLastSeen_(newest) {
  if (!newest) return;
  const props = PropertiesService.getScriptProperties();
  const was = String(props.getProperty("DISCORD_LAST_SEEN") || "");
  if (!was || discordIdCompare_(newest, was) > 0) props.setProperty("DISCORD_LAST_SEEN", String(newest));
}

/**
 * The Tasks tab's read of Discord (the core, button-free path): best effort, never throws, at most every 20 seconds.
 * Returns { synced: how many updates were added, error: "" or plain words }. A call in between repeats the last error,
 * so the warning line doesn't flicker.
 */
function syncDiscordReplies_() {
  const result = { synced: 0, error: "" };
  try {
    const setup = discordSetup_();
    if (!setup.reading) return result;
    const cache = CacheService.getScriptCache();
    const recent = cache.get("tasks_discord_sync");
    if (recent) {
      try { result.error = String(JSON.parse(recent).error || ""); } catch (e) { /* nothing to repeat */ }
      return result;
    }
    cache.put("tasks_discord_sync", JSON.stringify({ error: "" }), DISCORD_SYNC_SECONDS);   // claim this turn before the slow part
    const pull = discordPull_(setup);
    if (pull.relevant) {
      const saved = withLock_(function () {
        const applied = applyDiscordMessages_(pull);
        refreshNextReminder_();   // a "remind me …" reply may have changed when the next reminder is
        return applied;
      });
      discordSendPosts_(saved.posts);   // after the lock is released
      result.synced = saved.added;
      if (saved.emptyText) result.error = "Some Discord replies came in without their text. Turn on Message Content Intent for the bot in the Discord Developer Portal.";
    } else {
      discordMoveOn_(pull);
    }
    if (pull.error) result.error = pull.error;
    cache.put("tasks_discord_sync", JSON.stringify({ error: result.error }), DISCORD_SYNC_SECONDS);
  } catch (err) {
    result.error = err instanceof ApiError_ && err.code === "BUSY"
      ? "Couldn't check Discord replies (the system was busy). Refresh to try again."
      : "Couldn't check Discord replies: " + discordSafeError_(err);
  }
  return result;
}

/**
 * CALL WHILE HOLDING THE SCRIPT LOCK. Goes through the pulled messages, oldest first:
 *   - a reply to a task's message (its Discord post, the bot's confirmation, a reminder, or an earlier reply) becomes a
 *     TaskUpdate and can move the task's status; "remind me …" in a reply sets the task's reminder;
 *   - a new message (not a reply) that @mentions the bot (or its role) becomes a task.
 * Messages already saved are skipped, so reading the same ones twice adds nothing. Saves DISCORD_LAST_SEEN at the end
 * (unless pull.hold). Talks to nobody: the bot's answers come back in `posts`, for discordSendPosts_ to send AFTER the lock.
 * Returns { added, created, emptyText, posts }.
 */
function applyDiscordMessages_(pull) {
  const botId = String(pull.botId || PropertiesService.getScriptProperties().getProperty("DISCORD_BOT_ID") || "");
  const botRoles = pull.botRoles || [];
  const lastSeen = String(PropertiesService.getScriptProperties().getProperty("DISCORD_LAST_SEEN") || "");
  delete DB_.rows["Tasks"];
  delete DB_.rows["TaskUpdates"];
  const tasks = {}, byMessage = {}, seen = {};
  readRows_("Tasks").forEach(function (t) {
    if (t.discordMessageId) seen[String(t.discordMessageId)] = true;   // a message that already made a task
    if (t.removedAt) return;
    tasks[t.id] = t;
    if (t.discordMessageId) byMessage[String(t.discordMessageId)] = t.id;
    taskList_(t.discordRefs).forEach(function (ref) { byMessage[String(ref)] = t.id; });
  });
  readRows_("TaskUpdates").forEach(function (u) {
    if (!u.discordMessageId) return;
    seen[String(u.discordMessageId)] = true;
    if (tasks[u.taskId]) byMessage[String(u.discordMessageId)] = u.taskId;
  });
  const team = readRows_("Team");
  const member = function (discordId) { return team.filter(function (m) { return m.discordId && String(m.discordId) === String(discordId); })[0] || null; };

  const out = { added: 0, created: 0, emptyText: 0, posts: [] };
  pull.messages.forEach(function (msg) {
    const id = String(msg.id || "");
    if (!id || seen[id]) return;
    if (lastSeen && discordIdCompare_(id, lastSeen) <= 0 && !pull.firstRun) return;   // another read got here first
    if (!discordCandidate_(msg)) return;     // bots, webhooks, forwards, pins and other notices
    const author = msg.author || {};
    const parent = String((msg.message_reference || {}).message_id || "");
    const when = isNaN(Date.parse(msg.timestamp)) ? new Date() : new Date(msg.timestamp);
    const authorRow = member(author.id);
    const authorName = memberText_(authorRow ? authorRow.name : (author.global_name || author.username || "Someone on Discord"), 80);

    if (parent) {
      const taskId = byMessage[parent];
      if (!taskId) return;                     // a reply to something that isn't a task
      const task = tasks[taskId];
      let raw = String(msg.content || "").replace(/<@!?(\d{17,20})>/g, function (all, uid) {
        if (uid === botId) return "";
        const m = member(uid); return m ? "@" + m.name : all;
      }).replace(/<@&(\d+)>/g, function (all, rid) { return botRoles.indexOf(rid) !== -1 ? "" : all; }).trim();
      if (!raw) {
        if (msg.attachments && msg.attachments.length) raw = "(sent an attachment on Discord)";
        else { out.emptyText++; return; }
      }
      const text = noteText_(raw.slice(0, 1000));
      const remindSpecs = /\bremind\b/i.test(raw) ? tbTakeReminders_(" " + raw + " ").specs : [];
      let setStatus = "";
      if (!remindSpecs.length) {
        const status = discordReplyStatus_(raw, task.status);
        setStatus = status && status !== task.status ? status : "";
      }
      // A task given to everyone: "done" from someone whose name is in the checklist ticks their name. The task is done
      // only when that was the last thing left to tick.
      const tick = setStatus === "done" && authorRow ? taskTickName_(task, authorRow.name) : null;
      if (tick && !tick.allDone) setStatus = "";
      insertRow_("TaskUpdates", { id: newId_("TU"), taskId: taskId, text: text, by: authorName, source: "discord", status: setStatus, createdAt: when.toISOString(), discordMessageId: id });
      seen[id] = true;
      byMessage[id] = taskId;   // someone may reply to this reply
      out.added++;
      if (tick && tick.changed) {
        const ticked = { checklist: tick.checklist, updatedBy: authorName + " (Discord)", updatedAt: new Date().toISOString() };
        updateRow_("Tasks", task.id, ticked, task._row);
        Object.assign(task, ticked);
        log_(authorName + " (Discord)", "task.ticked", task.id, { title: task.title, name: String(authorRow.name || "").trim(), source: "discord" });
      }
      if (setStatus) {
        const changes = taskStatusChanges_(task, setStatus, authorName + " (Discord)");
        updateRow_("Tasks", task.id, changes, task._row);
        Object.assign(task, changes);
        log_(authorName + " (Discord)", "task.status", task.id, { title: task.title, status: setStatus, source: "discord" });
      }
      if (remindSpecs.length) out.posts.push(discordReplyReminders_(task, remindSpecs, when, authorName, id));
      return;
    }

    // A new message: only one that @mentions the bot, written recently, and not part of the very first read (old history).
    if (!discordMentions_(msg, botId, botRoles)) return;
    if (pull.firstRun || Date.now() - when.getTime() > DISCORD_NEW_TASK_HOURS * 3600000) return;
    const parsed = parseTaskMessage_(String(msg.content || ""), when, team, botId);
    seen[id] = true;
    if (!parsed.title) {
      out.posts.push({ replyTo: id, userIds: [], content: "🤔 What's the task? Try: <@" + botId + "> make reel for badminton by friday" });
      return;
    }
    const ownerId = parsed.ownerDiscordId || String(author.id || "");
    const ownerRow = parsed.ownerName && !parsed.ownerDiscordId ? taskTeamByName_(parsed.ownerName) : member(ownerId);
    const mentioned = (msg.mentions || []).filter(function (u) { return String(u.id) === ownerId; })[0];
    const ownerName = ownerRow ? ownerRow.name
      : ownerId === String(author.id) ? authorName
      : memberText_(mentioned ? (mentioned.global_name || mentioned.username) : "", 80);
    const ownerDiscordId = ownerRow ? teamDiscordId_(ownerRow) : (/^\d{17,20}$/.test(ownerId) ? ownerId : "");
    const assignees = (parsed.assignees.length ? parsed.assignees : [{ name: ownerName, discordId: ownerDiscordId }]).map(function (p) {
      const row = p.discordId ? member(p.discordId) : taskTeamByName_(p.name);
      const mention = (msg.mentions || []).filter(function (u) { return String(u.id) === p.discordId; })[0];
      return { name: row ? row.name : p.name || (p.discordId === String(author.id) ? authorName : memberText_(mention ? (mention.global_name || mention.username) : "", 60)) || p.discordId,
        discordId: row ? teamDiscordId_(row) : p.discordId };
    });
    const task = taskNewRow_({ title: parsed.title, owner: ownerName, ownerDiscordId: ownerDiscordId, due: parsed.due, remind: parsed.remind,
      assignees: assignees,
      department: teamTaskDepartment_(ownerRow, taskDepartments_()),
      by: authorName + " (Discord)", discordMessageId: id, now: when });
    insertRow_("Tasks", task);
    tasks[task.id] = task;
    byMessage[id] = task.id;
    out.created++;
    log_(authorName + " (Discord)", "task.created", task.id, { title: task.title, owner: task.owner, source: "discord" });
    const coming = discordComingReminders_(task);
    const dropped = tbDroppedText_(parsed.remindDropped);
    out.posts.push({ replyTo: id, taskId: task.id, userIds: taskOwnerDiscordIds_(task), content: "✅ Got it: **" + discordEscape_(task.title) + "** · " +
      taskDiscordWho_(task) + " · due " + taskDayText_(task.due, "no due date") + " · " +
      (parsed.remindNeedsDue ? "reminders need a due date (add one in the Tasks tab)"
        : coming.length ? (coming.length > 1 ? "reminders " : "reminder ") + coming.join("; ")
        : parsed.remind.length ? "the reminder time has already passed"
        : dropped ? "no reminder"
        : "no reminder — say 'remind halfway' to add one") + (dropped ? "\n" + dropped : "") });
  });
  if (!pull.hold) discordSaveLastSeen_(pull.newest);
  return out;
}

/** The task's reminders still to come, as "Wed, Dec 3 9:00 AM", soonest first. */
function discordComingReminders_(task) {
  const now = Date.now();
  return taskPendingReminders_(task).filter(function (r) { return r.at >= now - TASK_REMINDER_GRACE_MS; })
    .sort(function (a, b) { return a.at - b.at; }).map(function (r) { return taskWhenText_(r.at); });
}

/**
 * CALL WHILE HOLDING THE SCRIPT LOCK. A reply saying "remind me …" adds those reminders to the task (up to 5 in all) and
 * returns the bot's answer (a post for discordSendPosts_): when they'll go out, or why they can't.
 */
function discordReplyReminders_(task, specs, when, authorName, replyTo) {
  const here = edmParts_(when.getTime());
  const due = isYmd_(task.due) ? String(task.due) : "";
  const asked = tbRemindItems_(specs, due, here.ymd, here.dow);
  const post = { replyTo: replyTo, taskId: task.id, userIds: [] };
  const had = taskReminderItems_(task);
  const list = taskReminderDedupe_(had.concat(asked.items));
  const added = list.slice(had.length);
  if (added.length) {
    const changes = { remind: list, updatedBy: authorName + " (Discord)", updatedAt: new Date().toISOString() };
    changes.remindSent = taskSettledReminders_(Object.assign({}, task, changes), Date.now());
    updateRow_("Tasks", task.id, changes, task._row);
    Object.assign(task, changes);
    log_(authorName + " (Discord)", "task.updated", task.id, { title: task.title, remind: true, source: "discord" });
  }
  if (!due) {
    post.content = "🤔 This task has no due date, so reminders can't go out yet. Add a due date in the Tasks tab.";
    return post;
  }
  const dropped = tbDroppedText_(asked.dropped);
  if (!asked.items.length) {
    post.content = "🤔 " + (dropped || "That's after the due date (" + taskDayText_(due) + "), so there's nothing to remind about.");
    return post;
  }
  if (!added.length && had.length >= TASK_REMINDERS_MAX && asked.items.some(function (r) { return !had.some(function (h) { return h.n === r.n && h.unit === r.unit && h.at === r.at; }); })) {
    post.content = "🤔 This task already has " + TASK_REMINDERS_MAX + " reminders, the most it can have. Remove one in the Tasks tab first.";
    return post;
  }
  const now = Date.now();
  const coming = asked.items.map(function (r) { return taskReminderAt_(due, r); })
    .filter(function (at) { return at >= now - TASK_REMINDER_GRACE_MS; }).sort(function (a, b) { return a - b; });
  post.content = (coming.length
    ? "👍 " + (coming.length > 1 ? "Reminders" : "Reminder") + " set for " + coming.map(taskWhenText_).join("; ")
    : "🤔 That reminder time has already passed.") + (dropped ? "\n" + dropped : "");
  return post;
}

/**
 * NEVER CALL WHILE HOLDING THE SCRIPT LOCK. Sends the bot's posts (each { content, userIds, replyTo, taskId, reminder }),
 * then, with one short lock, remembers which task each new bot message belongs to (so replies to it count for that task)
 * and notes on the task any reminder that couldn't be posted (it is not tried again). Never throws.
 */
function discordSendPosts_(posts) {
  const refs = {}, failed = [];
  (posts || []).forEach(function (p) {
    const res = discordSend_(p.content, p.userIds || [], p.replyTo);
    if (res.ok && res.id && p.taskId) (refs[p.taskId] = refs[p.taskId] || []).push(String(res.id));
    if (!res.ok) {
      console.warn("Task bot message not posted: " + res.error);
      if (p.reminder && p.taskId) failed.push({ taskId: p.taskId, error: res.error });
    }
  });
  if (!Object.keys(refs).length && !failed.length) return;
  try {
    withLock_(function () {
      delete DB_.rows["Tasks"];
      readRows_("Tasks").forEach(function (t) {
        if (refs[t.id]) updateRow_("Tasks", t.id, { discordRefs: taskList_(t.discordRefs).concat(refs[t.id]) }, t._row);
      });
      failed.forEach(function (f) {
        insertRow_("TaskUpdates", { id: newId_("TU"), taskId: f.taskId, text: "⏰ The reminder couldn't be posted on Discord. " + f.error,
          by: "Task bot", source: "bot", status: "", createdAt: new Date().toISOString(), discordMessageId: "" });
      });
    });
  } catch (err) {
    console.error("Couldn't save the task bot's Discord messages: " + discordSafeError_(err));
  }
}
