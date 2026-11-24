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
 *   MEMBERSHIP_YEAR      Year shown to members, e.g. 2026/2027. Blank: September–August from today's date.
 *   ETRANSFER_EMAIL      Where people send e-transfers. Default: css.uofcalgary@gmail.com.
 *   MEMBERSHIP_FEE       The yearly membership fee in dollars. Default: 12.
 *   CONTACT_EMAIL, INSTAGRAM_URL   Shown at the bottom of the public pages.
 *
 * All of these (and both passwords) can also be changed from the Exec Portal's Settings tab (admin only).
 *
 * Card payments through Square (optional; without both of the first two, only e-transfer is offered):
 *   SQUARE_ACCESS_TOKEN  The Square access token. Secret: never shown, logged or sent to a page.
 *   SQUARE_LOCATION_ID   The Square location the payments go to.
 *   SQUARE_ENV           "sandbox" for Square's test mode. Blank: real payments.
 *   SQUARE_PASS_FEE      "true" adds the club's adjustable Square usage fee. Off by default.
 *   SQUARE_FEE_PERCENT   Usage fee percentage of the outstanding ticket amount. Default: 0.
 *   SQUARE_FEE_FIXED     Flat usage fee in dollars per Square checkout. Default: 0.
 *
 * Set automatically by the system (don't edit): DATA_SHEET_ID, IMAGE_FOLDER_ID.
 */

const API_VERSION = "0.26.0";
const MEMBER_CACHE_SECONDS = 300;   // search data is re-read from the sheet at most every 5 min
const SESSION_SECONDS = 21600;      // signed out after 6 h without use (the Apps Script cache maximum)
const SESSION_RENEW_MS = 600000;    // while in use, those 6 h restart at most this often
const REMINDER_AFTER_HOURS = 48;   // an unpaid order gets a "please pay" reminder after this long (and again after this long)
const MAX_FAILED_LOGINS = 30;       // after this many wrong passwords in 10 min, new sign-ins pause for 10 min (people already signed in are unaffected)

const DEFAULT_MEMBERSHIP_FEE = 12;   // until a fee is saved in Settings → Membership
const DEFAULT_SQUARE_FEE_PERCENT = 0;
const DEFAULT_SQUARE_FEE_FIXED = 0;

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const fee = String(props.getProperty("MEMBERSHIP_FEE") || "").trim();
  return {
    membershipSheetId: extractSheetId_(props.getProperty("MEMBERSHIP_SHEET_ID")),
    membershipTab: String(props.getProperty("MEMBERSHIP_TAB") || "Form Responses 1").trim(),
    membershipYear: String(props.getProperty("MEMBERSHIP_YEAR") || "").trim(),
    password: String(props.getProperty("EXEC_PASSWORD") || ""),
    adminPassword: String(props.getProperty("ADMIN_PASSWORD") || ""),
    etransferEmail: String(props.getProperty("ETRANSFER_EMAIL") || "css.uofcalgary@gmail.com").trim(),
    contactEmail: String(props.getProperty("CONTACT_EMAIL") || "css.uofcalgary@gmail.com").trim(),
    instagramUrl: String(props.getProperty("INSTAGRAM_URL") || "https://www.instagram.com/ucalgary.css/").trim(),
    membershipFee: fee !== "" && isFinite(Number(fee)) && Number(fee) >= 0 ? Number(fee) : DEFAULT_MEMBERSHIP_FEE
  };
}

/**
 * The Square settings (Square.js). Kept apart from getConfig_ so the token is only ever read where a Square call is made.
 * `enabled` = both the token and the location are set, so the pages may offer "Pay by card".
 */
function squareConfig_() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty("SQUARE_ACCESS_TOKEN") || "").trim();
  const locationId = String(props.getProperty("SQUARE_LOCATION_ID") || "").trim();
  const sandbox = String(props.getProperty("SQUARE_ENV") || "").trim().toLowerCase() === "sandbox";
  const passRaw = String(props.getProperty("SQUARE_PASS_FEE") || "").trim().toLowerCase();
  const pctRaw = String(props.getProperty("SQUARE_FEE_PERCENT") || "").trim();
  const fixRaw = String(props.getProperty("SQUARE_FEE_FIXED") || "").trim();
  const pct = pctRaw !== "" && isFinite(Number(pctRaw)) && Number(pctRaw) >= 0 && Number(pctRaw) <= 10 ? Number(pctRaw) : DEFAULT_SQUARE_FEE_PERCENT;
  const fix = fixRaw !== "" && isFinite(Number(fixRaw)) && Number(fixRaw) >= 0 && Number(fixRaw) <= 5 ? Number(fixRaw) : DEFAULT_SQUARE_FEE_FIXED;
  return {
    token: token,
    locationId: locationId,
    environment: sandbox ? "sandbox" : "production",
    base: sandbox ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com",
    enabled: !!(token && locationId),
    passFee: passRaw === "true",
    feePercent: pct,
    feeFixed: fix
  };
}

/** True when pages may offer "Pay by card". Never throws: a problem here just means e-transfer only. */
function cardEnabled_() {
  try { return squareConfig_().enabled; } catch (e) { return false; }
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
