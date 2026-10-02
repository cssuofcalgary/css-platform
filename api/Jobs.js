/**
 * CSS Platform API — background jobs.
 *
 * Two timers, added once by hand in Apps Script → Triggers (clock icon) → Add Trigger (a script can't
 * add its own without an extra permission that broke the web app once):
 *   nightlyJob  every night around 3 am: checks that everything is healthy and emails the CSS Gmail
 *               only if something is wrong. On Sundays it also backs up the Platform Data sheet and the
 *               Membership sheet (keeps the last 4 of each; older ones go to the Drive bin).
 *   hourlyJob   every hour: closes entry for events that ended a few hours ago, so a forgotten
 *               "Entry open" switch can't stay on.
 * Both write to the Log as "system". Nothing here emails members.
 */

const BACKUP_FOLDER_NAME = "CSS Platform Backups";
const BACKUPS_KEPT = 4;            // weekly copies kept of each sheet; older ones go to the Drive bin
const BACKUP_DAY = "7";            // the backup runs on this weekday during the nightly job (ISO: 7 = Sunday, about 3 am)
const ENTRY_AUTOCLOSE_HOURS = 4;   // entry closes this long after an event's end time (after its start time if there is no end time)
const BACKUP_STALE_HOURS = 216;    // the health check complains when the last good backup is older than this (9 days: one weekly miss is tolerated)

/**
 * Run from the editor to take a backup and run the health check right now (also a good test).
 * The timers are added by hand: Triggers → Add Trigger →
 *   nightlyJob: Head deployment, Time-driven, Day timer, 3am to 4am
 *   hourlyJob:  Head deployment, Time-driven, Hour timer, Every hour
 */
function installJobs() {
  nightlyJob(true);
  console.log("Backup and check done. Now add the two timers: Triggers (clock icon) → Add Trigger → nightlyJob (Day timer, 3am-4am) and hourlyJob (Hour timer, every hour).");
}

// ---- Nightly: backup + health alert --------------------------------------------

/** The timer stays nightly (health check + archive); the backup itself only runs on BACKUP_DAY, or when forced (run by hand). */
function nightlyJob(forceBackup) {
  const problems = [];
  const weekday = Utilities.formatDate(new Date(), "America/Edmonton", "u");
  if (forceBackup === true || weekday === BACKUP_DAY) {
    try {
      const result = backupNow_();
      log_("system", "backup", "", { file: result.name, kept: result.kept });
    } catch (err) {
      rememberBackup_(false, String(err && err.message || err));
      problems.push("The weekly backup failed: " + String(err && err.message || err));
    }
  }

  // Move events that finished more than 30 days ago into the yearly archive (after the backup, so the backup still has them)
  try {
    const moved = archiveOldEvents_();
    if (moved.length) log_("system", "archive.done", "", { events: moved });
  } catch (err) {
    problems.push("Archiving old events failed: " + String(err && err.message || err));
  }

  try {
    healthCheck_().checks.forEach(function (c) { if (!c.ok) problems.push(c.name + ": " + c.detail); });
  } catch (err) {
    problems.push("The health check itself failed: " + String(err && err.message || err));
  }
  const recent = recentError_(24);
  if (recent) problems.push("An error in the last day (" + recent.action + "): " + recent.message);

  if (problems.length) {
    try { sendAlert_(problems); } catch (err) { console.error("Alert email failed: " + err.message); }   // never let the alert break the job
  }
}

/**
 * Copies the Platform Data sheet and the Membership sheet into the backup folder, and bins the oldest
 * copies of each beyond BACKUPS_KEPT. The data sheet is copied first; if the Membership copy fails
 * (e.g. the script can't open that file), the failure is reported but the data backup stays.
 */
function backupNow_() {
  const folder = backupFolder_();
  const today = Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");

  const data = copyAndPrune_(dataSpreadsheet_().getId(), folder, "CSS Backup ", today);
  let membership = null, membershipError = "";
  try {
    membership = copyAndPrune_(getConfig_().membershipSheetId, folder, "CSS Membership Backup ", today);
  } catch (err) {
    membershipError = String(err && err.message || err);
  }

  if (membershipError) {
    rememberBackup_(false, data.name + " saved, but the Membership backup failed: " + membershipError);
    throw new Error("Platform Data was backed up, but the Membership sheet was not: " + membershipError);
  }
  rememberBackup_(true, data.name + " + " + membership.name + " (" + data.kept + " kept each)");
  return { name: data.name + " + " + membership.name, kept: data.kept };
}

/** One copy per day per sheet (running twice replaces that day's copy); older copies with the same prefix beyond BACKUPS_KEPT go to the Drive bin. */
function copyAndPrune_(sourceId, folder, prefix, today) {
  const name = prefix + today;
  const source = DriveApp.getFileById(sourceId);

  const same = folder.getFilesByName(name);
  while (same.hasNext()) same.next().setTrashed(true);
  source.makeCopy(name, folder);

  const files = [];
  const all = folder.getFiles();
  while (all.hasNext()) {
    const f = all.next();
    if (f.getName().indexOf(prefix) === 0) files.push({ file: f, time: f.getDateCreated().getTime() });
  }
  files.sort(function (a, b) { return b.time - a.time; });
  files.slice(BACKUPS_KEPT).forEach(function (x) { x.file.setTrashed(true); });   // goes to the Drive bin, not gone for good
  return { name: name, kept: Math.min(files.length, BACKUPS_KEPT) };
}

function backupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty("BACKUP_FOLDER_ID");
  if (saved) {
    try { return DriveApp.getFolderById(saved); } catch (e) { /* deleted: make a new one */ }
  }
  const found = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty("BACKUP_FOLDER_ID", folder.getId());
  return folder;
}

function rememberBackup_(ok, detail) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("LAST_BACKUP", JSON.stringify({ time: new Date().toISOString(), ok: ok, detail: String(detail).slice(0, 200) }));
  if (ok) props.setProperty("LAST_GOOD_BACKUP", new Date().toISOString());
}

/** For the health check: how old is the last good backup? Throws (= shows red) if there isn't a recent one. */
function backupStatus_() {
  const props = PropertiesService.getScriptProperties();
  const good = props.getProperty("LAST_GOOD_BACKUP");
  if (!good) throw new Error("No backup yet. In Apps Script run installJobs once, then add the two timers under Triggers.");
  const hours = (Date.now() - new Date(good).getTime()) / 3600000;
  if (hours > BACKUP_STALE_HOURS) throw new Error("Last good backup was " + Math.round(hours) + " hours ago. Check the timers in Apps Script (Triggers).");
  let detail = "";
  try {
    const last = JSON.parse(props.getProperty("LAST_BACKUP") || "{}");
    detail = last.detail || "";
    if (last.ok === false) throw new Error("The last backup had a problem: " + detail);   // e.g. the Membership sheet couldn't be copied
  } catch (e) { if (/last backup had a problem/.test(e.message)) throw e; }
  return "last backup " + Utilities.formatDate(new Date(good), "America/Edmonton", "MMM d, h:mm a") + (detail ? " · " + detail : "");
}

function recentError_(hours) {
  try {
    const e = JSON.parse(PropertiesService.getScriptProperties().getProperty("LAST_ERROR") || "null");
    if (e && (Date.now() - new Date(e.time).getTime()) / 3600000 < hours) return e;
  } catch (err) { /* none */ }
  return null;
}

/** One alert email a day at most, to the CSS Gmail itself. */
function sendAlert_(problems) {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");
  if (props.getProperty("ALERT_SENT_DAY") === today) return;
  const to = getConfig_().contactEmail;   // the CSS Gmail (Settings → contact email)
  if (!to || !canSendMail_(to)) return;
  MailApp.sendEmail({
    to: to,
    subject: "CSS Platform: something needs a look",
    body: "The nightly check found:\n\n- " + problems.join("\n- ") +
      "\n\nOpen the Exec Portal, go to Settings, and press Health check for the details." +
      "\nIf it says to check the timers: Apps Script → Triggers (clock icon)."
  });
  props.setProperty("ALERT_SENT_DAY", today);
}

// ---- Hourly: close entry on finished events ---------------------------------------

function hourlyJob() {
  closeFinishedEntries_();
}

/** The moment an event is over, in the club's time zone. A missing end time falls back to the start time, then to the end of the day. */
function eventEndsAt_(event) {
  const time = event.endTime || event.startTime || "23:59";
  const d = Utilities.parseDate(String(event.date) + " " + String(time).slice(0, 5), "America/Edmonton", "yyyy-MM-dd HH:mm");
  return d.getTime();
}

function closeFinishedEntries_() {
  let closed = 0;
  allEvents_().forEach(function (e) {
    if (!e.entryOpen || !e.date) return;
    let ends;
    try { ends = eventEndsAt_(e); } catch (err) { return; }
    if (isNaN(ends) || Date.now() < ends + ENTRY_AUTOCLOSE_HOURS * 3600000) return;   // unreadable time: leave it alone
    withLock_(function () {
      updateRow_("Events", e.id, { entryOpen: false, updatedBy: "system", updatedAt: new Date().toISOString() });
      log_("system", "entry.autoclose", e.id, { name: e.name });
    });
    closed++;
  });
  return closed;
}
