/**
 * CSS Platform API — settings.
 *
 * Nothing in this file needs editing. Everything that can change lives in
 * Apps Script → Project Settings → Script Properties:
 *
 *   MEMBERSHIP_SHEET_ID  The Membership spreadsheet (its ID or full link).    Required.
 *   EXEC_PASSWORD        The shared exec password for the Exec Portal.        Required.
 *   ADMIN_PASSWORD       Admin password: everything execs can do, plus admin-only tools. Optional.
 *   MEMBERSHIP_TAB       Tab with the member rows. Default: "Form Responses 1".
 *   ETRANSFER_EMAIL      Where people send e-transfers. Default: css.uofcalgary@gmail.com.
 *   CONTACT_EMAIL, INSTAGRAM_URL   Shown at the bottom of the public pages.
 *
 * All of these (and both passwords) can also be changed from the Exec Portal's Settings tab (admin only).
 *
 * Set automatically by the system (don't edit): DATA_SHEET_ID, IMAGE_FOLDER_ID.
 */

const API_VERSION = "0.14.0";
const MEMBER_CACHE_SECONDS = 300;   // search data is re-read from the sheet at most every 5 min
const SESSION_SECONDS = 21600;      // stay logged in for 6 h (the Apps Script cache maximum)
const REMINDER_AFTER_HOURS = 48;   // an unpaid order gets a "please pay" reminder after this long (and again after this long)
const MAX_FAILED_LOGINS = 30;       // after this many wrong passwords in 10 min, new sign-ins pause for 10 min (people already signed in are unaffected)

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    membershipSheetId: extractSheetId_(props.getProperty("MEMBERSHIP_SHEET_ID")),
    membershipTab: String(props.getProperty("MEMBERSHIP_TAB") || "Form Responses 1").trim(),
    password: String(props.getProperty("EXEC_PASSWORD") || ""),
    adminPassword: String(props.getProperty("ADMIN_PASSWORD") || ""),
    etransferEmail: String(props.getProperty("ETRANSFER_EMAIL") || "css.uofcalgary@gmail.com").trim(),
    contactEmail: String(props.getProperty("CONTACT_EMAIL") || "css.uofcalgary@gmail.com").trim(),
    instagramUrl: String(props.getProperty("INSTAGRAM_URL") || "https://www.instagram.com/ucalgary.css/").trim()
  };
}

/**
 * Run this once from the editor (select "checkSetup" → Run) after setting the
 * Script Properties. It asks Google for read-only access, then reports what it found.
 */
function checkSetup() {
  const config = getConfig_();
  if (!config.membershipSheetId) throw new Error("Add MEMBERSHIP_SHEET_ID in Project Settings → Script Properties.");
  if (!config.password) throw new Error("Add EXEC_PASSWORD in Project Settings → Script Properties.");
  CacheService.getScriptCache().remove("members_count");
  const members = loadMembers_();
  const paid = members.filter(function (m) { return m.paid; }).length;
  Object.keys(TABLES).forEach(table_);   // creates the platform's data sheet + tabs if missing
  imageFolder_();
  console.log("✅ Setup OK: found " + members.length + " members (" + paid + " paid) in \"" + config.membershipTab + "\".");
  console.log("✅ Platform data: " + dataSpreadsheet_().getUrl());
}

/** Accepts either a bare spreadsheet ID or a full docs.google.com link. */
function extractSheetId_(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : raw;
}
