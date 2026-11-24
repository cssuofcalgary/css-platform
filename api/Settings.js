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
function getSettings_(token) {
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
      membershipYear: config.membershipYear,
      membershipFee: config.membershipFee,
      peopleLocked: peopleLocked_(),
      execPasswordSet: !!config.password,
      adminPasswordSet: !!config.adminPassword,
      doorPasswordSet: !!props.getProperty("SCANNER_PASSWORD"),
      publicSiteUrl: props.getProperty("PUBLIC_SITE_URL") || "",
      squareConfigured: cardEnabled_(),   // card payments: whether they are on, never the token itself
      squareEnvironment: squareConfig_().environment,
      squareLocationId: squareConfig_().locationId,   // not a secret: it only names the shop
      squareTokenSet: !!squareConfig_().token
    },
    activeSessions: activeSessions_(token)   // who is online right now (no tokens)
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

  if (input.peopleLocked !== undefined) {
    if (typeof input.peopleLocked !== "boolean") throw new ApiError_("BAD_REQUEST", "Choose whether the People list is locked.");
    if (input.peopleLocked !== peopleLocked_()) { updates.PEOPLE_LOCKED = String(input.peopleLocked); changed.push("People list lock"); }
  }

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

  if (input.membershipYear !== undefined) {
    const year = String(input.membershipYear === null ? "" : input.membershipYear).trim();
    const parts = year.match(/^([1-9]\d{3})\/([1-9]\d{3})$/);
    if (year && (!parts || Number(parts[2]) !== Number(parts[1]) + 1)) {
      throw new ApiError_("BAD_REQUEST", "The membership year should look like 2026/2027, with two years in a row.");
    }
    if (year !== config.membershipYear) { updates.MEMBERSHIP_YEAR = year; changed.push("membership year"); }
  }

  if (input.membershipFee !== undefined) {
    const raw = text(input.membershipFee, 20).replace(/^\$\s*/, "");
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(raw) || Number(raw) > 1000) throw new ApiError_("BAD_REQUEST", "The membership fee should be an amount like 12 or 12.50.");
    if (Number(raw) !== config.membershipFee) { updates.MEMBERSHIP_FEE = String(Number(raw)); changed.push("membership fee"); }
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

  // Card payments (Square). The access token is never sent back; blank = keep the saved one. New keys are tested with Square first.
  const clearSquare = input.clearSquare === true;
  if (clearSquare) {
    if (squareConfig_().token || squareConfig_().locationId) changed.push("card payments turned off");
  } else if (input.squareAccessToken !== undefined || input.squareLocationId !== undefined || input.squareEnvironment !== undefined) {
    const now = squareConfig_();
    const token = input.squareAccessToken ? String(input.squareAccessToken).trim() : now.token;
    const location = input.squareLocationId !== undefined ? text(input.squareLocationId, 64) : now.locationId;
    const env = input.squareEnvironment !== undefined ? String(input.squareEnvironment) : now.environment;
    if (env !== "sandbox" && env !== "production") throw new ApiError_("BAD_REQUEST", "Choose real payments or Square's test mode.");
    if (input.squareAccessToken && !/^[A-Za-z0-9_\-]{20,300}$/.test(token)) throw new ApiError_("BAD_REQUEST", "That access token doesn't look right. Copy it again from Square's Developer Dashboard.");
    if (location && !/^[A-Za-z0-9_\-]{4,64}$/.test(location)) throw new ApiError_("BAD_REQUEST", "That location ID doesn't look right. Copy it again from Square.");
    const squareChanged = token !== now.token || location !== now.locationId || env !== now.environment;
    if (squareChanged) {
      if (!token || !location) throw new ApiError_("BAD_REQUEST", "Card payments need both the access token and the location ID.");
      testSquareKeys_(token, location, env);   // throws a plain-English error if Square says no
      updates.SQUARE_ACCESS_TOKEN = token;
      updates.SQUARE_LOCATION_ID = location;
      updates.SQUARE_ENV = env === "sandbox" ? "sandbox" : "";
      changed.push("card payments (Square)");
      notes = env === "sandbox" ? "Card payments are on in Square's test mode." : "Card payments are on.";
    }
  }

  if (!changed.length) return { ok: true, changed: [], message: "Nothing to change." };

  withLock_(function () {
    props.setProperties(updates);
    if (clearDoor) props.deleteProperty("SCANNER_PASSWORD");
    if (clearSquare) ["SQUARE_ACCESS_TOKEN", "SQUARE_LOCATION_ID", "SQUARE_ENV"].forEach(function (k) { props.deleteProperty(k); });
    if (door || clearDoor) {
      props.setProperty("DOOR_SESSION_EPOCH", Utilities.getUuid().slice(0, 8));
      CacheService.getScriptCache().remove("failed_shared_door");
    }
    if (updates.MEMBERSHIP_SHEET_ID || updates.MEMBERSHIP_TAB) {
      const cache = CacheService.getScriptCache();
      ["members_count", "members_old_count"].forEach(function (k) { cache.remove(k); });   // force a fresh read
    }
    log_(session.name, "settings.save", "", { changed: changed });   // names only, never values
  });

  const reply = { ok: true, changed: changed, message: notes, membershipFee: updates.MEMBERSHIP_FEE !== undefined ? Number(updates.MEMBERSHIP_FEE) : config.membershipFee };
  if (newPasswords) {
    signOutEveryone_();
    reply.token = startSession_(session.name, session.role, session.personId ? { id: session.personId, authVersion: session.personVersion } : null);   // the admin stays signed in, linked to their account
    reply.signedOutEveryone = true;
  }
  return reply;
}

/** Asks Square whether this token can see this location (and that it takes Canadian dollars), so wrong keys are caught before saving. */
function testSquareKeys_(token, locationId, env) {
  const base = env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
  let res;
  try {
    res = UrlFetchApp.fetch(base + "/v2/locations/" + encodeURIComponent(locationId), {
      method: "get", headers: { Authorization: "Bearer " + token, "Square-Version": SQUARE_API_VERSION }, muteHttpExceptions: true
    });
  } catch (err) {
    throw new ApiError_("BAD_REQUEST", "Couldn't reach Square to check the keys. Nothing was saved. Try again in a moment.");
  }
  const code = res.getResponseCode();
  let data = {};
  try { data = JSON.parse(res.getContentText() || "{}") || {}; } catch (e) { data = {}; }
  const where = env === "sandbox" ? "Square's test mode (sandbox)" : "real payments (production)";
  if (code === 401 || code === 403) throw new ApiError_("BAD_REQUEST", "Square didn't accept that access token for " + where + ". Nothing was saved.");
  if (code === 404) throw new ApiError_("BAD_REQUEST", "Square has no location with that ID for this access token. Nothing was saved.");
  if (code < 200 || code >= 300) throw new ApiError_("BAD_REQUEST", "Square couldn't check the keys right now. Nothing was saved. Try again in a moment.");
  const loc = data.location || {};
  if (loc.currency && loc.currency !== "CAD") throw new ApiError_("BAD_REQUEST", "That Square location takes " + loc.currency + ", not Canadian dollars. Nothing was saved.");
  if (loc.status && loc.status !== "ACTIVE") throw new ApiError_("BAD_REQUEST", "That Square location isn't active. Nothing was saved.");
  return true;
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
  CacheService.getScriptCache().remove("ACTIVE_SESSIONS_INDEX");
  PropertiesService.getScriptProperties().setProperty("SESSION_EPOCH", Utilities.getUuid().slice(0, 8));
}

function currentEpoch_() {
  return PropertiesService.getScriptProperties().getProperty("SESSION_EPOCH") || "0";
}

function currentDoorEpoch_() {
  return PropertiesService.getScriptProperties().getProperty("DOOR_SESSION_EPOCH") || "0";
}

/** "Sign everyone out" button: admin only. The admin gets a fresh session so they aren't kicked too. */
function signOutAll_(session) {
  signOutEveryone_();
  log_(session.name, "sessions.clear", "", {});
  return { ok: true, token: startSession_(session.name, session.role, session.personId ? { id: session.personId, authVersion: session.personVersion } : null) };
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
  const expectedYear = membershipYearFromDate_();
  const selectedYear = membershipYear_();
  checks.push({
    name: "Membership year", ok: selectedYear === expectedYear, warning: true,
    detail: selectedYear === expectedYear ? selectedYear : "Settings uses " + selectedYear + "; today's date suggests " + expectedYear + ". Check the membership year and selected sheet in Settings → Membership."
  });
  run("Weekly backup (data, membership + archives)", backupStatus_);
  run("Archive", archiveStatus_);
  // A warning, not a failure of the system: the door sign-in works without a password, so anyone with the scanner link can sign in
  // as a volunteer while entry is open. Shown here; it does not trigger the nightly alert email.
  const doorPassword = !!PropertiesService.getScriptProperties().getProperty("SCANNER_PASSWORD");
  checks.push({
    name: "Door password", ok: doorPassword, warning: true,
    detail: doorPassword ? "Set" : "Not set: anyone with the scanner link can sign in as a door volunteer while entry is open. Set one in Settings → Security."
  });
  // Card payments are optional: shown only when they are set up (no call to Square, and never the token).
  const square = squareConfig_();
  if (square.enabled) {
    checks.push({
      name: "Card payments (Square)", ok: true,
      detail: square.environment === "sandbox" ? "On, in Square's test mode (no real money)." : "On. People can pay by card or e-transfer."
    });
  }
  run("Email allowance", function () {
    const left = MailApp.getRemainingDailyQuota();
    if (left < 15) throw new Error("Only " + left + " emails left today.");
    return left + " emails left today";
  });

  const lastError = recentError_(24);   // only an error from the last 24 hours; older ones are old news and drop off by themselves
  const config = getConfig_();
  // A manual run (from the portal) is written to the Log, so Activity shows who checked and what they found. The nightly job passes no session and logs nothing.
  if (session) log_(session.name, "health.check", "", { problems: checks.filter(function (c) { return !c.ok && !c.warning; }).length + (lastError ? 1 : 0) });
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
