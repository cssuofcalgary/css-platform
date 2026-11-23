// Tasks tab + Discord #tasks + @taskbot: adding/editing tasks, statuses, updates, removing, the team list (admin), posting to
// Discord (only the owner can be pinged), reading replies back, the bot making tasks from messages, reminders, and what
// happens when Discord is down or not set up.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const fn = (code) => { try { return { v: run(code) }; } catch (e) { return { err: e.code || "ERROR", msg: e.message }; } };

run(`
// The script lock: counted, so the tests can check Discord is never called (and NEXT_TASK_REMINDER never worked out) without it / with it.
var __locked = 0, __lockedFetches = 0, __unlockedRefresh = 0;
function withLock_(f) { __locked++; try { return f(); } finally { __locked--; } }
LockService = { getScriptLock: function () { var held = false; return { tryLock: function () { held = true; __locked++; return true; }, releaseLock: function () { if (held) { held = false; __locked--; } } }; } };
var __refreshReal = refreshNextReminder_;
refreshNextReminder_ = function () { if (!__locked) __unlockedRefresh++; return __refreshReal(); };
function table_() { return {}; }
function headerFor_() { return []; }
function deleteTabRows_(tab, ids) { TBL.Team = TBL.Team.filter(function (r) { return !ids[r.id]; }); return 1; }
var __logs = [];
function log_(who, action, target, details) { __logs.push({ who: who, action: action, target: target, details: details }); }
var __reads = 0;
var __readRowsReal = readRows_;
readRows_ = function (name) { __reads++; return __readRowsReal(name); };

// Fake Discord
var __fetches = [], __inbox = [], __mode = "", __posted = 0;
var BOT = "900000000000000001", KEV = "111111111111111111", AMY = "222222222222222222", ROLE = "800000000000000001", OTHER_ROLE = "800000000000000002";
function __handler(url, opts) {
  if (__mode === "throw") return { throws: "Address unavailable: " + url };
  if (__mode === "429") return { code: 429, body: {} };
  if (opts.method === "get" && url.indexOf("/users/@me") !== -1) return __mode === "nobot" ? { code: 500, body: {} } : { code: 200, body: { id: BOT, username: "taskbot" } };
  if (opts.method === "get" && /\\/channels\\/\\d+$/.test(url)) return { code: 200, body: { id: "555555555555555555", guild_id: "700000000000000001" } };
  if (opts.method === "get" && /\\/guilds\\/700000000000000001\\/roles$/.test(url)) return { code: 200, body: [{ id: OTHER_ROLE, name: "Execs" }, { id: ROLE, name: "taskbot", managed: true, tags: { bot_id: BOT } }] };
  if (opts.method === "get") {
    var after = (url.match(/after=(\\d+)/) || [])[1];
    return { code: 200, body: __inbox.filter(function (m) { return !after || discordIdCompare_(m.id, after) > 0; }).reverse().slice(0, 100) };
  }
  if (__mode === "postfail") return { code: 500, body: {} };
  __posted++;
  return { code: 200, body: { id: "30000000000000" + (1000 + __posted) } };
}
var UrlFetchApp = { fetch: function (url, opts) {
  opts = opts || {};
  if (__locked) __lockedFetches++;
  __fetches.push({ url: url, opts: opts, body: opts.payload ? JSON.parse(opts.payload) : null });
  var r = __handler(url, opts);
  if (r.throws) throw new Error(r.throws);
  return { getResponseCode: function () { return r.code; }, getContentText: function () { return JSON.stringify(r.body); } };
} };
var P = PropertiesService.getScriptProperties();
function __discord(kind) {   // kind: "" (nothing set) | "webhook" | "bot"
  ["DISCORD_WEBHOOK_URL", "DISCORD_BOT_TOKEN", "DISCORD_CHANNEL_ID"].forEach(function (k) { P.deleteProperty(k); });
  if (kind === "webhook") P.setProperty("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/SECRETWEBHOOK");
  if (kind === "bot") { P.setProperty("DISCORD_BOT_TOKEN", "SECRETTOKEN"); P.setProperty("DISCORD_CHANNEL_ID", "555555555555555555"); }
  CacheService.getScriptCache().remove("tasks_discord_sync");
  __fetches = []; __mode = "";
}
function __msg(n, o) {
  return Object.assign({ id: "20000000000000" + (1000 + n), author: { id: KEV, username: "kev", global_name: "Kev D" }, content: "",
    timestamp: new Date(Date.now() - (2000 - n) * 1000).toISOString(), mentions: [] }, o || {});   // later messages are newer
}
TBL.Tasks = []; TBL.TaskUpdates = []; TBL.Team = [];
var S = { name: "TEST Exec", role: "exec" };
var A = { name: "TEST Admin", role: "admin" };
`);

// ---- Team (admin only) --------------------------------------------------------------------------
const execTok = run(`startSession_("TEST Exec", "exec")`), adminTok = run(`startSession_("TEST Admin", "admin")`);
let r = fn(`route_({ action: "saveTeam", token: "${execTok}", team: [{ name: "X" }] })`);
ok(r.err === "ADMIN_ONLY", "saveTeam: an exec (not admin) is refused");
r = fn(`route_({ action: "saveTeam", token: "${adminTok}", team: [{ name: "Kevin", department: "Marketing", discordId: "12345", active: true }] })`);
ok(r.err === "BAD_REQUEST" && /17 to 20 digits/.test(r.msg), "saveTeam: a Discord ID that isn't 17-20 digits is refused");
r = fn(`route_({ action: "saveTeam", token: "${adminTok}", team: [{ name: "Kevin" }, { name: "kevin" }] })`);
ok(r.err === "BAD_REQUEST", "saveTeam: the same name twice is refused");
r = fn(`route_({ action: "saveTeam", token: "${adminTok}", team: [
  { name: "Kevin", department: "Marketing", discordId: KEV, active: true },
  { name: "Amy", department: "Events", discordId: " " + AMY + " ", active: true },
  { name: "Old Exec", department: "Finance", discordId: "", active: false },
  { name: "Gone Soon", department: "Nope", discordId: "", active: true },
  { name: "", discordId: "" } ] })`);
ok(r.v && r.v.ok && r.v.team.length === 4, "saveTeam: admin saves 4 people (the empty row is skipped)");
ok(run(`TBL.Team.filter(function (t) { return t.name === "Amy"; })[0].discordId`) === "222222222222222222", "Discord ID spaces are trimmed");
ok(run(`TBL.Team.filter(function (t) { return t.name === "Gone Soon"; })[0].department`) === "General", "an unknown department becomes General");
const teamIds = run(`TBL.Team.map(function (t) { return t.id; })`);
r = fn(`saveTeam_(A, TBL.Team.filter(function (t) { return t.name !== "Gone Soon"; }).map(function (t) { return { id: t.id, name: t.name, department: t.department, discordId: t.discordId, active: t.active === "true" || t.active === "TRUE" }; }))`);
ok(r.v && r.v.team.length === 3 && run(`TBL.Team.length`) === 3 && run(`TBL.Team.map(function (t) { return t.id; }).join()`) === teamIds.filter((x, i) => i !== 3).join(), "saveTeam replaces the list: rows left out are removed, the others keep their ids");
ok(run(`__logs.some(function (l) { return l.action === "team.saved"; })`), "team.saved is logged");
ok(fn(`saveTeam_(A, [])`).err === "BAD_REQUEST" && fn(`saveTeam_(A, [{ name: "  " }, {}])`).err === "BAD_REQUEST" && run(`TBL.Team.length`) === 3,
  "saveTeam: an empty list (or only blank rows) is refused, and the team is kept");

// ---- Creating and editing tasks ----------------------------------------------------------------
run(`__discord("")`);
r = fn(`saveTask_(S, { title: "   ", owner: "Kevin" })`);
ok(r.err === "BAD_REQUEST", "a task needs a title");
r = fn(`saveTask_(S, { title: "${"x".repeat(141)}" })`);
ok(r.err === "BAD_REQUEST", "a title over 140 characters is refused");
r = fn(`saveTask_(S, { title: "Book room", due: "2026-02-30" })`);
ok(r.err === "BAD_REQUEST", "a due date that isn't a real day is refused");
r = fn(`saveTask_(S, { title: "Book room", remind: "sometimes" })`);
ok(r.err === "BAD_REQUEST", "an unknown reminder rule is refused");

let t1 = run(`saveTask_(S, { title: "=Make poster", owner: "Kevin", due: "2099-12-05" })`);
ok(t1.ok && t1.task.department === "Marketing" && t1.task.status === "todo" && t1.task.title === "Make poster", "new task: department comes from Kevin's Team row, status To do, formula sign removed");
ok(t1.discordPosted === false && run(`__fetches.length`) === 0, "Discord not set up: nothing is fetched, the task is still saved");
ok(Array.isArray(t1.task.remind) && t1.task.remind.length === 0 && t1.task.reminders.length === 0 && t1.task.nextReminder === "", "no reminders by default (an empty list)");
const t2 = run(`saveTask_(S, { title: "Count cash box", owner: "Somebody New" }).task`);
ok(t2.department === "General" && t2.due === "", "owner not on the team: department General; no due date is fine");
ok(run(`TBL.Team.filter(function (r) { return r.name === "Somebody New"; }).length`) === 1 && run(`TBL.Team.filter(function (r) { return r.name === "Somebody New"; })[0].department`) === "" &&
  run(`__logs.some(function (l) { return l.action === "person.added" && l.details.source === "task"; })`), "owner not on the People list: added to it (department blank, since the task is General), and logged");
const t3 = run(`saveTask_(S, { title: "Sponsor email", owner: "Kevin", department: "External", link: "docs.google.com/x", notes: "- call first\\n\\n\\n\\nthen email" }).task`);
ok(t3.department === "External" && t3.link === "https://docs.google.com/x" && t3.notes === "- call first\n\nthen email", "a chosen department wins; link gets https://; notes keep a leading dash and line breaks");
ok(run(`__logs.filter(function (l) { return l.action === "task.created"; }).length`) === 3, "task.created logged for each new task");

r = fn(`saveTask_(S, { id: "${t1.task.id}", title: "Make big poster", owner: "Amy", due: "2099-12-06" })`);
ok(r.v && r.v.task.title === "Make big poster" && r.v.task.owner === "Amy" && r.v.task.department === "Marketing" && r.v.task.due === "2099-12-06" && r.v.discordPosted === false, "edit: title/owner/due change; the department stays as it was");
ok(Array.isArray(r.v.task.updates), "edit reply includes the updates list");
r = fn(`saveTask_(S, { id: "NOPE", title: "x" })`);
ok(r.err === "NOT_FOUND", "editing a task that doesn't exist: NOT_FOUND");
ok(run(`__logs.some(function (l) { return l.action === "task.updated" && l.target === "${t1.task.id}"; })`), "task.updated logged");
const rowOf = (id) => run(`TBL.Tasks.filter(function (t) { return t.id === "${id}"; })[0]`);
ok(rowOf(t1.task.id).ownerDiscordId === "222222222222222222" && rowOf(t2.id).ownerDiscordId === "", "ownerDiscordId comes from the Team list on portal saves (Amy after the edit; blank for someone not on it)");
r = fn(`saveTask_(S, { id: "${t1.task.id}", title: "Make big poster", status: "done" })`);
ok(r.v && r.v.task.status === "todo" && !r.v.task.doneAt && rowOf(t1.task.id).status === "todo", "edit: a status sent with an edit is ignored (only the status pill and updates change it)");

// ---- Status, updates, removing ---------------------------------------------------------------
r = run(`setTaskStatus_(S, "${t1.task.id}", "done")`);
ok(r.task.status === "done" && r.task.doneAt && r.task.updates[0].status === "done" && r.task.updates[0].text === "", "status Done: doneAt set, an update row records it");
r = run(`setTaskStatus_(S, "${t1.task.id}", "doing")`);
ok(r.task.status === "doing" && r.task.doneAt === "", "back to Doing: doneAt cleared");
ok(fn(`setTaskStatus_(S, "${t1.task.id}", "finished")`).err === "BAD_REQUEST", "an unknown status is refused");
ok(run(`__logs.filter(function (l) { return l.action === "task.status"; }).length`) === 2, "task.status logged");

r = run(`addTaskUpdate_(S, "${t1.task.id}", "=SUM(1) drafted", "blocked")`);
ok(r.update.text === "=SUM(1) drafted" && run(`TBL.TaskUpdates.filter(function (u) { return u.id === "${r.update.id}"; })[0].text`) === "'=SUM(1) drafted", "update text is stored safely (no formula) and shown as typed");
ok(r.task.status === "blocked" && r.update.status === "blocked" && r.update.source === "portal", "an update can also set the status");
ok(r.task.updates[0].id === r.update.id, "updates are newest first");
ok(fn(`addTaskUpdate_(S, "${t1.task.id}", "${"y".repeat(1001)}")`).err === "BAD_REQUEST", "an update over 1000 characters is refused");
ok(fn(`addTaskUpdate_(S, "${t1.task.id}", "  ")`).err === "BAD_REQUEST", "an empty update is refused");

run(`removeTask_(S, "${t2.id}")`);
let list = run(`listTasks_(S)`);
ok(list.ok && !list.tasks.some((t) => t.id === t2.id) && run(`TBL.Tasks.filter(function (t) { return t.id === "${t2.id}"; })[0].removedBy`) === "TEST Exec", "removed task: hidden from the list, kept in the sheet with who removed it");
ok(fn(`removeTask_(S, "${t2.id}")`).err === "NOT_FOUND", "removing it again: NOT_FOUND");
run(`var old = TBL.Tasks.filter(function (t) { return t.id === "${t3.id}"; })[0]; old.status = "done"; old.doneAt = new Date(Date.now() - 31 * 86400000).toISOString();`);
list = run(`listTasks_(S)`);
ok(!list.tasks.some((t) => t.id === t3.id), "a task done more than 30 days ago drops off the list");
ok(list.team.length === 4 && list.team.some((m) => m.name === "Old Exec" && m.active === false) && list.team.every((m) => typeof m.active === "boolean"), "team: every row, inactive ones too, with active as true/false");
ok(list.discord.ready === false && list.discord.posting === false && list.discord.reading === false && list.discord.error === "", "Discord not set up: discord.ready false, no error");
ok(list.tasks[0].updates && list.tasks[0].updates.length >= 1, "listTasks includes each task's updates");

// ---- Posting a new task to Discord (webhook) ----------------------------------------------------
run(`__discord("webhook")`);
let saved = run(`saveTask_(S, { title: "Hype post @everyone **now**", owner: "Amy", due: "2099-12-04" })`);
let post = run(`__fetches[0]`);
ok(saved.discordPosted === true && /\?wait=true$/.test(post.url), "webhook: posts with ?wait=true");
ok(post.body.allowed_mentions.parse.length === 0 && post.body.allowed_mentions.users.join() === "222222222222222222", "only the owner can be pinged (allowed_mentions parse [] and users = Amy)");
ok(post.body.content.indexOf("<@222222222222222222>") !== -1 && post.body.content.indexOf("due Fri, Dec 4") !== -1 && post.body.content.indexOf("Events") !== -1 && post.body.content.indexOf("\\*\\*now\\*\\*") !== -1,
  "message: owner mention, 'due Fri, Dec 4', department, title formatting escaped");
ok(run(`TBL.Tasks.filter(function (t) { return t.id === "${saved.task.id}"; })[0].discordMessageId`) === "300000000000001001", "the Discord message id is saved on the task");
run(`__fetches = []; __mode = "postfail"`);
saved = run(`saveTask_(S, { title: "Print tickets", owner: "Somebody New" })`);
ok(saved.ok && saved.discordPosted === false && run(`TBL.Tasks.some(function (t) { return t.title === "Print tickets"; })`), "Discord post fails: the task is still saved, discordPosted false");
ok(run(`__fetches[0].body.content`).indexOf("Somebody New") !== -1 && run(`__fetches[0].body.allowed_mentions.users.length`) === 0, "owner without a Discord ID: their name is written, nobody pinged");
run(`__fetches = []; __mode = "throw"`);
saved = run(`saveTask_(S, { title: "Order drinks" })`);
ok(saved.ok && saved.discordPosted === false, "Discord unreachable: the task is still saved");
run(`__mode = ""`);

// Remind on Discord
run(`__fetches = []; TBL.Tasks.forEach(function (t) { if (t.title === "Print tickets") { t.status = "blocked"; } if (t.title === "Make big poster") { t.due = "2000-01-01"; } });`);
r = run(`remindTasksOnDiscord_(S)`);
post = run(`__fetches[0]`);
ok(r.ok && r.posted && r.count === 2 && run(`__fetches.length`) === 1, "Remind on Discord: ONE message for the overdue and the blocked task");
ok(/overdue \d+d/.test(post.body.content) && post.body.content.indexOf("⛔ blocked") !== -1 && post.body.allowed_mentions.parse.length === 0 && post.body.allowed_mentions.users.join() === "222222222222222222", "it says overdue/blocked and pings only the owners");

// ---- Reading replies (the Tasks tab) -----------------------------------------------------------
run(`__discord("bot"); P.setProperty("DISCORD_LAST_SEEN", "200000000000000999"); P.setProperty("DISCORD_BOT_ID", BOT);`);
const hype = run(`TBL.Tasks.filter(function (t) { return t.title.indexOf("Hype") === 0; })[0]`);
run(`__inbox = [
  __msg(1, { content: "started the draft", message_reference: { message_id: "${hype.discordMessageId}" } }),
  __msg(2, { content: "ok cool", author: { id: "333333333333333333", username: "randomguy" } }),
  __msg(3, { content: "it's done ✅", author: { id: AMY, username: "amy" }, message_reference: { message_id: "20000000000000" + 1001 } }),
  __msg(4, { content: "beep done", author: { id: "444444444444444444", username: "otherbot", bot: true }, message_reference: { message_id: "${hype.discordMessageId}" } }),
  __msg(5, { content: "webhook done", webhook_id: "1", message_reference: { message_id: "${hype.discordMessageId}" } }),
  __msg(6, { content: "done", message_reference: { message_id: "123456789012345678" } })
];`);
list = run(`listTasks_(S)`);
let hypeView = list.tasks.find((t) => t.id === hype.id);
ok(list.discord.ready && list.discord.synced === 2 && list.discord.error === "", "sync: 2 replies counted (the reply and the reply-to-a-reply)");
ok(hypeView.updates.length === 2 && hypeView.updates.every((u) => u.source === "discord"), "bots, webhooks, chat and replies to other messages are skipped");
ok(hypeView.updates[1].by === "Kevin" && hypeView.updates[0].by === "Amy", "Discord authors show as their Team names");
ok(hypeView.status === "done" && hypeView.doneAt && hypeView.updates[1].status === "doing" && hypeView.updates[0].status === "done", "'started…' moved To do → Doing; 'done ✅' → Done");
ok(run(`P.getProperty("DISCORD_LAST_SEEN")`) === "200000000000001006", "DISCORD_LAST_SEEN = newest message read");
const get = run(`__fetches.filter(function (f) { return f.opts.method === "get" && f.url.indexOf("/messages") !== -1; })[0]`);
ok(/channels\/555555555555555555\/messages\?limit=100&after=200000000000000999$/.test(get.url) && get.opts.headers.Authorization === "Bot SECRETTOKEN" && get.opts.muteHttpExceptions, "reads with ?limit=100&after=lastSeen and the bot token header");
list = run(`listTasks_(S)`);
ok(list.discord.synced === 0 && run(`__fetches.filter(function (f) { return f.opts.method === "get" && f.url.indexOf("/messages") !== -1; }).length`) === 1, "a second open within 20 s doesn't read Discord again");
run(`__discord("bot"); P.deleteProperty("DISCORD_LAST_SEEN");`);   // read the same messages again
list = run(`listTasks_(S)`);
ok(list.tasks.find((t) => t.id === hype.id).updates.length === 2, "reading the same replies again adds nothing (deduped by message id)");
run(`__inbox.push(__msg(7, { content: "waiting on the printer", author: { id: "777777777777777777", username: "guest7", global_name: "Guesty" }, message_reference: { message_id: "20000000000000" + 1003 } }));`);
run(`CacheService.getScriptCache().remove("tasks_discord_sync")`);
hypeView = run(`listTasks_(S)`).tasks.find((t) => t.id === hype.id);
ok(hypeView.status === "blocked" && hypeView.updates[0].by === "Guesty" && !hypeView.doneAt, "'waiting on' → Blocked (doneAt cleared); someone not on the team shows by their Discord name");
run(`__inbox.push(__msg(8, { content: "", message_reference: { message_id: "${hype.discordMessageId}" } })); CacheService.getScriptCache().remove("tasks_discord_sync")`);
ok(/Message Content Intent/.test(run(`listTasks_(S)`).discord.error), "replies arriving without text: plain-English hint about Message Content Intent");
run(`P.deleteProperty("NEXT_TASK_REMINDER"); __inbox.push(__msg(9, { content: "remind me on 2099-12-01", message_reference: { message_id: "${hype.discordMessageId}" } })); CacheService.getScriptCache().remove("tasks_discord_sync")`);
run(`listTasks_(S)`);
ok(run(`P.getProperty("NEXT_TASK_REMINDER")`) === run(`new Date(edmAt_("2099-12-01", 9, 0)).toISOString()`), "a 'remind me …' reply read by the Tasks tab updates NEXT_TASK_REMINDER");
run(`TBL.Tasks.forEach(function (t) { if (t.id === "${hype.id}") { t.remind = []; t.remindSent = []; } }); __refreshReal();`);

// Errors: list still returns
run(`__discord("bot"); __mode = "429"`);
list = run(`listTasks_(S)`);
ok(list.ok && list.tasks.length > 0 && /slow down/.test(list.discord.error), "Discord 429: list still returns, discord.error says so");
run(`__discord("bot"); __mode = "throw"`);
list = run(`listTasks_(S)`);
ok(list.ok && /Couldn't reach Discord/.test(list.discord.error) && list.discord.error.indexOf("SECRET") === -1 && list.discord.error.indexOf("https://") === -1, "Discord unreachable: plain error, no address or secret in it");
run(`__discord("webhook"); P.setProperty("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/1/SECRETWEBHOOK"); __mode = "throw"`);
r = run(`discordSend_("hi", [])`);
ok(!r.ok && r.error.indexOf("SECRETWEBHOOK") === -1, "a failed webhook post never repeats the webhook address");
run(`__mode = ""`);
ok(JSON.stringify(run(`listTasks_(S)`)).indexOf("SECRET") === -1, "no secret ever appears in listTasks");

// Posting as the bot when it's set up
run(`__discord("bot")`);
saved = run(`saveTask_(S, { title: "Bot post", owner: "Kevin" })`);
post = run(`__fetches.filter(function (f) { return f.opts.method === "post"; })[0]`);
ok(saved.discordPosted && /channels\/555555555555555555\/messages$/.test(post.url) && post.opts.headers.Authorization === "Bot SECRETTOKEN" && post.body.allowed_mentions.parse.length === 0 && post.body.allowed_mentions.users.join() === "111111111111111111",
  "with the bot set up, new tasks are posted by the bot (same mention rules)");

// ---- parseTaskMessage_ -----------------------------------------------------------------------
// Fixed "now": Monday Nov 23 2026, 10:00 AM Calgary (17:00 UTC).
const NOW = "Date.parse('2026-11-23T17:00:00Z')";
const team = `[{ name: "Kevin", discordId: KEV, department: "Marketing" }, { name: "Amy Lee", discordId: AMY }, { name: "Noid", discordId: "" }]`;
const P_ = (text) => run(`parseTaskMessage_(${JSON.stringify(text)}, ${NOW}, ${team}, BOT)`);
const cases = [
  ["<@900000000000000001> make reel for badminton by friday", { title: "Make reel for badminton", due: "2026-11-27", remind: [], remindNeedsDue: false, ownerDiscordId: "" }],
  ["<@!900000000000000001> make reel by fri", { title: "Make reel", due: "2026-11-27" }],
  ["@taskbot post recap by monday", { title: "Post recap", due: "2026-11-30" }],                       // today is Monday: the next one
  ["<@900000000000000001> book room due today", { title: "Book room", due: "2026-11-23" }],
  ["<@900000000000000001> send invoice by tonight", { title: "Send invoice", due: "2026-11-23" }],
  ["<@900000000000000001> buy cups by tomorrow", { title: "Buy cups", due: "2026-11-24" }],
  ["<@900000000000000001> buy cups by tmr", { due: "2026-11-24" }],
  ["<@900000000000000001> buy cups by tmrw", { due: "2026-11-24" }],
  ["<@900000000000000001> buy cups by wed", { due: "2026-11-25" }],
  ["<@900000000000000001> buy cups before thurs", { due: "2026-11-26" }],
  ["<@900000000000000001> buy cups on sat", { due: "2026-11-28" }],
  ["<@900000000000000001> buy cups by sunday", { due: "2026-11-29" }],
  ["<@900000000000000001> plan social by next friday", { title: "Plan social", due: "2026-12-04" }],
  ["<@900000000000000001> plan social by next mon", { due: "2026-11-30" }],
  ["<@900000000000000001> plan social by next week", { due: "2026-11-30" }],
  ["<@900000000000000001> plan social by end of week", { due: "2026-11-27" }],
  ["<@900000000000000001> plan social by end of the week", { due: "2026-11-27" }],
  ["<@900000000000000001> plan social by eow", { due: "2026-11-27" }],
  ["<@900000000000000001> plan social in 3 days", { title: "Plan social", due: "2026-11-26" }],
  ["<@900000000000000001> plan social due in 2 weeks", { due: "2026-12-07" }],
  ["<@900000000000000001> plan social in a week", { due: "2026-11-30" }],
  ["<@900000000000000001> order shirts by dec 5", { title: "Order shirts", due: "2026-12-05" }],
  ["<@900000000000000001> order shirts by december 5th", { due: "2026-12-05" }],
  ["<@900000000000000001> order shirts by 5 dec", { due: "2026-12-05" }],
  ["<@900000000000000001> order shirts by 12/5", { due: "2026-12-05" }],
  ["<@900000000000000001> order shirts by 1/15", { due: "2027-01-15" }],                              // already passed this year: next year
  ["<@900000000000000001> order shirts by nov 1", { due: "2027-11-01" }],
  ["<@900000000000000001> order shirts by 2026-12-24", { due: "2026-12-24" }],
  ["<@900000000000000001> order shirts friday", { title: "Order shirts", due: "2026-11-27" }],        // date at the very end, no "by"
  ["<@900000000000000001> order shirts dec 5.", { title: "Order shirts", due: "2026-12-05" }],
  ["<@900000000000000001> order shirts this friday", { due: "2026-11-27" }],
  ["<@900000000000000001> picnic in the sun", { title: "Picnic in the sun", due: "" }],              // "sun" alone at the end isn't a date
  ["<@900000000000000001> make reel", { title: "Make reel", due: "" }],
  ["<@900000000000000001> <@111111111111111111> design poster by wed", { title: "Design poster", due: "2026-11-25", ownerDiscordId: "111111111111111111" }],
  ["<@900000000000000001> book room for <@222222222222222222> on thursday", { title: "Book room", due: "2026-11-26", ownerDiscordId: "222222222222222222" }],
  ["<@900000000000000001> sync with <@222222222222222222> and <@111111111111111111>", { title: "Sync with and @Kevin", ownerDiscordId: "222222222222222222" }],
  ["<@900000000000000001> @Amy Lee print flyers by fri", { title: "Print flyers", ownerDiscordId: "222222222222222222", ownerName: "Amy Lee" }],
  ["<@900000000000000001> for @noid print flyers", { title: "Print flyers", ownerDiscordId: "", ownerName: "Noid" }],
  ["<@900000000000000001> <@&123456> tell everyone", { title: "Tell everyone" }],
  ["<@900000000000000001> make reel by friday remind me halfway", { title: "Make reel", due: "2026-11-27", remind: [{ n: 2, unit: "days", at: "09:00" }] }],
  ["<@900000000000000001> make reel by friday, remind them the day before", { title: "Make reel", due: "2026-11-27", remind: [{ n: 1, unit: "days", at: "09:00" }] }],
  ["<@900000000000000001> make reel by friday remind day before", { remind: [{ n: 1, unit: "days", at: "09:00" }], due: "2026-11-27" }],
  ["<@900000000000000001> make reel by friday remind both", { remind: [{ n: 2, unit: "days", at: "09:00" }, { n: 1, unit: "days", at: "09:00" }] }],
  ["<@900000000000000001> make reel by friday remind me halfway and the day before", { title: "Make reel", remind: [{ n: 2, unit: "days", at: "09:00" }, { n: 1, unit: "days", at: "09:00" }] }],
  ["<@900000000000000001> make reel by friday remind me on wed", { title: "Make reel", due: "2026-11-27", remind: [{ n: 2, unit: "days", at: "09:00" }] }],
  ["<@900000000000000001> remind me thursday make reel by dec 5", { title: "Make reel", due: "2026-12-05", remind: [{ n: 9, unit: "days", at: "09:00" }] }],
  ["<@900000000000000001> make reel remind me dec 3", { title: "Make reel", due: "", remind: [], remindNeedsDue: true }],          // no due date: can't work out a day
  ["<@900000000000000001> make reel remind me 1 day before", { title: "Make reel", due: "", remind: [{ n: 1, unit: "days", at: "09:00" }], remindNeedsDue: true }],
  ["<@900000000000000001> make reel by dec 5 remind me 2 days before", { title: "Make reel", due: "2026-12-05", remind: [{ n: 2, unit: "days", at: "09:00" }], remindNeedsDue: false }],
  ["<@900000000000000001> make reel by dec 5 remind me 1 week before", { title: "Make reel", due: "2026-12-05", remind: [{ n: 1, unit: "weeks", at: "09:00" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me a week before", { remind: [{ n: 1, unit: "weeks", at: "09:00" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me two days early", { remind: [{ n: 2, unit: "days", at: "09:00" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me 3 days before at 6pm", { title: "Make reel", due: "2026-12-05", remind: [{ n: 3, unit: "days", at: "18:00" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me 3 days before at 18:00", { title: "Make reel", remind: [{ n: 3, unit: "days", at: "18:00" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me 3 days before at 6:30 p.m.", { title: "Make reel", remind: [{ n: 3, unit: "days", at: "18:30" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me on the day", { title: "Make reel", due: "2026-12-05", remind: [{ n: 0, unit: "days", at: "09:00" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me on the day at noon", { title: "Make reel", remind: [{ n: 0, unit: "days", at: "12:00" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me the day before at 9pm", { title: "Make reel", remind: [{ n: 1, unit: "days", at: "21:00" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me on wed at 5pm", { title: "Make reel", remind: [{ n: 10, unit: "days", at: "17:00" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me 1 week before and remind me on the day at 5pm", { title: "Make reel", due: "2026-12-05", remind: [{ n: 1, unit: "weeks", at: "09:00" }, { n: 0, unit: "days", at: "17:00" }] }],
  ["<@900000000000000001> remind me 2 days before make reel by dec 5, remind me the day before", { title: "Make reel", due: "2026-12-05", remind: [{ n: 2, unit: "days", at: "09:00" }, { n: 1, unit: "days", at: "09:00" }] }],
  ["<@900000000000000001> make reel by dec 5 remind me dec 10", { title: "Make reel", due: "2026-12-05", remind: [] }],              // after the due date: left out
  ["<@900000000000000001> make reel by friday remind me 2 days before remind me 2 days before", { remind: [{ n: 2, unit: "days", at: "09:00" }] }],          // the same one twice counts once
  ["<@900000000000000001> to email sponsors.", { title: "Email sponsors" }],
  ["<@900000000000000001> please email sponsors!!", { title: "Email sponsors" }],
  ["<@900000000000000001> by friday", { title: "", due: "2026-11-27" }],
  ["<@900000000000000001>", { title: "" }]
];
cases.forEach(([text, want]) => {
  const got = P_(text);
  const bad = Object.keys(want).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
  ok(!bad.length, `parse "${text}" → ${JSON.stringify(want)}` + (bad.length ? "  GOT " + JSON.stringify(got) : ""));
});
// What a reply does to a task that is already Doing ("" = leave it)
[["done!", "done"], ["all done ✅", "done"], ["Done.", "done"], ["<@900000000000000001> done", "done"], ["finished the poster", "done"],
  ["almost done", ""], ["not done yet", ""], ["should be done by friday", ""], ["it'll be done by friday I think", ""],
  ["I finished the first draft but still need to print 200 copies", ""], ["blocked on venue reply", "blocked"], ["waiting on the printer", "blocked"],
  ["stuck ⛔", "blocked"], ["no longer blocked", ""], ["not stuck anymore", ""]
].forEach(([text, want]) => ok(run(`discordReplyStatus_(${JSON.stringify(text)}, "doing")`) === want, `reply "${text}" → ${want || "status unchanged"}`));
ok(run(`discordReplyStatus_("almost done", "todo")`) === "doing", "'almost done' on a task nobody started moves it to Doing, not Done");
ok(run(`parseTaskMessage_("x by friday", Date.parse("2026-11-27T17:00:00Z"), [], BOT).due`) === "2026-12-04", "'by friday' said on a Friday means next Friday");
ok(run(`parseTaskMessage_("x by friday", Date.parse("2026-11-28T05:00:00Z"), [], BOT).due`) === "2026-12-04", "late Friday night in Calgary (already Saturday in UTC) still counts as Friday");
ok(run(`new Date(edmAt_("2026-07-01", 9, 0)).toISOString()`) === "2026-07-01T15:00:00.000Z" && run(`new Date(edmAt_("2026-12-01", 9, 0)).toISOString()`) === "2026-12-01T16:00:00.000Z", "9:00 AM Calgary is right in summer and winter time");
ok(run(`taskWhenText_(edmAt_("2026-12-03", 9, 0))`) === "Thu, Dec 3 9:00 AM", "reminder time reads like 'Thu, Dec 3 9:00 AM'");

// ---- Reminder rules (like Google Calendar: n days/weeks before the due date, at a time) -----------------
const SAME = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const RM = (n, unit, at) => ({ n: n, unit: unit || "days", at: at || "09:00" });
const RS = (task) => run(`taskReminderSchedule_(${JSON.stringify(task)})`);
r = RS({ remind: [RM(1), RM(1, "weeks", "18:30"), RM(0, "days", "07:15")], due: "2026-12-05" });
ok(r.length === 3 && r[0].key === "2026-12-05|1days@09:00" && new Date(r[0].at).toISOString() === "2026-12-04T16:00:00.000Z" &&
  new Date(r[1].at).toISOString() === "2026-11-29T01:30:00.000Z" && new Date(r[2].at).toISOString() === "2026-12-05T14:15:00.000Z",
  "each reminder: n days/weeks before the due date at its time (Calgary); its key holds the due date and the reminder");
ok(RS({ remind: [RM(1)], due: "" }).length === 0, "no due date: no reminder goes out");
ok(run(`taskPendingReminders_({ remind: [{ n: 1, unit: "days", at: "09:00" }], due: "2026-12-05", status: "done" }).length`) === 0, "done task: no reminder");

// Older rows hold a word or a day: read as the same kind of list
const LIST = (task) => run(`taskReminderItems_(${JSON.stringify(task)})`);
ok(SAME(LIST({ remind: "daybefore", due: "2026-12-05" }), [RM(1)]), "old 'daybefore' → 1 day before at 9:00");
ok(SAME(LIST({ remind: "halfway", due: "2026-12-05", createdAt: "2026-11-25T16:00:00.000Z" }), [RM(5)]), "old 'halfway' → half the days from when it was made (10 days → 5 before)");
ok(SAME(LIST({ remind: "both", due: "2026-12-05", createdAt: "2026-11-24T16:00:00.000Z" }), [RM(5), RM(1)]), "old 'both' → halfway (11 days → 5) and the day before");
ok(SAME(LIST({ remind: "2026-12-01", due: "2026-12-05" }), [RM(4)]), "old chosen day → the days between it and the due date, at 9:00");
ok(LIST({ remind: "halfway", due: "" }).length === 0 && LIST({ remind: "2026-12-01", due: "" }).length === 0 && LIST({ remind: "" }).length === 0, "old words without a due date (or blank): none");
ok(run(`taskPendingReminders_({ remind: "daybefore", due: "2099-12-05", remindSent: ["daybefore@2099-12-05"] }).length`) === 0 &&
  run(`taskPendingReminders_({ remind: "daybefore", due: "2099-12-05", remindSent: [] }).length`) === 1, "an old reminder already sent (under its old key) isn't sent again");
ok(run(`fromCell_("remind", "daybefore")`) === "daybefore" && SAME(run(`fromCell_("remind", '[{"n":2,"unit":"days","at":"18:00"}]')`), [RM(2, "days", "18:00")]) && SAME(run(`fromCell_("remind", "")`), []),
  "the sheet's remind cell: an old word stays readable, a list comes back as a list, blank is none");

// Saving reminders
saved = run(`saveTask_(S, { title: "Remind me task", owner: "Kevin", due: "2099-12-05", remind: [{ n: 1, unit: "days", at: "09:00" }, { n: "2", unit: "week", at: "6:05" }, { n: 1, unit: "days", at: "09:00" }] })`);
ok(SAME(saved.task.remind, [RM(1), RM(2, "weeks", "06:05")]), "saveTask: several reminders, tidied (\"2\" → 2, week → weeks, 6:05 → 06:05); the same one twice is kept once");
ok(saved.task.reminders.length === 2 && saved.task.reminders[0].when === "2099-12-04T09:00" && saved.task.reminders[1].when === "2099-11-21T06:05" && saved.task.reminders.every((x) => x.sent === false) &&
  SAME(Object.keys(saved.task.reminders[0]).sort(), ["at", "n", "sent", "unit", "when"]), "reminders: [{ n, unit, at, when (Calgary time), sent }]");
ok(saved.task.nextReminder === "2099-11-21T06:05", "nextReminder = the soonest one");
ok(run(`P.getProperty("NEXT_TASK_REMINDER")`) === run(`new Date(edmAt_("2099-11-21", 6, 5)).toISOString()`), "NEXT_TASK_REMINDER is kept up to date after a save");
[[RM(61)], [RM(1, "months")], [RM(1, "days", "25:00")], [{ n: -1, unit: "days" }], [{ n: "", unit: "days" }], [{ n: 1.5, unit: "days" }], [null], { n: 1 },
  [0, 1, 2, 3, 4, 5].map((n) => RM(n))].forEach((bad) => {
  ok(fn(`saveTask_(S, { title: "Bad reminder", due: "2099-12-05", remind: ${JSON.stringify(bad)} })`).err === "BAD_REQUEST", "refused: reminders " + JSON.stringify(bad).slice(0, 70));
});
ok(fn(`saveTask_(S, { title: "Five is fine", due: "2099-12-05", remind: ${JSON.stringify([0, 1, 2, 3, 4].map((n) => RM(n)))} })`).v.task.reminders.length === 5, "up to 5 reminders are fine");
r = run(`saveTask_(S, { title: "No date yet", remind: [{ n: 1, unit: "days", at: "09:00" }] }).task`);
ok(r.remind.length === 1 && r.nextReminder === "" && r.reminders[0].when === "" && r.reminders[0].sent === false, "reminders without a due date: kept, but they don't go out (nextReminder blank)");
r = run(`saveTask_(S, { id: "${r.id}", remind: "daybefore", due: "2099-12-05" }).task`);
ok(SAME(r.remind, [RM(1)]) && r.nextReminder === "2099-12-04T09:00", "an older page's word ('daybefore') is still accepted and read as the list");

// Changing the due date re-arms the reminders (their keys hold the due date)
const rid = saved.task.id;
const VIEW = (id) => run(`taskView_(TBL.Tasks.filter(function (t) { return t.id === "${id}"; })[0], [])`);
run(`TBL.Tasks.forEach(function (t) { if (t.id === "${rid}") t.remindSent = ["2099-12-05|1days@09:00"]; })`);
r = VIEW(rid);
ok(r.reminders[0].sent === true && r.reminders[1].sent === false && r.nextReminder === "2099-11-21T06:05", "a sent reminder shows sent: true");
r = run(`saveTask_(S, { id: "${rid}", due: "2099-12-12" }).task`);
ok(r.reminders.every((x) => !x.sent) && r.reminders[0].when === "2099-12-11T09:00" && run(`TBL.Tasks.filter(function (t) { return t.id === "${rid}"; })[0].remindSent.length`) === 0,
  "moving the due date re-arms the reminders");
r = run(`saveTask_(S, { id: "${rid}", due: "2099-12-05" }).task`);
ok(r.reminders.every((x) => !x.sent) && r.nextReminder === "2099-11-21T06:05", "…and moving it back re-arms them again");
r = run(`saveTask_(S, { id: "${rid}", title: "Remind me task (renamed)" }).task`);
ok(r.reminders.length === 2 && r.reminders.every((x) => !x.sent), "editing something else leaves the reminders alone");

// Saving never sends a burst of old reminders: ones in the past are marked sent, except one from the last 10 minutes
run(`var __p5 = edmParts_(Date.now() - 5 * 60000), __hm5 = ("0" + __p5.h).slice(-2) + ":" + ("0" + __p5.min).slice(-2);`);
const p5 = run(`({ ymd: __p5.ymd, hm: __hm5 })`);
r = run(`saveTask_(S, { title: "Burst test", owner: "Kevin", due: __p5.ymd, remind: [{ n: 2, unit: "days", at: "09:00" }, { n: 1, unit: "weeks", at: "09:00" }, { n: 1, unit: "days", at: "23:59" }, { n: 0, unit: "days", at: __hm5 }] }).task`);
ok(r.reminders.filter((x) => x.sent).length === 3 && r.reminders[3].sent === false && r.nextReminder === p5.ymd + "T" + p5.hm, "saving with reminders already in the past: those are marked sent; one from 5 minutes ago still goes out");
run(`__fetches = []; taskBotTick()`);
ok(run(`__fetches.filter(function (f) { return f.body && /^⏰ Reminder/.test(f.body.content); }).length`) === 1 &&
  run(`__fetches.filter(function (f) { return f.body && /^⏰ Reminder/.test(f.body.content); })[0].body.content`).indexOf("Burst test") !== -1, "…and the timer then sends just that one, not a burst");
run(`__fetches = []; P.setProperty("NEXT_TASK_REMINDER", new Date(Date.now() - 1000).toISOString()); taskBotTick()`);
ok(run(`__fetches.filter(function (f) { return f.body && /^⏰ Reminder/.test(f.body.content); }).length`) === 0, "…once");

// ---- @taskbot timer --------------------------------------------------------------------------
run(`__discord("bot"); P.setProperty("DISCORD_LAST_SEEN", "200000000000002000"); P.setProperty("DISCORD_BOT_ID", BOT); P.deleteProperty("NEXT_TASK_REMINDER");
  TBL.Tasks.forEach(function (t) { t.remind = []; t.remindSent = []; });`);
run(`__inbox = [
  __msg(1001, { content: "<@" + BOT + "> make reel for badminton by friday remind me on the day at 11:59pm", mentions: [{ id: BOT, username: "taskbot", bot: true }] }),
  __msg(1002, { content: "<@" + BOT + "> old one by friday", mentions: [{ id: BOT }], timestamp: new Date(Date.now() - 3 * 86400000).toISOString() }),
  __msg(1003, { content: "<@" + BOT + "> hi from a bot", author: { id: "444444444444444444", username: "otherbot", bot: true }, mentions: [{ id: BOT }] }),
  __msg(1004, { content: "<@" + BOT + "> by friday", author: { id: AMY, username: "amy" }, mentions: [{ id: BOT }] }),
  __msg(1005, { content: "<@" + BOT + "> <@" + AMY + "> photo dump", mentions: [{ id: BOT }, { id: AMY, username: "amy", global_name: "Amy L" }] })
];`);
const before = run(`TBL.Tasks.length`);
run(`__reads = 0; taskBotTick()`);
const made = run(`TBL.Tasks.filter(function (t) { return /Discord/.test(t.createdBy); })`);
ok(made.length === 2 && run(`TBL.Tasks.length`) === before + 2, "tick: 2 tasks made (old message, bot message and the empty one are not)");
const reel = made.find((t) => t.title === "Make reel for badminton");
ok(reel && new Date(reel.due + "T12:00:00Z").getUTCDay() === 5 && SAME(reel.remind, [RM(0, "days", "23:59")]) && reel.owner === "Kevin" && reel.department === "Marketing" && reel.discordMessageId === "200000000000002001",
  "the reel task: due Friday, reminder on the day at 11:59 PM, owner = the author (Kevin, Marketing), linked to the message");
const photo = made.find((t) => t.title === "Photo dump");
ok(photo && photo.owner === "Amy" && photo.due === "", "@mentioning someone makes them the owner");
ok(reel.ownerDiscordId === "111111111111111111" && photo.ownerDiscordId === "222222222222222222", "Discord-made tasks save the owner's Discord ID (ownerDiscordId)");
const posts = run(`__fetches.filter(function (f) { return f.opts.method === "post"; })`);
const confirm = posts.find((p) => p.body.message_reference && p.body.message_reference.message_id === "200000000000002001");
ok(confirm && /^✅ Got it: \*\*Make reel for badminton\*\* · <@111111111111111111> · due Fri, \w{3} \d+ · reminder Fri, \w{3} \d+ 11:59 PM$/.test(confirm.body.content), "the bot confirms as a reply: title, owner, due, reminder time");
ok(confirm.body.allowed_mentions.parse.length === 0 && confirm.body.allowed_mentions.users.join() === "111111111111111111" && confirm.body.allowed_mentions.replied_user === false, "the confirmation can only ping the owner");
ok(posts.some((p) => p.body.message_reference && p.body.message_reference.message_id === "200000000000002004" && /What's the task\?/.test(p.body.content)), "a message with no task in it gets 'What's the task?'");
ok(posts.some((p) => p.body.message_reference && p.body.message_reference.message_id === "200000000000002005" && /no reminder — say 'remind halfway'/.test(p.body.content)), "no reminder asked: the confirmation says how to add one");
ok(run(`TBL.Tasks.filter(function (t) { return t.title === "Make reel for badminton"; })[0].discordRefs.length`) === 1, "the confirmation's id is kept in discordRefs");
ok(run(`P.getProperty("DISCORD_LAST_SEEN")`) === "200000000000002005" && run(`P.getProperty("NEXT_TASK_REMINDER")`), "lastSeen moved on; the reminder time is remembered");

// Replies to the bot's confirmation work, including "remind me …"
const confirmId = run(`TBL.Tasks.filter(function (t) { return t.title === "Photo dump"; })[0].discordRefs[0]`);
run(`TBL.Tasks.forEach(function (t) { if (t.title === "Photo dump") { var p = edmParts_(Date.now()); t.due = ymdAdd_(tbResolveDate_("dec 3", p.ymd, p.dow), 2); } });`);   // due Dec 5
run(`__fetches = []; __inbox.push(__msg(1006, { content: "<@" + BOT + "> remind me on dec 3", author: { id: AMY, username: "amy" }, mentions: [{ id: BOT }], message_reference: { message_id: "${confirmId}" } }));
     __inbox.push(__msg(1007, { content: "on it", author: { id: AMY, username: "amy" }, message_reference: { message_id: "${confirmId}" } }));`);
run(`taskBotTick()`);
const photoNow = run(`TBL.Tasks.filter(function (t) { return t.title === "Photo dump"; })[0]`);
ok(SAME(photoNow.remind, [RM(2)]) && photoNow.status === "doing", "reply 'remind me on dec 3' (due Dec 5) adds a reminder 2 days before; 'on it' moves it to Doing");
ok(run(`__fetches.some(function (f) { return f.body && /^👍 Reminder set for Thu, Dec 3 9:00 AM$/.test(f.body.content); })`), "the bot answers '👍 Reminder set for …'");
ok(run(`TBL.Tasks.filter(function (t) { return /Discord/.test(t.createdBy); }).length`) === 2, "a reply that mentions the bot doesn't make a new task");

// Cheap path: nothing new, no reminder due → no sheet reads, one Discord call
run(`__fetches = []; __reads = 0; taskBotTick()`);
ok(run(`__reads`) === 0 && run(`__fetches.length`) === 1, "tick with nothing new and no reminder due: no sheet reads, one Discord read");
run(`__inbox.push(__msg(1008, { content: "lunch anyone?" })); __inbox.push(__msg(1009, { content: "beep", author: { id: BOT, bot: true } })); __fetches = []; __reads = 0; taskBotTick()`);
ok(run(`__reads`) === 0 && run(`P.getProperty("DISCORD_LAST_SEEN")`) === "200000000000002009", "plain chat and the bot's own messages: still no sheet reads, lastSeen moves on");

// The bot's own role ("@taskbot" picked as a role) counts as mentioning the bot; another role doesn't
const hasTask = (title) => run(`TBL.Tasks.some(function (t) { return t.title === ${JSON.stringify(title)}; })`);
run(`P.deleteProperty("DISCORD_BOT_ROLES"); __fetches = [];
  __inbox.push(__msg(1010, { content: "<@&" + ROLE + "> print the zine", mention_roles: [ROLE] }));
  __inbox.push(__msg(1011, { content: "<@&" + OTHER_ROLE + "> anyone free", mention_roles: [OTHER_ROLE] }));
  __inbox.push(__msg(1012, { content: "<@" + BOT + "> call the venue for <@777777777777777777>", mentions: [{ id: BOT }, { id: "777777777777777777", username: "guest7", global_name: "Guesty" }] }));
  taskBotTick();`);
ok(hasTask("Print the zine") && !hasTask("Anyone free") && run(`P.getProperty("DISCORD_BOT_ROLES")`) === "800000000000000001", "a message to the bot's role makes a task; another role doesn't; the bot's role is remembered");
const venue = run(`TBL.Tasks.filter(function (t) { return t.title === "Call the venue"; })[0]`);
ok(venue && venue.owner === "Guesty" && venue.ownerDiscordId === "777777777777777777", "a task for someone not on the Team list keeps their Discord ID");
run(`__fetches = []; __inbox.push(__msg(1013, { content: "<@&" + ROLE + "> second zine", mention_roles: [ROLE] })); taskBotTick()`);
ok(hasTask("Second zine") && !run(`__fetches.some(function (f) { return /\\/guilds\\/|\\/channels\\/\\d+$/.test(f.url); })`), "the bot's role is asked about once, then remembered");
run(`TBL.Tasks.forEach(function (t) { if (t.title === "Call the venue") t.status = "blocked"; }); __fetches = []; remindTasksOnDiscord_(S)`);
ok(run(`__fetches[0].body.allowed_mentions.users`).indexOf("777777777777777777") !== -1 && run(`__fetches[0].body.content`).indexOf("<@777777777777777777>") !== -1, "Remind on Discord pings the saved ownerDiscordId (someone not on the Team list)");

// Who the bot is can't be found out: the message is read again next time, not skipped
run(`P.deleteProperty("DISCORD_BOT_ID"); P.deleteProperty("DISCORD_BOT_NAME"); __mode = "nobot"; __fetches = [];
  __inbox.push(__msg(1014, { content: "<@" + BOT + "> order pizza", mentions: [{ id: BOT }] })); taskBotTick();`);
ok(!hasTask("Order pizza") && run(`P.getProperty("DISCORD_LAST_SEEN")`) === "200000000000002013", "bot id unknown: DISCORD_LAST_SEEN isn't moved past a message that mentions someone");
run(`__mode = ""; taskBotTick()`);
ok(hasTask("Order pizza") && run(`P.getProperty("DISCORD_LAST_SEEN")`) === "200000000000002014", "…and it becomes a task once the bot id is known");

// Only normal messages and replies: a join notice and a forwarded message are ignored
run(`__inbox.push(__msg(1015, { type: 7, content: "<@" + BOT + "> joined the server", mentions: [{ id: BOT }] }));
  __inbox.push(__msg(1016, { type: 0, content: "done", message_reference: { type: 1, message_id: "200000000000002001" } }));
  __inbox.push(__msg(1017, { type: 19, content: "on it", message_reference: { type: 0, message_id: "200000000000002001" } }));
  taskBotTick();`);
ok(!hasTask("Joined the server") && run(`TBL.TaskUpdates.filter(function (u) { return u.discordMessageId === "200000000000002016"; }).length`) === 0 &&
  run(`TBL.TaskUpdates.filter(function (u) { return u.discordMessageId === "200000000000002017"; }).length`) === 1, "a join notice and a forwarded message are ignored; a real reply (type 19) still counts");

// Reminders asked for on Discord without a due date
run(`__fetches = []; __inbox.push(__msg(1018, { content: "<@" + BOT + "> sort the photos remind me 1 day before", mentions: [{ id: BOT }] })); taskBotTick();`);
const sortTask = run(`TBL.Tasks.filter(function (t) { return t.title === "Sort the photos"; })[0]`);
ok(sortTask && sortTask.due === "" && SAME(sortTask.remind, [RM(1)]), "'remind me 1 day before' with no due date: the task keeps the reminder (it goes out once a due date is set)");
ok(run(`__fetches.some(function (f) { return f.body && f.body.message_reference && f.body.message_reference.message_id === "200000000000002018" && /reminders need a due date/.test(f.body.content); })`),
  "…and the bot's confirmation says reminders need a due date");
run(`__fetches = []; __inbox.push(__msg(1019, { content: "remind me on friday", message_reference: { message_id: "200000000000002018" } })); taskBotTick();`);
ok(run(`__fetches.some(function (f) { return f.body && /^🤔 This task has no due date/.test(f.body.content); })`) && SAME(run(`TBL.Tasks.filter(function (t) { return t.title === "Sort the photos"; })[0].remind`), [RM(1)]),
  "a 'remind me on friday' reply to a task with no due date: the bot says it needs a due date");
run(`TBL.Tasks.forEach(function (t) { if (t.title === "Sort the photos") t.due = ymdAdd_(edmParts_(Date.now()).ymd, 10); });
  __fetches = []; __inbox.push(__msg(1020, { content: "remind me 3 days before at 6pm and remind me on the day", message_reference: { message_id: "200000000000002018" } })); taskBotTick();`);
ok(SAME(run(`TBL.Tasks.filter(function (t) { return t.title === "Sort the photos"; })[0].remind`), [RM(1), RM(3, "days", "18:00"), RM(0)]), "a reply with two 'remind me' phrases adds both (the one already there isn't doubled)");
ok(run(`__fetches.some(function (f) { return f.body && /^👍 Reminders set for \\w{3}, \\w{3} \\d+ 6:00 PM; \\w{3}, \\w{3} \\d+ 9:00 AM$/.test(f.body.content); })`), "the bot lists both: '👍 Reminders set for … 6:00 PM; … 9:00 AM'");
ok(run(`TBL.TaskUpdates.filter(function (u) { return u.discordMessageId === "200000000000002020"; })[0].status`) === "", "a 'remind me' reply doesn't change the status");

// Reminder due → posted once, as a reply to the task's message
run(`var R = TBL.Tasks.filter(function (t) { return t.title === "Make reel for badminton"; })[0];
  var __p60 = edmParts_(Date.now() - 3600000);
  R.due = __p60.ymd;
  R.remind = [{ n: 0, unit: "days", at: ("0" + __p60.h).slice(-2) + ":" + ("0" + __p60.min).slice(-2) }];   // on the due day, an hour ago
  R.remindSent = [];
  R.ownerDiscordId = "";   // an older row without ownerDiscordId: the Team list is used
  __refreshReal(); __fetches = [];`);
ok(Date.parse(run(`P.getProperty("NEXT_TASK_REMINDER")`)) <= Date.now(), "NEXT_TASK_REMINDER is due");
run(`taskBotTick()`);
let reminders = run(`__fetches.filter(function (f) { return f.body && /^⏰ Reminder/.test(f.body.content); })`);
ok(reminders.length === 1 && reminders[0].body.message_reference.message_id === "200000000000002001" && /^⏰ Reminder <@111111111111111111>: \*\*Make reel for badminton\*\* is due \w{3}, \w{3} \d+\. Reply with how it's going\.$/.test(reminders[0].body.content),
  "reminder posted as a reply to the task's message, pinging the owner (from the Team list when the task has no ownerDiscordId)");
ok(run(`R.remindSent.join()`) === run(`R.due + "|0days@" + R.remind[0].at`) && run(`R.discordRefs.length`) === 2, "marked sent; the reminder's id joins discordRefs");
run(`P.setProperty("NEXT_TASK_REMINDER", new Date(Date.now() - 1000).toISOString()); __fetches = []; taskBotTick()`);
ok(run(`__fetches.filter(function (f) { return f.body && /^⏰ Reminder/.test(f.body.content); }).length`) === 0, "never sent twice");
run(`R.remindSent = []; R.status = "done"; P.setProperty("NEXT_TASK_REMINDER", new Date(Date.now() - 1000).toISOString()); __fetches = []; taskBotTick()`);
ok(run(`__fetches.filter(function (f) { return f.body && /^⏰ Reminder/.test(f.body.content); }).length`) === 0, "done task: no reminder");
run(`R.status = "doing"; R.remindSent = []; R.due = ymdAdd_(__p60.ymd, -3); P.setProperty("NEXT_TASK_REMINDER", new Date(Date.now() - 1000).toISOString()); __fetches = []; taskBotTick()`);
ok(run(`__fetches.filter(function (f) { return f.body && /^⏰ Reminder/.test(f.body.content); }).length`) === 0 && run(`R.remindSent.length`) === 1, "a reminder more than a day late (timer was off) is skipped, not sent late");
run(`R.remindSent = []; R.due = __p60.ymd; P.setProperty("NEXT_TASK_REMINDER", new Date(Date.now() - 1000).toISOString());
  __fetches = []; __mode = "postfail"; taskBotTick(); __mode = "";`);
ok(run(`__fetches.filter(function (f) { return f.body && /^⏰ Reminder/.test(f.body.content); }).length`) === 1 && run(`R.remindSent.length`) === 1 &&
  run(`TBL.TaskUpdates.some(function (u) { return u.taskId === R.id && /reminder couldn't be posted/.test(u.text); })`), "a reminder Discord refuses: it was marked sent first, and the task gets a note saying it wasn't posted");
run(`P.setProperty("NEXT_TASK_REMINDER", new Date(Date.now() - 1000).toISOString()); __fetches = []; taskBotTick()`);
ok(run(`__fetches.filter(function (f) { return f.body && /^⏰ Reminder/.test(f.body.content); }).length`) === 0, "…and it isn't tried again every minute");

// Timer never throws; status for admins
run(`__mode = "throw"; P.setProperty("NEXT_TASK_REMINDER", new Date(Date.now() - 1000).toISOString())`);
ok(!fn(`taskBotTick()`).err, "tick never throws, even when Discord is unreachable");
run(`__mode = ""`);
r = fn(`route_({ action: "taskBotStatus", token: "${execTok}" })`);
ok(r.err === "ADMIN_ONLY", "taskBotStatus: admin only");
r = run(`route_({ action: "taskBotStatus", token: "${adminTok}" })`);
ok(r.ok && r.timer === true && r.posting && r.reading && r.botName === "taskbot" && JSON.stringify(r).indexOf("SECRET") === -1, "taskBotStatus: timer on (it ran just now), posting/reading ready, bot name, no secrets");
ok(r.lastTick && r.lastTick === run(`P.getProperty("TASKBOT_LAST_TICK")`) && Date.now() - Date.parse(r.lastTick) < 60000, "each tick saves TASKBOT_LAST_TICK; taskBotStatus shows it");
run(`P.setProperty("TASKBOT_LAST_TICK", new Date(Date.now() - 6 * 60000).toISOString())`);
ok(run(`taskBotStatus_().timer`) === false, "timer shows off when the last tick is more than 5 minutes ago");
run(`P.deleteProperty("TASKBOT_LAST_TICK")`);
ok(run(`taskBotStatus_().timer`) === false && run(`taskBotStatus_().lastTick`) === "", "timer shows off when it has never run");
const fs = require("fs"), path = require("path");
const apiDir = path.join(__dirname, "..", "api");
ok(fs.readFileSync(path.join(apiDir, "appsscript.json"), "utf8").indexOf("script.scriptapp") === -1 &&
  fs.readdirSync(apiDir).filter((f) => f.endsWith(".js")).every((f) => !/\bScriptApp\./.test(fs.readFileSync(path.join(apiDir, f), "utf8"))),
  "no ScriptApp permission and no ScriptApp use (the timer is added by hand in Apps Script → Triggers)");
run(`__discord("")`);
run(`__fetches = []; __reads = 0; taskBotTick()`);
ok(run(`__fetches.length`) === 0 && run(`__reads`) === 0, "Discord not set up: the timer does nothing at all");

// ---- People list: signing in adds the name (exec and admin, not door) ---------------------------------
run(`var __configReal = getConfig_; getConfig_ = function () { return Object.assign({}, __configReal(), { password: "exec-test-pw", adminPassword: "admin-test-pw" }); };
  P.setProperty("SCANNER_PASSWORD", "door-test-pw");
  var __teamReads = 0, __readRowsCounted = readRows_; readRows_ = function (name) { if (name === "Team") __teamReads++; return __readRowsCounted(name); };`);
const teamCount = () => run(`TBL.Team.length`);
const named = (n) => run(`TBL.Team.filter(function (r) { return teamNameKey_(r.name) === teamNameKey_(${JSON.stringify(n)}); })`);
let n0 = teamCount();
r = fn(`login_("exec-test-pw", "  Jamie   Wong ")`);
ok(r.v && r.v.ok && r.v.role === "exec" && teamCount() === n0 + 1 && named("jamie wong").length === 1 && named("jamie wong")[0].name === "Jamie Wong" &&
  named("jamie wong")[0].department === "" && named("jamie wong")[0].discordId === "", "exec sign-in: the name joins the People list (spaces tidied; department and Discord ID blank)");
ok(run(`taskTeam_().filter(function (m) { return m.name === "Jamie Wong"; })[0].active`) === true, "…as active");
run(`__teamReads = 0`);
const logsBefore = run(`__logs.length`);
ok(fn(`login_("exec-test-pw", "JAMIE wong")`).v.ok && fn(`login_("admin-test-pw", "jamie  WONG")`).v.ok && teamCount() === n0 + 1, "signing in again with other capitals or spacing (exec or admin) doesn't add them twice");
ok(run(`__teamReads`) === 2 && run(`__logs.length`) === logsBefore, "…each of those sign-ins reads the People list once and writes nothing");
r = fn(`login_("admin-test-pw", "Admin Person")`);
ok(r.v && r.v.ok && r.v.role === "admin" && named("admin person").length === 1, "admin sign-in adds the name too");
ok(fn(`login_("exec-test-pw", "kevin")`).v.ok && named("kevin").length === 1, "a name already on the list (Kevin) isn't added again");
r = fn(`login_("wrong", "Not Real")`);
ok(r.err === "WRONG_PASSWORD" && named("not real").length === 0, "wrong password: nobody added");
run(`var __entryReal = entryOpenEvents_; entryOpenEvents_ = function () { return [{ id: "E1" }]; };`);
r = fn(`loginDoor_("door-test-pw", "Door Volunteer")`);
ok(r.v && r.v.ok && r.v.role === "door" && named("door volunteer").length === 0, "door sign-in doesn't add anyone");
run(`entryOpenEvents_ = __entryReal;`);
run(`var __insertReal = insertRow_; insertRow_ = function (name, row) { if (name === "Team") throw new Error("Sheet is busy"); return __insertReal(name, row); };`);
r = fn(`login_("exec-test-pw", "Brand New")`);
ok(r.v && r.v.ok && r.v.token && named("brand new").length === 0, "the People list can't be written: signing in still works");
run(`insertRow_ = __insertReal; readRows_ = function (name) { if (name === "Team") throw new Error("Sheet is down"); return __readRowsCounted(name); };`);
r = fn(`login_("exec-test-pw", "Brand New")`);
ok(r.v && r.v.ok && r.v.token, "the People list can't be read: signing in still works");
run(`readRows_ = __readRowsCounted;`);
ok(fn(`login_("exec-test-pw", "Brand New")`).v.ok && named("brand new").length === 1, "…and the name is added at the next sign-in that works");
ok(run(`__logs.some(function (l) { return l.action === "person.added" && l.details.source === "sign-in" && l.details.name === "Jamie Wong"; })`), "a name added at sign-in is logged");

// ---- saveTask: the owner is free text; a new name joins the People list ------------------------------
n0 = teamCount();
r = run(`saveTask_(S, { title: "Spelling test", owner: "  kEVIN  " }).task`);
ok(r.owner === "Kevin" && r.department === "Marketing" && teamCount() === n0, "an owner typed in other capitals/spacing is saved with the People list's spelling; nobody added");
r = run(`saveTask_(S, { title: "New owner test", owner: "Casey Ng", department: "Events" }).task`);
ok(r.owner === "Casey Ng" && named("casey ng").length === 1 && named("casey ng")[0].department === "Events" && run(`taskTeam_().filter(function (m) { return m.name === "Casey Ng"; })[0].active`) === true,
  "a new owner joins the People list (active) with the task's department");
r = run(`saveTask_(S, { title: "New owner again", owner: "casey NG" }).task`);
ok(r.owner === "Casey Ng" && r.department === "Events" && named("casey ng").length === 1, "…next time the name matches them (any capitals): no duplicate, and their department is used");
r = run(`saveTask_(S, { id: "${r.id}", owner: "Robin Q" }).task`);
ok(r.owner === "Robin Q" && named("robin q").length === 1, "editing the owner to a new name adds them too");
r = run(`saveTask_(S, { id: "${r.id}", owner: "ROBIN q" }).task`);
ok(r.owner === "Robin Q" && named("robin q").length === 1, "…and editing to the same name in other capitals keeps the list's spelling");
n0 = teamCount();
ok(run(`saveTask_(S, { title: "Nobody yet", owner: "" }).task.owner`) === "" && teamCount() === n0, "no owner: nobody added");

// ---- Settings → People (admin): savePerson / removePerson ----------------------------------------------
ok(fn(`route_({ action: "savePerson", token: "${execTok}", person: { name: "X" } })`).err === "ADMIN_ONLY" && fn(`route_({ action: "removePerson", token: "${execTok}", id: "x" })`).err === "ADMIN_ONLY",
  "savePerson / removePerson: admin only");
r = run(`route_({ action: "savePerson", token: "${adminTok}", person: { name: "  Taylor   Ho ", department: "Finance", discordId: " 333333333333333333 ", active: true } })`);
ok(r.ok && r.person.name === "Taylor Ho" && r.person.department === "Finance" && r.person.discordId === "333333333333333333" && r.person.active === true && r.person.id && r.team.some((m) => m.id === r.person.id),
  "savePerson adds a person: { ok, person, team }");
const taylor = r.person.id;
ok(fn(`savePerson_(A, { name: "taylor ho" })`).err === "BAD_REQUEST" && /already on the list/.test(fn(`savePerson_(A, { name: "TAYLOR  HO" })`).msg), "a name already on the list (any capitals/spacing) is refused");
ok(fn(`savePerson_(A, { name: "  " })`).err === "BAD_REQUEST", "a name is required");
ok(fn(`savePerson_(A, { name: "Zed", discordId: "123" })`).err === "BAD_REQUEST", "a Discord ID must be 17 to 20 digits");
ok(fn(`savePerson_(A, { name: "Zed", discordId: "333333333333333333" })`).err === "BAD_REQUEST", "a Discord ID already saved for someone else is refused");
r = run(`savePerson_(A, { id: "${taylor}", name: "Taylor HO", department: "Nope", discordId: "", active: false })`);
ok(r.person.id === taylor && r.person.name === "Taylor HO" && r.person.discordId === "" && r.person.active === false && named("taylor ho").length === 1 && named("taylor ho")[0].department === "",
  "editing a person: their own name in other capitals is fine; off = active false; an unknown department is saved blank");
ok(fn(`savePerson_(A, { id: "TM-nope", name: "Ghost" })`).err === "NOT_FOUND", "editing someone no longer on the list: NOT_FOUND");
ok(fn(`savePerson_(A, { id: "${taylor}", name: "kevin" })`).err === "BAD_REQUEST", "renaming someone to another person's name is refused");
run(`saveTask_(S, { title: "Taylor task", owner: "taylor ho" })`);
n0 = teamCount();
r = run(`route_({ action: "removePerson", token: "${adminTok}", id: "${taylor}" })`);
ok(r.ok && teamCount() === n0 - 1 && !r.team.some((m) => m.id === taylor) && named("taylor ho").length === 0, "removePerson deletes the row: { ok, team }");
ok(run(`TBL.Tasks.filter(function (t) { return t.title === "Taylor task"; })[0].owner`) === "Taylor HO", "their tasks keep the owner's name as written");
ok(fn(`removePerson_(A, "${taylor}")`).err === "NOT_FOUND", "removing them again: NOT_FOUND");
ok(run(`__logs.some(function (l) { return l.action === "person.saved"; }) && __logs.some(function (l) { return l.action === "person.removed"; })`), "People changes are logged");
ok(fn(`saveTeam_(A, taskTeam_())`).v.ok, "saveTeam still works alongside");

// ---- Round 2 review fixes ---------------------------------------------------------------------------
// People with no department come back blank (the Tasks page falls back to General itself)
ok(run(`teamView_({ id: "x", name: "A", department: "", active: true }).department`) === "" && run(`teamView_({ id: "x", name: "A", department: "Nope" }).department`) === "" &&
  run(`teamView_({ id: "x", name: "A", department: "Events" }).department`) === "Events", "a person without a department is sent with department \"\" (not General)");

// Sign-in adds a new name under the script lock, checks again inside it, and skips quietly when the lock is busy
run(`var __lockReal = LockService, __tryWaits = [];
  LockService = { getScriptLock: function () { return { tryLock: function (ms) { __tryWaits.push(ms); return false; }, releaseLock: function () {} }; } };`);
n0 = teamCount();
r = fn(`login_("exec-test-pw", "Busy Lock Person")`);
ok(r.v && r.v.ok && r.v.token && named("busy lock person").length === 0 && teamCount() === n0, "lock busy: signing in works, the name is simply not added this time");
ok(run(`__tryWaits.length === 1 && __tryWaits[0] > 0 && __tryWaits[0] <= 1000`), "…it waits at most about a second for the lock");
run(`__tryWaits = []; LockService = { getScriptLock: function () { var held = false; return {
    tryLock: function (ms) { __tryWaits.push(ms); TBL.Team.push({ id: "TM-race", name: "race  PERSON", department: "", discordId: "", active: true, sort: 99 }); held = true; __locked++; return true; },
    releaseLock: function () { if (held) { held = false; __locked--; } } }; } };`);
r = fn(`login_("exec-test-pw", "Race Person")`);
ok(r.v && r.v.ok && named("race person").length === 1 && named("race person")[0].id === "TM-race", "two sign-ins at once: the name is checked again inside the lock, so it isn't added twice");
ok(run(`__locked`) === 0, "…and the lock is released");
run(`LockService = __lockReal;`);
r = fn(`login_("exec-test-pw", "Normal Add")`);
ok(r.v && r.v.ok && named("normal add").length === 1 && run(`__locked`) === 0, "lock free: a new name is added and the lock released");
ok(run(`taskTeam_().filter(function (m) { return m.name === "Normal Add"; })[0].department`) === "", "…with department \"\" in the list the Tasks page gets");

// Session names are tidied like the People list's names, so "My tasks" matches
r = fn(`login_("exec-test-pw", "  =Sam    Lee  ")`);
ok(r.v && r.v.name === "Sam Lee" && named("sam lee")[0].name === "Sam Lee" && run(`JSON.parse(CacheService.getScriptCache().get("session_${r.v.token}")).name`) === "Sam Lee",
  "the signed-in name is tidied exactly like the People row (spaces, a leading =)");

// Names: 60 characters at most everywhere
const long = "Name" + "x".repeat(80);
r = fn(`login_("exec-test-pw", "${long}")`);
ok(r.v && r.v.name.length === 60 && named(long.slice(0, 60)).length === 1 && named(long.slice(0, 60))[0].name.length === 60, "sign-in: name cut to 60 characters (session and People row)");
const long2 = "Owner" + "y".repeat(80);
r = run(`saveTask_(S, { title: "Long owner", owner: "${long2}" }).task`);
ok(r.owner === long2.slice(0, 60) && named(long2.slice(0, 60)).length === 1 && named(long2.slice(0, 60))[0].name.length === 60, "task owner (and the person it adds) cut to 60 characters");
ok(run(`savePerson_(A, { name: "${"z".repeat(90)}" }).person.name.length`) === 60, "savePerson: 60 characters");
ok(run(`teamInsert_("${"w".repeat(90)}", "").name.length`) === 60, "teamInsert_: 60 characters");

// Editing someone works even if the list already had their name twice (from before names were unique)
run(`TBL.Team.push({ id: "TM-dup1", name: "Dup Person", department: "", discordId: "", active: true, sort: 200 }, { id: "TM-dup2", name: "dup  person", department: "", discordId: "", active: true, sort: 201 });`);
r = fn(`savePerson_(A, { id: "TM-dup1", name: "Dup Person", department: "Events", discordId: "", active: true })`);
ok(r.v && r.v.ok && r.v.person.department === "Events", "an existing duplicate name: that person can still be edited (department changed)");
ok(fn(`savePerson_(A, { id: "TM-dup2", name: "Dup Person", active: false })`).v.ok, "…the other one too");
ok(/already on the list/.test(fn(`savePerson_(A, { id: "${run(`TBL.Team.filter(function (r) { return r.name === "Normal Add"; })[0].id`)}", name: "dup person" })`).msg || ""),
  "renaming someone else to that name is still refused");

// A task taken out of Done doesn't send the reminders whose time came while it was done
const doneTask = run(`saveTask_(S, { title: "Done then reopened", owner: "Kevin", due: "2099-12-05" }).task.id`);
run(`TBL.Tasks.forEach(function (t) { if (t.id === "${doneTask}") {
  var today = edmParts_(Date.now()).ymd;
  t.due = ymdAdd_(today, 1); t.status = "done"; t.doneAt = new Date().toISOString(); t.remindSent = [];
  t.remind = [{ n: 2, unit: "days", at: "09:00" }, { n: 1, unit: "days", at: "00:00" }, { n: 0, unit: "days", at: "23:59" }]; } });`);
r = run(`setTaskStatus_(S, "${doneTask}", "doing").task`);
const reopened = rowOf(doneTask);
ok(reopened.remindSent.length === 2 && reopened.remindSent.every((k) => /\|(2days@09:00|1days@00:00)$/.test(k)), "leaving Done: reminders whose time already came are marked as sent (no burst)");
ok(r.reminders.filter((x) => !x.sent).length === 1 && r.nextReminder.slice(11) === "23:59", "…the one still to come stays on");
run(`__fetches = []; P.setProperty("NEXT_TASK_REMINDER", new Date(Date.now() - 60000).toISOString()); __discord("bot"); __inbox = []; taskBotTick()`);
ok(!run(`__fetches.some(function (f) { return f.body && /^⏰ Reminder/.test(f.body.content) && /Done then reopened/.test(f.body.content); })`), "…and the timer doesn't post them");
run(`__discord("")`);
run(`TBL.Tasks.forEach(function (t) { if (t.id === "${doneTask}") { t.status = "done"; t.remindSent = []; } });`);
run(`addTaskUpdate_(S, "${doneTask}", "reopening", "blocked")`);
ok(rowOf(doneTask).remindSent.length === 2, "the same when an update takes it out of Done");

// Calgary time on the changeover Sundays (2026: summer time starts Mar 8, ends Nov 1, both at 2:00 AM)
const EP = (iso) => run(`(function () { var p = edmParts_(Date.parse("${iso}")); return p.ymd + " " + ("0" + p.h).slice(-2) + ":" + ("0" + p.min).slice(-2); })()`);
const EA = (ymd, h, m) => run(`new Date(edmAt_("${ymd}", ${h}, ${m})).toISOString()`);
ok(EP("2026-03-08T07:30:00Z") === "2026-03-08 00:30" && EP("2026-03-08T08:59:00Z") === "2026-03-08 01:59" && EP("2026-03-08T09:00:00Z") === "2026-03-08 03:00",
  "March changeover Sunday: 00:30 and 01:59 are still winter time; 2:00 AM jumps to 3:00 AM");
ok(EA("2026-03-08", 0, 30) === "2026-03-08T07:30:00.000Z" && EA("2026-03-08", 1, 59) === "2026-03-08T08:59:00.000Z" && EA("2026-03-08", 3, 0) === "2026-03-08T09:00:00.000Z" &&
  EA("2026-03-08", 9, 0) === "2026-03-08T15:00:00.000Z" && EA("2026-03-07", 9, 0) === "2026-03-07T16:00:00.000Z", "March changeover Sunday: times of day turn into the right moments");
ok(EP("2026-11-01T06:30:00Z") === "2026-11-01 00:30" && EP("2026-11-01T05:59:00Z") === "2026-10-31 23:59" && EP("2026-11-01T07:30:00Z") === "2026-11-01 01:30" &&
  EP("2026-11-01T08:30:00Z") === "2026-11-01 01:30" && EP("2026-11-01T09:00:00Z") === "2026-11-01 02:00", "November changeover Sunday: 00:00-01:59 is still summer time, then 1:00 AM comes again");
ok(EA("2026-11-01", 0, 30) === "2026-11-01T06:30:00.000Z" && EA("2026-11-01", 1, 30) === "2026-11-01T07:30:00.000Z" && EA("2026-11-01", 2, 0) === "2026-11-01T09:00:00.000Z" &&
  EA("2026-11-01", 9, 0) === "2026-11-01T16:00:00.000Z" && EA("2026-10-31", 9, 0) === "2026-10-31T15:00:00.000Z", "November changeover Sunday: times of day turn into the right moments");
ok(run(`(function () { var bad = 0; ["2026-03-07", "2026-03-08", "2026-03-09", "2026-10-31", "2026-11-01", "2026-11-02"].forEach(function (d) {
  for (var m = 0; m < 1440; m += 15) { var h = Math.floor(m / 60), mi = m % 60; if (d === "2026-03-08" && h === 2) continue;
    if (taskStamp_(edmAt_(d, h, mi)) !== d + "T" + ("0" + h).slice(-2) + ":" + ("0" + mi).slice(-2)) bad++; } }); return bad; })()`) === 0,
  "every quarter hour around both changeovers reads back as the same day and time");

// "remind me <a day>" that can't be used: the bot says so
ok(SAME(P_("<@900000000000000001> make reel by dec 5 remind me dec 10").remindDropped, [{ day: "2026-12-10", why: "after" }]), "parse: a reminder day after the due date is listed as dropped");
ok(SAME(P_("<@900000000000000001> make reel by mar 30 remind me tomorrow").remindDropped, [{ day: "2026-11-24", why: "early" }]), "parse: a reminder day more than 60 days early is listed as dropped");
ok(run(`tbDroppedText_([{ day: "2026-12-10", why: "after" }])`) === "Couldn't set a reminder for Thu, Dec 10 — it's after the due date." &&
  run(`tbDroppedText_([{ day: "2026-11-24", why: "early" }])`) === "Couldn't set a reminder for Tue, Nov 24 — it's more than 60 days before the due date.", "the bot's words for them");
const remTask = run(`saveTask_(S, { title: "Reply reminder test", owner: "Kevin", due: ymdAdd_(edmParts_(Date.now()).ymd, 5) }).task.id`);
const RR = (phrase) => run(`discordReplyReminders_(TBL.Tasks.filter(function (t) { return t.id === "${remTask}"; })[0], tbTakeReminders_(" ${phrase} ").specs, new Date(), "Kevin", "300000000000000001").content`);
r = RR("remind me in 10 days");
ok(/^🤔 Couldn't set a reminder for .+ — it's after the due date\.$/.test(r), "reply: a reminder day after the due date gets a plain answer: " + r);
r = RR("remind me 1 day before remind me in 10 days");
ok(/^👍 Reminder set for .+\nCouldn't set a reminder for .+ — it's after the due date\.$/.test(r), "reply: one set and one dropped: both are said");
run(`TBL.Tasks.forEach(function (t) { if (t.id === "${remTask}") { t.due = ymdAdd_(edmParts_(Date.now()).ymd, 90); t.remind = []; } });`);
r = RR("remind me tomorrow");
ok(/^🤔 Couldn't set a reminder for .+ — it's more than 60 days before the due date\.$/.test(r), "reply: a reminder day more than 60 days early gets a plain answer");

// Routes exist
["listTasks", "saveTask", "setTaskStatus", "addTaskUpdate", "removeTask", "remindTasksOnDiscord"].forEach((a) => {
  const x = fn(`route_({ action: "${a}", token: "nope" })`);
  ok(x.err === "NOT_LOGGED_IN", `${a}: needs a signed-in exec`);
});
ok(run(`route_({ action: "listTasks", token: "${execTok}" }).ok`), "listTasks works through the API");

// Locks, across everything above
ok(run(`__lockedFetches`) === 0, "Discord is never called while the script lock is held");
ok(run(`__unlockedRefresh`) === 0, "NEXT_TASK_REMINDER is only worked out while holding the lock (new tasks too)");
ok(run(`__locked`) === 0, "every lock taken was released");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
