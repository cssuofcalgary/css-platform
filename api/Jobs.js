/**
 * CSS Platform API — background jobs.
 *
 * Two timers, set up once by running `installJobs` in the Apps Script editor:
 *   nightlyJob  every night around 3 am: copies the data sheet (backup), checks that everything
 *               is healthy, and emails the CSS Gmail only if something is wrong.
 *   hourlyJob   every hour: closes entry for events that ended a few hours ago, so a forgotten
 *               "Entry open" switch can't stay on.
 * Both write to the Log as "system". Nothing here emails members.
 */

const BACKUP_FOLDER_NAME = "CSS Platform Backups";
const BACKUPS_KEPT = 14;
const ENTRY_AUTOCLOSE_HOURS = 4;   // entry closes this long after an event's end time (after its start time if there is no end time)
const BACKUP_STALE_HOURS = 36;     // the health check complains when the last good backup is older than this

/** Run once from the editor (and again any time you want to reset the timers). */
function installJobs() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === "nightlyJob" || fn === "hourlyJob") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("nightlyJob").timeBased().everyDays(1).atHour(3).inTimezone("America/Edmonton").create();
  ScriptApp.newTrigger("hourlyJob").timeBased().everyHours(1).create();
  console.log("Timers set: nightlyJob (3 am) and hourlyJob (every hour).");
  nightlyJob();   // also take the first backup now, so you can see it worked
}

// ---- Nightly: backup + health alert --------------------------------------------

function nightlyJob() {
  const problems = [];
  try {
    const result = backupNow_();
    log_("system", "backup", "", { file: result.name, kept: result.kept });
  } catch (err) {
    rememberBackup_(false, String(err && err.message || err));
    problems.push("The nightly backup failed: " + String(err && err.message || err));
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

/** Copies the data sheet into the backup folder and deletes the oldest copies beyond BACKUPS_KEPT. */
function backupNow_() {
  const source = DriveApp.getFileById(dataSpreadsheet_().getId());
  const folder = backupFolder_();
  const today = Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");
  const name = "CSS Platform Data backup " + today;

  // One backup per day: running the job twice replaces that day's copy
  const same = folder.getFilesByName(name);
  while (same.hasNext()) same.next().setTrashed(true);
  source.makeCopy(name, folder);

  const files = [];
  const all = folder.getFiles();
  while (all.hasNext()) { const f = all.next(); files.push({ file: f, time: f.getDateCreated().getTime() }); }
  files.sort(function (a, b) { return b.time - a.time; });
  files.slice(BACKUPS_KEPT).forEach(function (x) { x.file.setTrashed(true); });   // goes to the Drive bin, not gone for good

  const kept = Math.min(files.length, BACKUPS_KEPT);
  rememberBackup_(true, name + " (" + kept + " kept)");
  return { name: name, kept: kept };
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
  if (!good) throw new Error("No backup yet. Run installJobs once in the Apps Script editor.");
  const hours = (Date.now() - new Date(good).getTime()) / 3600000;
  if (hours > BACKUP_STALE_HOURS) throw new Error("Last good backup was " + Math.round(hours) + " hours ago. Check the timers in Apps Script (Triggers).");
  let detail = "";
  try { detail = JSON.parse(props.getProperty("LAST_BACKUP") || "{}").detail || ""; } catch (e) { /* none */ }
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
