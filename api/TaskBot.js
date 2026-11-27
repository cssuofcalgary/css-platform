/**
 * CSS Platform API — @taskbot: tasks made by talking to a Discord bot, and optional reminders.
 *
 * The owner approved ONE exception to "no timers": taskBotTick runs every minute, only for this bot. It is built to be cheap:
 * one small Discord read, and the data sheet is only opened when someone wrote something the bot cares about or a reminder
 * is due (the time of the next one is kept in the Script Property NEXT_TASK_REMINDER).
 *
 * Setup (once, by the owner): set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID (see Discord.js), then add the timer by hand in
 * Apps Script → Triggers (clock icon) → Add Trigger → taskBotTick, Head deployment, Time-driven, Minutes timer, Every minute.
 * (A script can't add its own timer without an extra permission that broke the web app once, see Jobs.js.)
 * Each run writes the time to the Script Property TASKBOT_LAST_TICK, which is how Team → "Task bot: timer on" knows it runs.
 *
 * In #tasks:  "@taskbot make reel for badminton by friday remind me 2 days before at 6pm"  → a task, and the bot confirms.
 * Reminders work like Google Calendar: a task has a list (empty by default, up to 5) of { n, unit: "days"|"weeks", at: "HH:MM" },
 * meaning "n days/weeks before the due date, at that time, Calgary time" (n = 0 days: on the due day). They only go out when
 * the task has a due date. Older rows hold a word ("halfway", "daybefore", "both") or a day: those are read as the same list.
 */

const TASK_REMINDER_HOUR = 9;                  // reminders made from words ("day before", "halfway") go out at 9:00 AM Calgary time
const TASK_REMINDER_STALE_MS = 24 * 3600000;   // a reminder more than a day late (timer was off) is skipped, not sent late
const TASK_REMINDER_GRACE_MS = 10 * 60000;     // when a task is saved, a reminder time up to 10 minutes ago still goes out; older ones never do
const TASK_REMINDERS_MAX = 5;
const TASKBOT_ALIVE_MS = 5 * 60000;            // the timer counts as "on" if it ran in the last 5 minutes

// ---- Calgary dates and times -------------------------------------------------------------------
// Worked out by hand (Calgary: UTC-7, or UTC-6 from 2:00 AM on the second Sunday of March to 2:00 AM on the first Sunday of
// November), so the result never depends on the server's own time zone.

/** Is Calgary on summer time at this moment? Exact to the minute, so the changeover Sundays are right before 2:00 AM too. */
function edmIsDstAt_(ms) {
  const y = new Date(ms).getUTCFullYear();
  const firstSunday = function (month) { return 1 + (7 - new Date(Date.UTC(y, month, 1)).getUTCDay()) % 7; };
  const starts = Date.UTC(y, 2, firstSunday(2) + 7, 2 + 7);   // 2:00 AM winter time (UTC-7), second Sunday of March
  const ends = Date.UTC(y, 10, firstSunday(10), 2 + 6);       // 2:00 AM summer time (UTC-6), first Sunday of November
  return ms >= starts && ms < ends;
}

/** { y, m, d, h, min, dow (0 = Sunday), ymd } for a moment, in Calgary time. */
function edmParts_(ms) {
  const local = new Date(ms - (edmIsDstAt_(ms) ? 6 : 7) * 3600000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth() + 1, d = local.getUTCDate();
  return { y: y, m: m, d: d, h: local.getUTCHours(), min: local.getUTCMinutes(), dow: local.getUTCDay(), ymd: ymdOf_(y, m, d) };
}

/**
 * The moment it is h:min in Calgary on that day ("yyyy-MM-dd"). On the November Sunday, 1:00-1:59 AM happens twice: the
 * first one (summer time) is used. On the March Sunday, 2:00-2:59 AM doesn't exist: it is read as winter time (an hour later).
 */
function edmAt_(ymd, h, min) {
  const p = String(ymd).split("-").map(Number);
  const wall = Date.UTC(p[0], p[1] - 1, p[2], h || 0, min || 0);
  return edmIsDstAt_(wall + 6 * 3600000) ? wall + 6 * 3600000 : wall + 7 * 3600000;
}

/** "yyyy-MM-dd", or "" when the day doesn't exist (Feb 30). */
function ymdOf_(y, m, d) {
  const x = new Date(Date.UTC(y, m - 1, d));
  if (x.getUTCFullYear() !== y || x.getUTCMonth() !== m - 1 || x.getUTCDate() !== d) return "";
  return y + "-" + ("0" + m).slice(-2) + "-" + ("0" + d).slice(-2);
}

function ymdAdd_(ymd, days) {
  const p = String(ymd).split("-").map(Number);
  const x = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return ymdOf_(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

/** How many days from day a to day b (both "yyyy-MM-dd"); negative when b is earlier. */
function ymdDiff_(a, b) {
  const p = String(a).split("-").map(Number), q = String(b).split("-").map(Number);
  return Math.round((Date.UTC(q[0], q[1] - 1, q[2]) - Date.UTC(p[0], p[1] - 1, p[2])) / 86400000);
}

function isYmd_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

const TASK_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TASK_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri, Dec 5" for "2026-12-05" (or `blank` when there is no date). */
function taskDayText_(ymd, blank) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return blank === undefined ? "" : blank;
  const x = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return TASK_DAY_NAMES[x.getUTCDay()] + ", " + TASK_MONTH_NAMES[x.getUTCMonth()] + " " + x.getUTCDate();
}

/** "Wed, Dec 3 9:00 AM" for a moment (Calgary time). */
function taskWhenText_(ms) {
  const p = edmParts_(ms);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return taskDayText_(p.ymd) + " " + h12 + ":" + ("0" + p.min).slice(-2) + (p.h < 12 ? " AM" : " PM");
}

/** "yyyy-MM-ddTHH:mm" for a moment (Calgary time): what the portal shows as the next reminder. */
function taskStamp_(ms) {
  const p = edmParts_(ms);
  return p.ymd + "T" + ("0" + p.h).slice(-2) + ":" + ("0" + p.min).slice(-2);
}

// ---- Understanding "@taskbot make reel for badminton by friday" -------------------------------------

const TB_WEEKDAY = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const TB_MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const TB_NUMBER = "(?:\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)";
const TB_DATE = "(" + [
  "end\\s+of\\s+(?:the\\s+|this\\s+)?week", "eow", "next\\s+week",
  "(?:this\\s+|next\\s+)?" + TB_WEEKDAY,
  "today", "tonight", "tomorrow", "tomorow", "tmrrw", "tmrw", "tmr",
  "in\\s+" + TB_NUMBER + "\\s+(?:days?|weeks?)",
  TB_MONTH + "\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?",
  "\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?" + TB_MONTH + "(?:,?\\s+\\d{4})?",
  "\\d{4}-\\d{2}-\\d{2}",
  "\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?"
].join("|") + ")";
const TB_NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const TB_TIME = "(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)|\\d{1,2}:\\d{2}|noon|midnight)";
// What can follow "remind me": both | halfway | the day before | 2 days before | 1 week before | on the day | <a day>. Then "at 6pm".
// Groups: 1 = the space before, 2 = what, 3 = (inside TB_DATE), 4 = the time.
const TB_REMIND_RE = "(^|\\s)(?:,\\s*|and\\s+|&\\s+)?(?:please\\s+|pls\\s+)?remind(?:\\s+(?:me|them|us|him|her|everyone))?\\s+(?:(?:at|for)\\s+)?(" + [
  "both",
  "half\\s*-?\\s*way(?:\\s+(?:and|&|\\+)\\s+(?:on\\s+)?(?:the\\s+)?day\\s+before)?",
  "(?:on\\s+)?(?:the\\s+)?day\\s+before(?:\\s+(?:and|&|\\+)\\s+half\\s*-?\\s*way)?",
  TB_NUMBER + "\\s+(?:days?|weeks?)\\s+(?:before|early|earlier|ahead)",
  "(?:on\\s+)?the\\s+(?:same\\s+)?day(?:\\s+(?:it'?s\\s+due|of))?",
  "(?:on\\s+)?" + TB_DATE
].join("|") + ")(?:\\s+at\\s+(" + TB_TIME + "))?(?![\\w/])";

/** "18:00" for "6pm", "6 p.m.", "18:00", "noon". "" when it isn't a time. */
function tbTime_(text) {
  const t = String(text || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (t === "noon") return "12:00";
  if (t === "midnight") return "00:00";
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t);
  if (!m) return "";
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3]) {
    if (h < 1 || h > 12) return "";
    h = h % 12 + (m[3] === "pm" ? 12 : 0);
  }
  if (h > 23 || min > 59) return "";
  return ("0" + h).slice(-2) + ":" + ("0" + min).slice(-2);
}

/** Takes every "remind me …" phrase out of a message. { specs: [{ what, time }], rest: the message without them }. */
function tbTakeReminders_(text) {
  let s = String(text || "");
  const specs = [];
  const re = new RegExp(TB_REMIND_RE, "i");
  for (let i = 0; i < 10; i++) {
    const m = re.exec(s);
    if (!m) break;
    specs.push({ what: m[2], time: m[4] || "" });
    s = s.slice(0, m.index) + m[1] + s.slice(m.index + m[0].length);
  }
  return { specs: specs, rest: s };
}

/**
 * Turns "remind me …" phrases into reminder items { n, unit, at }, for a task due on `due` ("" = no due date), said on `today`.
 * "halfway" and "remind me <a day>" need the due date: without one they are left out and needsDue is true (so is it whenever
 * reminders were asked for on a task with no due date, since none can go out). A day after the due date, or more than
 * 60 days before it, is left out and listed in dropped ({ day, why: "after" | "early" }) so the bot can say so.
 */
function tbRemindItems_(specs, due, today, dow) {
  const items = [], dropped = [];
  const add = function (n, unit, at) { if (n >= 0 && n <= 60) items.push({ n: n, unit: unit, at: at }); };
  (specs || []).forEach(function (spec) {
    const what = String(spec.what || "").toLowerCase().replace(/\s+/g, " ").trim();
    const at = tbTime_(spec.time) || ("0" + TASK_REMINDER_HOUR).slice(-2) + ":00";
    let m;
    if ((m = /^(\d+|[a-z]+) (days?|weeks?) (?:before|early|earlier|ahead)$/.exec(what)) && (/^\d+$/.test(m[1]) || TB_NUMBER_WORDS[m[1]])) {
      add(Math.min(/^\d+$/.test(m[1]) ? Number(m[1]) : TB_NUMBER_WORDS[m[1]], 60), m[2].charAt(0) === "w" ? "weeks" : "days", at);
      return;
    }
    const half = /half/.test(what), before = /\bday before\b/.test(what);
    if (what === "both" || half) {
      if (due) add(Math.min(60, Math.floor(Math.max(0, ymdDiff_(today, due)) / 2)), "days", at);
      if (what !== "both" && !before) return;
    }
    if (what === "both" || before) { add(1, "days", at); return; }
    if (/^(?:on )?the (?:same )?day\b/.test(what)) { add(0, "days", at); return; }
    const day = tbResolveDate_(what.replace(/^on /, ""), today, dow);
    if (day && due) {
      const n = ymdDiff_(day, due);
      if (n < 0) dropped.push({ day: day, why: "after" });
      else if (n > 60) dropped.push({ day: day, why: "early" });
      else add(n, "days", at);
    }
  });
  return { items: taskReminderDedupe_(items), needsDue: !due && (specs || []).length > 0, dropped: dropped };
}

/** The bot's words for reminder days it couldn't use: "Couldn't set a reminder for Wed, Dec 9 — it's after the due date." */
function tbDroppedText_(dropped) {
  return (dropped || []).map(function (x) {
    return "Couldn't set a reminder for " + taskDayText_(x.day) + " — " +
      (x.why === "after" ? "it's after the due date." : "it's more than 60 days before the due date.");
  }).join(" ");
}

function tbWeekdayIndex_(word) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(String(word).toLowerCase().slice(0, 3));
}

function tbMonthIndex_(word) {
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(String(word).toLowerCase().slice(0, 3)) + 1;
}

/** A day without a year: this year, or next year if that day has already gone by. */
function tbRollForward_(y, m, d, today) {
  const ymd = ymdOf_(y, m, d);
  if (!ymd) return "";
  return ymd < today ? ymdOf_(y + 1, m, d) : ymd;
}

/** Turns one date phrase ("friday", "next tue", "dec 5", "12/5", "in 2 weeks") into "yyyy-MM-dd". "" if it isn't one. */
function tbResolveDate_(phrase, today, dow) {
  const p = String(phrase || "").toLowerCase().replace(/\s+/g, " ").replace(/,/g, "").trim();
  const y = Number(today.slice(0, 4));
  let m;
  if (p === "today" || p === "tonight") return today;
  if (/^(tomorrow|tomorow|tmrrw|tmrw|tmr)$/.test(p)) return ymdAdd_(today, 1);
  if (p === "next week") return ymdAdd_(today, 7);
  if (/^(end of (the |this )?week|eow)$/.test(p)) return ymdAdd_(today, (5 - dow + 7) % 7);
  if ((m = new RegExp("^(this |next )?(" + TB_WEEKDAY + ")$").exec(p))) {
    const want = tbWeekdayIndex_(m[2]);
    if (m[1] === "next ") return ymdAdd_(today, -((dow + 6) % 7) + 7 + (want + 6) % 7);   // the one in the following week (weeks start Monday)
    const ahead = (want - dow + 7) % 7;
    return ymdAdd_(today, ahead === 0 && m[1] !== "this " ? 7 : ahead);                   // "friday" on a Friday means next Friday
  }
  if ((m = /^in (\S+) (days?|weeks?)$/.exec(p))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : TB_NUMBER_WORDS[m[1]];
    return n ? ymdAdd_(today, n * (m[2].charAt(0) === "w" ? 7 : 1)) : "";
  }
  if ((m = new RegExp("^(" + TB_MONTH + ")\\.? (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?$").exec(p))) {
    return m[3] ? ymdOf_(Number(m[3]), tbMonthIndex_(m[1]), Number(m[2])) : tbRollForward_(y, tbMonthIndex_(m[1]), Number(m[2]), today);
  }
  if ((m = new RegExp("^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(" + TB_MONTH + ")(?: (\\d{4}))?$").exec(p))) {
    return m[3] ? ymdOf_(Number(m[3]), tbMonthIndex_(m[2]), Number(m[1])) : tbRollForward_(y, tbMonthIndex_(m[2]), Number(m[1]), today);
  }
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p))) return ymdOf_(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(p))) {   // month first: 12/5 = Dec 5
    if (!m[3]) return tbRollForward_(y, Number(m[1]), Number(m[2]), today);
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return ymdOf_(year, Number(m[1]), Number(m[2]));
  }
  return "";
}

/**
 * Reads a message to the bot. Pure: no sheet, no Discord. `now` = when it was written; `team` = Team rows; `botId` = the
 * bot's own Discord id (its mention is removed). Returns title/due/reminders and assignees, plus the first owner for compatibility:
 *   - assignees: every other person @mentioned ("for @Kevin" works too); empty = assign the author;
 *   - due: "by/due/on/before <date phrase>" anywhere, or a date phrase at the very end;
 *   - remind: a list of { n, unit, at } from every "remind (me|them)? halfway | day before | both | 2 days before | 1 week before |
 *     on the day | on <date phrase> | <date phrase>", each optionally followed by "at 6pm" / "at 18:00" (otherwise 9:00 AM);
 *     remindNeedsDue = reminders were asked for but there is no due date;
 *   - title: what's left, tidied, first letter capitalised ("" = the bot asks what the task is), cut to 140 characters
 *     (titleTooLong says it was longer).
 */
function parseTaskMessage_(text, now, team, botId) {
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === "number" ? now : (Date.parse(now) || Date.now()));
  const here = edmParts_(nowMs);
  const today = here.ymd, dow = here.dow;
  let s = " " + String(text || "").replace(/[\r\n\t]+/g, " ") + " ";
  let ownerDiscordId = "", ownerName = "";

  // Every person mentioned is assigned; bot and role mentions are never assignees.
  s = s.replace(/<@&\d+>/g, " ");
  if (botId) s = s.replace(new RegExp("<@!?" + botId + ">", "g"), " ");
  s = s.replace(/(^|\s)@taskbot\b/gi, " ");
  const assignees = [];
  s = s.replace(/(?:\b(?:assign(?:ed)?\s+to|for|to|with|and)\s+)?<@!?(\d{17,20})>/gi, function (all, uid) {
    if (!assignees.some(function (p) { return p.discordId === uid; })) assignees.push({ name: "", discordId: uid });
    return " ";
  });
  const rows = (team || []).filter(function (r) { return r && r.name; });
  const nameKey = function (name) { return String(name || "").replace(/\s+/g, " ").trim().toLowerCase(); };   // as teamNameKey_ (kept here so the demo can run this in the browser)
  {   // "@Kevin" typed as plain text, for someone on the team list
    rows.slice().sort(function (a, b) { return String(b.name).length - String(a.name).length; }).forEach(function (r) {
      const re = new RegExp("(^|\\s)(?:(?:assign(?:ed)?\\s+to|for|to|with|and)\\s+)?@" + String(r.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w])", "i");
      if (!re.test(s)) return;
      s = s.replace(re, " ");
      const discordId = /^\d{17,20}$/.test(String(r.discordId || "")) ? String(r.discordId) : "";
      if (!assignees.some(function (p) { return (discordId && p.discordId === discordId) || nameKey(p.name) === nameKey(r.name); })) assignees.push({ name: String(r.name), discordId: discordId });
    });
  }
  if (assignees.length) { ownerName = assignees[0].name; ownerDiscordId = assignees[0].discordId; }

  // Reminders first, so "remind me on friday" isn't read as the due date. They are worked out once the due date is known.
  const taken = tbTakeReminders_(s);
  s = taken.rest;

  // Due date: "by friday" anywhere, or a date at the very end ("... friday").
  let due = "";
  const dueRe = new RegExp("(^|\\s)(?:due\\s+(?:by\\s+|on\\s+|before\\s+)?|by\\s+|on\\s+|before\\s+|until\\s+)" + TB_DATE + "(?![\\w/])", "i");
  const dm = dueRe.exec(s);
  if (dm && (due = tbResolveDate_(dm[2], today, dow))) {
    s = s.slice(0, dm.index) + dm[1] + s.slice(dm.index + dm[0].length);
  } else {
    due = "";
    const endRe = new RegExp("(^|\\s)" + TB_DATE + "[\\s.!?]*$", "i");
    const em = endRe.exec(s);
    const bareShort = em && new RegExp("^(?:(?:this|next)\\s+)?(?:mon|tues?|weds?|thur?s?|fri|sat|sun)$", "i").test(em[2]);   // "in the sun" isn't a date
    if (em && !bareShort && (due = tbResolveDate_(em[2], today, dow))) s = s.slice(0, em.index) + em[1];
    else due = "";
  }

  // Title: what's left, without filler.
  let title = s.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    title = title.replace(/^[\s,.;:!?\-–—]+/, "")
      .replace(/^(?:hey|hi|please|pls|can you|could you|to|task|todo|new task)\b[\s,:\-–—]*/i, "")
      .replace(/[\s,;:\-–—]+(?:and|by|due|on|before|please|pls)$/i, "")
      .replace(/[\s,.;:!?\-–—]+$/, "").trim();
  }
  title = title.charAt(0).toUpperCase() + title.slice(1);
  const remind = tbRemindItems_(taken.specs, due, today, dow);
  return { title: title.slice(0, 140), titleTooLong: title.length > 140, due: due, remind: remind.items, remindNeedsDue: remind.needsDue, remindDropped: remind.dropped,
    ownerDiscordId: ownerDiscordId, ownerName: ownerName, assignees: assignees };
}

// Priority words in a quick add, the highest one wins. Whole words, any capitals ("!!" anywhere).
const TB_PRIORITY_WORDS = [
  ["urgent", /(^|[^\w@])(?:urgent|asap)(?![\w@])|!{2,}/gi],
  ["high", /(^|[^\w@])(?:high[\s-]+priority|important)(?![\w@])/gi],
  ["low", /(^|[^\w@])low[\s-]+priority(?![\w@])/gi]
];

/**
 * Quick add (one line typed in the Tasks tab): read like a message to @taskbot, after the priority words are taken out
 * ("urgent", "asap", "!!" → urgent; "high priority", "important" → high; "low priority" → low). "@Amy" also works for
 * Amy Lee when she is the only active person called Amy (as in updates). Pure, so the demo runs it in the browser too.
 * Returns parseTaskMessage_'s answer plus priority ("normal" when none was said) and owners: the People-list names of
 * everyone @mentioned ([] = nobody; the caller then gives it to the person adding it).
 */
function parseQuickTask_(text, now, team) {
  let s = " " + String(text || "") + " ", priority = "";
  TB_PRIORITY_WORDS.forEach(function (rule) {
    s = s.replace(rule[1], function (all, before) { priority = priority || rule[0]; return (before || "") + " "; });
  });
  if (priority) s = s.replace(/\(\s*\)|\[\s*\]/g, " ");   // "(urgent)" leaves "()"
  const key = function (name) { return String(name || "").replace(/\s+/g, " ").trim().toLowerCase(); };
  const rows = (team || []).filter(function (r) { return r && key(r.name); });
  const on = rows.filter(function (r) { return r.active === true || String(r.active).toUpperCase() === "TRUE"; });
  const firsts = {}, names = {};
  rows.forEach(function (r) { names[key(r.name)] = true; });
  on.forEach(function (r) { const f = key(r.name).split(" ")[0]; firsts[f] = (firsts[f] || 0) + 1; });
  const byFirst = on.filter(function (r) { const f = key(r.name).split(" ")[0]; return firsts[f] === 1 && !names[f]; })
    .map(function (r) { return { name: String(r.name).trim().split(/\s+/)[0], discordId: r.discordId, fullName: String(r.name).trim() }; });
  const parsed = parseTaskMessage_(s, now, rows.concat(byFirst), "");
  const owners = [];
  parsed.assignees.forEach(function (p) {
    const first = byFirst.filter(function (r) { return key(r.name) === key(p.name); })[0];
    const row = !p.name && p.discordId ? rows.filter(function (r) { return String(r.discordId || "") === p.discordId; })[0] : null;
    const name = first ? first.fullName : p.name ? String(p.name).trim() : row ? String(row.name).trim() : "";
    if (name && !owners.some(function (n) { return key(n) === key(name); })) owners.push(name);
  });
  parsed.priority = priority || "normal";
  parsed.owners = owners;
  return parsed;
}

// ---- Reminders ---------------------------------------------------------------------------------

/** A JSON-list cell (remindSent, discordRefs) as a list, whatever shape it comes back in. */
function taskList_(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { const list = JSON.parse(value); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}

/** One reminder { n, unit, at } tidied up, or null when it isn't one (n 0-60, unit days/weeks, at "HH:MM"; at defaults to 09:00). */
function taskReminderItem_(x) {
  if (!x || typeof x !== "object") return null;
  const nText = String(x.n === undefined || x.n === null ? "" : x.n).trim();
  if (!/^\d{1,2}$/.test(nText) || Number(nText) > 60) return null;
  const unit = String(x.unit || "days").trim().toLowerCase();
  if (["day", "days", "week", "weeks"].indexOf(unit) === -1) return null;
  const atText = String(x.at === undefined || x.at === null || x.at === "" ? "09:00" : x.at).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(atText);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return { n: Number(nText), unit: unit.charAt(0) === "w" ? "weeks" : "days", at: ("0" + Number(m[1])).slice(-2) + ":" + m[2] };
}

/** The same reminder twice counts once; at most 5 are kept. */
function taskReminderDedupe_(items) {
  const seen = {};
  return (items || []).filter(function (r) {
    const k = r.n + r.unit + "@" + r.at;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  }).slice(0, TASK_REMINDERS_MAX);
}

/**
 * A task's reminders as a list of { n, unit, at }. New rows hold that list. Older rows hold a word or a day, read like this
 * (each also keeps legacyKey, its old "already sent" key, so a reminder sent before the change isn't sent again):
 *   daybefore → 1 day before at 09:00; halfway → half the days from when it was made to the due date, at 09:00; both → both;
 *   a day → the days between that day and the due date, at 09:00. Without a due date the old words can't be worked out: [].
 */
function taskReminderList_(task) {
  let rule = task.remind;
  if (typeof rule === "string" && /^\s*\[/.test(rule)) { try { rule = JSON.parse(rule); } catch (e) { rule = []; } }
  if (Array.isArray(rule)) return taskReminderDedupe_(rule.map(taskReminderItem_).filter(Boolean));
  const word = String(rule || "").trim().toLowerCase();
  const due = isYmd_(task.due) ? String(task.due) : "";
  if (!word || !due) return [];
  const at = ("0" + TASK_REMINDER_HOUR).slice(-2) + ":00";
  const out = [];
  if (word === "halfway" || word === "both") {
    const made = Date.parse(task.createdAt);
    const from = isNaN(made) ? due : edmParts_(made).ymd;
    out.push({ n: Math.min(60, Math.floor(Math.max(0, ymdDiff_(from, due)) / 2)), unit: "days", at: at, legacyKey: "halfway@" + due });
  }
  if (word === "daybefore" || word === "both") out.push({ n: 1, unit: "days", at: at, legacyKey: "daybefore@" + due });
  if (isYmd_(word)) {
    const n = ymdDiff_(word, due);
    if (n >= 0 && n <= 60) out.push({ n: n, unit: "days", at: at, legacyKey: "day@" + word });
  }
  return taskReminderDedupe_(out);
}

/** The list as it is saved and shown: plain { n, unit, at } (no legacyKey). */
function taskReminderItems_(task) {
  return taskReminderList_(task).map(function (r) { return { n: r.n, unit: r.unit, at: r.at }; });
}

/** "2026-12-05|1days@09:00": includes the due date, so moving the due date makes fresh reminders. */
function taskReminderKey_(due, item) {
  return due + "|" + item.n + item.unit + "@" + item.at;
}

/** When a reminder goes out: n days/weeks before the due date, at its time, Calgary time. */
function taskReminderAt_(due, item) {
  const hm = String(item.at).split(":").map(Number);
  return edmAt_(ymdAdd_(due, -item.n * (item.unit === "weeks" ? 7 : 1)), hm[0], hm[1]);
}

/** Every reminder the task asks for: [{ key, legacyKey, at, item }]. None without a due date. */
function taskReminderSchedule_(task) {
  if (!isYmd_(task.due)) return [];
  const due = String(task.due);
  return taskReminderList_(task).map(function (r) {
    const item = { n: r.n, unit: r.unit, at: r.at };
    return { key: taskReminderKey_(due, item), legacyKey: r.legacyKey || "", at: taskReminderAt_(due, item), item: item };
  });
}

function taskReminderWasSent_(r, sent) {
  return sent.indexOf(r.key) !== -1 || (!!r.legacyKey && sent.indexOf(r.legacyKey) !== -1);
}

/** The reminders still to send (none for a done or removed task). */
function taskPendingReminders_(task) {
  if (task.removedAt || task.status === "done") return [];
  const sent = taskList_(task.remindSent);
  return taskReminderSchedule_(task).filter(function (r) { return !taskReminderWasSent_(r, sent); });
}

/** What the portal shows: [{ n, unit, at, when: "yyyy-MM-ddTHH:mm" ("" without a due date), sent }], in the saved order. */
function taskRemindersView_(task) {
  const sent = taskList_(task.remindSent);
  const byKey = {};
  taskReminderSchedule_(task).forEach(function (r) { byKey[r.item.n + r.item.unit + "@" + r.item.at] = r; });
  return taskReminderList_(task).map(function (r) {
    const s = byKey[r.n + r.unit + "@" + r.at];
    return { n: r.n, unit: r.unit, at: r.at, when: s ? taskStamp_(s.at) : "", sent: s ? taskReminderWasSent_(s, sent) : false };
  });
}

/** When the next reminder goes out (a time), or 0 for none. One that is a little late still counts: it goes out within a minute. */
function taskNextReminder_(task, nowMs) {
  return taskPendingReminders_(task).filter(function (r) { return r.at >= nowMs - TASK_REMINDER_STALE_MS; })
    .reduce(function (min, r) { return !min || r.at < min ? r.at : min; }, 0);
}

/**
 * The remindSent list after the reminders or the due date were set: one key per reminder of the task as it is now that
 * was already sent, or whose time is more than 10 minutes ago (so saving never sends a burst of old reminders; one set
 * for a few minutes ago still goes out). Keys for an old due date are dropped, so moving the due date re-arms them.
 * graceMs (default 10 minutes) = how late a reminder can be and still go out; 0 when a task leaves Done (none go out late).
 */
function taskSettledReminders_(task, nowMs, graceMs) {
  const sent = taskList_(task.remindSent);
  const grace = graceMs === undefined ? TASK_REMINDER_GRACE_MS : graceMs;
  const out = [];
  taskReminderSchedule_(task).forEach(function (r) {
    if ((taskReminderWasSent_(r, sent) || r.at <= nowMs - grace) && out.indexOf(r.key) === -1) out.push(r.key);
  });
  return out;
}

/**
 * CALL WHILE HOLDING THE SCRIPT LOCK (so two changes can't overwrite each other's answer). Keeps NEXT_TASK_REMINDER up to date
 * so the timer knows, without opening the sheet, whether anything is due. Never throws.
 */
function refreshNextReminder_() {
  try {
    const now = Date.now();
    const next = readRows_("Tasks").reduce(function (min, t) { const at = taskNextReminder_(t, now); return at && (!min || at < min) ? at : min; }, 0);
    const props = PropertiesService.getScriptProperties();
    if (next) props.setProperty("NEXT_TASK_REMINDER", new Date(next).toISOString());
    else props.deleteProperty("NEXT_TASK_REMINDER");
  } catch (err) { console.error("Couldn't work out the next task reminder: " + discordSafeError_(err)); }
}

/**
 * CALL WHILE HOLDING THE SCRIPT LOCK. Marks every reminder that is due as sent (saved first, so it can never go twice) and
 * returns the Discord posts to make AFTER the lock is released (see discordSendPosts_). A reminder more than a day late is
 * marked without posting. A post that then fails is noted on the task, not tried again.
 */
function takeDueReminders_(nowMs) {
  delete DB_.rows["Tasks"];
  const posts = [];
  readRows_("Tasks").forEach(function (task) {
    const due = taskPendingReminders_(task).filter(function (r) { return r.at <= nowMs; });
    if (!due.length) return;
    updateRow_("Tasks", task.id, { remindSent: taskList_(task.remindSent).concat(due.map(function (r) { return r.key; })) }, task._row);
    if (!due.some(function (r) { return r.at >= nowMs - TASK_REMINDER_STALE_MS; })) return;
    posts.push({
      content: "⏰ Reminder " + taskDiscordWho_(task) + ": **" + discordEscape_(task.title) + "**" +
        (task.due ? " is due " + taskDayText_(task.due) : "") + ". Reply with how it's going.",
      userIds: taskOwnerDiscordIds_(task), replyTo: task.discordMessageId, taskId: task.id, reminder: true
    });
  });
  return posts;
}

// ---- The every-minute timer ----------------------------------------------------------------------

/**
 * Runs every minute (the timer is added by hand, see the top of this file). Cheap when there's nothing to do: one Discord
 * read and a few Script Properties. Takes the script lock only when it has work, and never waits for it (if it's busy, the
 * next minute tries again), so ticks never pile up. Never talks to Discord while holding the lock. Never throws.
 */
function taskBotTick() {
  try {
    const props = PropertiesService.getScriptProperties();
    try { props.setProperty("TASKBOT_LAST_TICK", new Date().toISOString()); } catch (e) { /* only used for the "timer on" light */ }
    const setup = discordSetup_();
    if (!setup.posting) return;
    const next = Date.parse(props.getProperty("NEXT_TASK_REMINDER") || "");
    const reminderDue = !isNaN(next) && next <= Date.now();
    const pull = setup.reading ? discordPull_(setup, 1) : null;
    if (pull && pull.error) console.warn("taskBotTick: " + pull.error);
    if (!(pull && pull.relevant) && !reminderDue) {
      if (pull) discordMoveOn_(pull);   // nothing for us (chat, the bot's own posts): just move past it
      return;
    }
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(0)) return;
    let posts = [];
    try {
      if (pull && pull.relevant) posts = posts.concat(applyDiscordMessages_(pull).posts);
      else if (pull) discordMoveOn_(pull);
      if (reminderDue) posts = posts.concat(takeDueReminders_(Date.now()));
      refreshNextReminder_();
    } finally {
      lock.releaseLock();
    }
    discordSendPosts_(posts);   // after the lock is released
  } catch (err) {
    console.error("taskBotTick: " + discordSafeError_(err));
  }
}

/** Admin: is the bot running? { ok, timer, lastTick, posting, reading, botName }. timer = it ran in the last 5 minutes. No secrets. */
function taskBotStatus_() {
  const setup = discordSetup_();
  const lastTick = String(PropertiesService.getScriptProperties().getProperty("TASKBOT_LAST_TICK") || "");
  const at = Date.parse(lastTick);
  return {
    ok: true, timer: !isNaN(at) && Date.now() - at < TASKBOT_ALIVE_MS, lastTick: isNaN(at) ? "" : lastTick,
    posting: setup.posting, reading: setup.reading, botName: setup.reading ? discordBotUser_(setup).name : ""
  };
}
