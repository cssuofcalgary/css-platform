/**
 * CSS Platform API — settings (admin only) and the health check.
 *
 * Everything that used to need Apps Script → Script Properties can be changed here
 * from the Exec Portal: passwords, the e-transfer address, the contact email,
 * the Instagram link and which Membership sheet to read. Passwords are never sent
 * back to the page; it only learns whether one is set.
 */

const MIN_PASSWORD_LENGTH = 8;

/** The contact details shown at the bottom of every public page. */
function siteInfo_() {
  const config = getConfig_();
  return { contactEmail: config.contactEmail, instagramUrl: config.instagramUrl };
}

/** What the Settings tab shows. Never includes a password. */
function getSettings_() {
  const config = getConfig_();
  const props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    settings: {
      etransferEmail: config.etransferEmail,
      contactEmail: config.contactEmail,
      instagramUrl: config.instagramUrl,
      membershipSheetId: config.membershipSheetId,
      membershipTab: config.membershipTab,
      execPasswordSet: !!config.password,
      adminPasswordSet: !!config.adminPassword,
      doorPasswordSet: !!props.getProperty("SCANNER_PASSWORD"),
      publicSiteUrl: props.getProperty("PUBLIC_SITE_URL") || ""
    }
  };
}

/**
 * Saves the fields that were sent (others are left alone). Checks each one first, and tests
 * a new Membership sheet by really reading it before switching to it.
 * Changing a password signs everyone out (the admin making the change gets a fresh session).
 */
function saveSettings_(session, token, input) {
  input = input || {};
  const props = PropertiesService.getScriptProperties();
  const config = getConfig_();
  const updates = {};      // property → new value
  const changed = [];
  const emailOk = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); };
  const text = function (v, max) { return String(v === undefined || v === null ? "" : v).trim().slice(0, max); };
  let notes = "";

  if (input.etransferEmail !== undefined) {
    const v = text(input.etransferEmail, 120).toLowerCase();
    if (!emailOk(v)) throw new ApiError_("BAD_REQUEST", "The e-transfer email doesn't look right.");
    if (v !== config.etransferEmail) { updates.ETRANSFER_EMAIL = v; changed.push("e-transfer email"); }
  }
  if (input.contactEmail !== undefined) {
    const v = text(input.contactEmail, 120).toLowerCase();
    if (!emailOk(v)) throw new ApiError_("BAD_REQUEST", "The contact email doesn't look right.");
    if (v !== config.contactEmail) { updates.CONTACT_EMAIL = v; changed.push("contact email"); }
  }
  if (input.instagramUrl !== undefined) {
    const v = text(input.instagramUrl, 200);
    if (!/^https:\/\/[^\s"<>]+$/.test(v)) throw new ApiError_("BAD_REQUEST", "The Instagram link should start with https://");
    if (v !== config.instagramUrl) { updates.INSTAGRAM_URL = v; changed.push("Instagram link"); }
  }

  if (input.membershipSheet !== undefined || input.membershipTab !== undefined) {
    const id = input.membershipSheet !== undefined ? extractSheetId_(text(input.membershipSheet, 300)) : config.membershipSheetId;
    const tab = input.membershipTab !== undefined ? text(input.membershipTab, 80) : config.membershipTab;
    if (!id) throw new ApiError_("BAD_REQUEST", "Paste the Membership sheet's link or ID.");
    if (id !== config.membershipSheetId || tab !== config.membershipTab) {
      const found = testMembershipSheet_(id, tab);   // throws a plain-English error if it can't be read
      updates.MEMBERSHIP_SHEET_ID = id;
      updates.MEMBERSHIP_TAB = tab || "Form Responses 1";
      changed.push("Membership sheet");
      notes = "Found " + found.members + " members (" + found.paid + " paid).";
    }
  }

  let newPasswords = 0;
  const exec = input.execPassword !== undefined && input.execPassword !== "" ? String(input.execPassword) : "";
  const admin = input.adminPassword !== undefined && input.adminPassword !== "" ? String(input.adminPassword) : "";
  [["exec password", exec], ["admin password", admin]].forEach(function (p) {
    if (p[1] && p[1].length < MIN_PASSWORD_LENGTH) {
      throw new ApiError_("BAD_REQUEST", "The " + p[0] + " needs at least " + MIN_PASSWORD_LENGTH + " characters.");
    }
  });
  if ((exec || config.password) === (admin || config.adminPassword)) {
    throw new ApiError_("BAD_REQUEST", "The exec and admin passwords must be different.");
  }
  if (exec) { updates.EXEC_PASSWORD = exec; changed.push("exec password"); newPasswords++; }
  if (admin) { updates.ADMIN_PASSWORD = admin; changed.push("admin password"); newPasswords++; }

  // Door password: optional extra password for door volunteers who sign in with just a name
  const door = input.doorPassword !== undefined && input.doorPassword !== "" ? String(input.doorPassword) : "";
  if (door) {
    if (door.length < 4) throw new ApiError_("BAD_REQUEST", "The door password needs at least 4 characters.");
    if (door === (exec || config.password) || door === (admin || config.adminPassword)) throw new ApiError_("BAD_REQUEST", "The door password must be different from the exec and admin passwords.");
    updates.SCANNER_PASSWORD = door; changed.push("door password");
  }
  const clearDoor = input.clearDoorPassword === true && !door;
  if (clearDoor) changed.push("door password removed");

  if (!changed.length) return { ok: true, changed: [], message: "Nothing to change." };

  withLock_(function () {
    props.setProperties(updates);
    if (clearDoor) props.deleteProperty("SCANNER_PASSWORD");
    if (updates.MEMBERSHIP_SHEET_ID || updates.MEMBERSHIP_TAB) {
      const cache = CacheService.getScriptCache();
      ["members_count", "members_old_count"].forEach(function (k) { cache.remove(k); });   // force a fresh read
    }
    log_(session.name, "settings.save", "", { changed: changed });   // names only, never values
  });

  const reply = { ok: true, changed: changed, message: notes };
  if (newPasswords) {
    signOutEveryone_();
    reply.token = startSession_(session.name, session.role);   // the admin stays signed in
    reply.signedOutEveryone = true;
  }
  return reply;
}

/** Reads a Membership sheet the same way the portal does, so a wrong link is caught before saving. */
function testMembershipSheet_(id, tab) {
  let spreadsheet;
  try {
    spreadsheet = retry_(function () { return SpreadsheetApp.openById(id); });
  } catch (err) {
    throw new ApiError_("BAD_REQUEST", "Couldn't open that sheet. Check the link, and that the CSS Google account can see it.");
  }
  const sheet = tab ? spreadsheet.getSheetByName(tab) : (spreadsheet.getSheetByName("Form Responses 1") || spreadsheet.getSheets()[0]);
  if (!sheet) {
    const names = spreadsheet.getSheets().map(function (s) { return s.getName(); }).join(", ");
    throw new ApiError_("BAD_REQUEST", "That sheet has no tab called \"" + tab + "\". Its tabs are: " + names + ".");
  }
  const members = rowsToMembers_(sheet.getDataRange().getValues());
  if (!members.length) throw new ApiError_("BAD_REQUEST", "That tab has no member rows. Is it the right tab?");
  return { members: members.length, paid: members.filter(function (m) { return m.paid; }).length };
}

// ---- Sessions ----------------------------------------------------------------

/** Signs everyone out (all sessions carry the epoch they were made in). */
function signOutEveryone_() {
  PropertiesService.getScriptProperties().setProperty("SESSION_EPOCH", Utilities.getUuid().slice(0, 8));
}

function currentEpoch_() {
  return PropertiesService.getScriptProperties().getProperty("SESSION_EPOCH") || "0";
}

/** "Sign everyone out" button: admin only. The admin gets a fresh session so they aren't kicked too. */
function signOutAll_(session) {
  signOutEveryone_();
  log_(session.name, "sessions.clear", "", {});
  return { ok: true, token: startSession_(session.name, session.role) };
}

// ---- Health check ------------------------------------------------------------

function healthCheck_(session) {
  const checks = [];
  const time = function (fn) { const t = Date.now(); const out = fn(); return { out: out, ms: Date.now() - t }; };
  const run = function (name, fn) {
    try {
      const r = time(fn);
      checks.push({ name: name, ok: true, detail: r.out + " (" + r.ms + " ms)" });
    } catch (err) {
      checks.push({ name: name, ok: false, detail: String(err && err.message || err) });
    }
  };

  run("Platform data sheet", function () {
    return "Events " + readRows_("Events").length + " · Orders " + readRows_("Orders").length + " · Tickets " + readRows_("Tickets").length;
  });
  run("Membership sheet", function () {
    const members = loadMembers_();
    return members.length + " members (" + members.filter(function (m) { return m.paid; }).length + " paid)";
  });
  run("Nightly backup", backupStatus_);
  run("Archive", archiveStatus_);
  run("Email allowance", function () {
    const left = MailApp.getRemainingDailyQuota();
    if (left < 15) throw new Error("Only " + left + " emails left today.");
    return left + " emails left today";
  });

  let lastError = null;
  try { lastError = JSON.parse(PropertiesService.getScriptProperties().getProperty("LAST_ERROR") || "null"); } catch (e) { /* none */ }
  const config = getConfig_();
  // A manual run (from the portal) is written to the Log, so Activity shows who checked and what they found. The nightly job passes no session and logs nothing.
  if (session) log_(session.name, "health.check", "", { problems: checks.filter(function (c) { return !c.ok; }).length + (lastError ? 1 : 0) });
  return {
    ok: true,
    version: API_VERSION,
    checks: checks,
    lastError: lastError,
    setup: {
      execPassword: !!config.password,
      adminPassword: !!config.adminPassword,
      publicSiteUrl: PropertiesService.getScriptProperties().getProperty("PUBLIC_SITE_URL") || ""
    }
  };
}

/** Remembers the last unexpected error, so the health check can show it. */
function rememberError_(action, err) {
  try {
    PropertiesService.getScriptProperties().setProperty("LAST_ERROR", JSON.stringify({
      time: new Date().toISOString(), action: String(action || ""), message: String(err && err.message || err).slice(0, 300)
    }));
  } catch (e) { /* not worth failing over */ }
}
