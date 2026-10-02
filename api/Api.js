/**
 * CSS Platform API — entry point.
 *
 * Pages send POST requests with a JSON body: { action, token, ...details }.
 * (POST keeps passwords and search terms out of the web address.)
 * Every reply is JSON: { ok: true, ... } or { ok: false, error: "CODE", message }.
 */

function ApiError_(code, message) {
  this.code = code;
  this.message = message || code;
}

/** Visiting the web app address in a browser shows this: a quick "is it alive?" check. */
function doGet() {
  return json_({ ok: true, service: "CSS Platform API", version: API_VERSION });
}

function doPost(e) {
  let request;
  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "BAD_REQUEST", message: "Request was not valid JSON." });
  }

  try {
    return json_(route_(request));
  } catch (err) {
    if (err instanceof ApiError_) return json_({ ok: false, error: err.code, message: err.message });
    console.error(err);
    rememberError_(request.action, err);
    if (isTransient_(err)) return json_({ ok: false, error: "TEMPORARY", message: "Google was slow for a moment. Try again." });
    return json_({ ok: false, error: "SERVER_ERROR", message: String(err && err.message || err) });
  }
}

/** The action being handled right now; requireSession_ uses it to keep door-only sessions to door actions. */
let ROUTE_ACTION_ = "";
/** True when the request came from the scanner page (so an exec using a scanner phone still counts as a scanner). */
let REQ_SCANNER_ = false;

function route_(req) {
  ROUTE_ACTION_ = String(req.action || "");
  REQ_SCANNER_ = req.scanner === true;
  switch (req.action) {
    // ---- Public (no login) ----
    case "publicEvents":
      return publicEvents_();

    case "publicEvent":
      return publicEvent_(req.slug);

    case "register":
      return register_(req);

    case "getTicket":
      return getTicket_(req.secret);

    case "findMyTickets":
      return findMyTickets_(req);

    case "registerMember":
      return publicRegisterMember_(req);

    case "findMyPass":
      return findMyPass_(req);

    case "myTickets":
      return myTickets_(req);

    case "openMyAccess":
      return openMyAccess_(req);

    // ---- Exec ----
    case "login":
      return login_(req.password, req.name);

    case "loginDoor":
      return loginDoor_(req.password, req.name);

    case "logout":
      endSession_(req.token);
      return { ok: true };

    case "ping":   // a signed-in page says "still here" every 30 s; requireSession_ records it
      requireSession_(req.token);
      return { ok: true };

    case "searchMembers": {
      const session = requireSession_(req.token);
      const matches = searchMembers_(loadMembers_(), req.query, 100000);
      return { ok: true, name: session.name, results: matches.slice(0, 25), total: matches.length };
    }

    case "listPendingMembers":
      requireSession_(req.token);
      return listPendingMembers_(req.offset, req.limit);

    case "addMember":
      return addMember_(requireSession_(req.token), req.member, !!req.paidNow);

    case "markMemberPaid":
      return markMemberPaid_(requireSession_(req.token), req.memberId);

    case "getMember": {
      requireSession_(req.token);
      const member = findMemberById_(loadMembers_(), req.memberId);
      if (!member) throw new ApiError_("NOT_FOUND", "No member with that ID.");
      return { ok: true, member: member };
    }

    case "listEvents": {
      const session = requireSession_(req.token);
      if (session.role === "door") return doorEvents_();
      return { ok: true, events: allEvents_(), counts: registrationCounts_() };
    }

    case "saveEvent":
      return saveEvent_(requireSession_(req.token), req.event);

    case "deleteEvent":
      return deleteEvent_(requireAdmin_(req.token), req.eventId, req.confirmName, !!req.force);

    case "setEventStatus":
      return setEventStatus_(requireSession_(req.token), req.eventId, req.status);

    case "uploadImage":
      return uploadImage_(requireSession_(req.token), req.dataUrl, req.filename);

    case "listOrders":
      requireSession_(req.token);
      return listOrders_(req.eventId, req);

    case "markOrderPaid":
      return markOrderPaid_(requireSession_(req.token), req.orderId, !!req.force, req.siteUrl);

    case "markOrdersPaid":
      return markOrdersPaid_(requireSession_(req.token), req.orderIds, req.siteUrl);

    case "sendReminders":
      return sendReminders_(requireSession_(req.token), req.eventId, !!req.dryRun);

    case "emailAttendees":
      return emailAttendees_(requireSession_(req.token), req.eventId, req.audience, req.subject, req.message, !!req.dryRun);

    case "addOrder":
      return addOrder_(requireSession_(req.token), req.eventId, req.order, !!req.force, req.siteUrl);

    case "refundOrder":
      return refundOrder_(requireSession_(req.token), req.orderId, req.reason);

    case "deleteOrder":
      return deleteOrder_(requireAdmin_(req.token), req.orderId);

    case "resendTickets":
      return resendTickets_(requireSession_(req.token), req.orderId, req.siteUrl);

    case "sendPendingEmails": {
      requireSession_(req.token);
      const result = sendPendingTicketEmails_(null);
      return { ok: true, emailsSent: result.sent, emailsWaiting: result.waiting };
    }

    case "setEntryOpen":
      return setEntryOpen_(requireSession_(req.token), req.eventId, !!req.open);

    case "scan": {
      const session = requireSession_(req.token);
      return scan_(session, req.eventId, req.code, !!req.atDesk && session.role !== "door");   // door volunteers can't use the help-desk override
    }

    case "undoCheckIn":
      return undoCheckIn_(requireSession_(req.token), req.ticketId);

    case "updateTicket":
      return updateTicket_(requireSession_(req.token), req.ticketId, req.changes, req.siteUrl, req.orderChanges);

    case "activityLog":
      requireAdmin_(req.token);
      return activityLog_(req.filters);

    case "getSettings":
      requireAdmin_(req.token);
      return getSettings_(req.token);

    case "kickSession":
      return kickSession_(requireAdmin_(req.token), req.token, req.tokenToKick);

    case "saveSettings":
      return saveSettings_(requireAdmin_(req.token), req.token, req.settings);

    case "signOutAll":
      return signOutAll_(requireAdmin_(req.token));

    case "healthCheck":
      return healthCheck_(requireAdmin_(req.token));

    case "getEmailTemplates":
      requireAdmin_(req.token);
      return getEmailTemplates_();

    case "saveEmailTemplate":
      return saveEmailTemplate_(requireAdmin_(req.token), req.key, req.fields);

    case "saveEmailBrand":
      return saveEmailBrand_(requireAdmin_(req.token), req.brand);

    case "previewEmail":
      requireAdmin_(req.token);
      return previewEmail_(req.key, req.fields);

    case "sendTestEmail":
      return sendTestEmail_(requireAdmin_(req.token), req.key, req.to, req.fields);

    case "eventSummary":
      requireSession_(req.token);
      return eventSummary_(req.eventId, req);

    case "walkIn":
      return walkIn_(requireSession_(req.token), req.eventId, req.walkIn);

    case "doorList":
      return doorList_(req.eventId, requireSession_(req.token), req);

    default:
      throw new ApiError_("UNKNOWN_ACTION", "Unknown action: " + req.action);
  }
}

// ---- Login & sessions -------------------------------------------------------

/** Wrong-password counter per person, so one person's typos (or a stranger's guesses) can't lock everyone else out. */
function loginFailKey_(name) {
  return "failed_login_" + String(name || "anon").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
}

function login_(password, name) {
  const config = getConfig_();
  if (!config.password) throw new ApiError_("SETUP_NEEDED", "EXEC_PASSWORD is missing from Script Properties.");

  const cache = CacheService.getScriptCache();
  const userKey = loginFailKey_(name);
  const failed = parseInt(cache.get(userKey) || "0", 10);
  if (failed >= MAX_FAILED_LOGINS) {
    throw new ApiError_("TOO_MANY_TRIES", "Too many wrong passwords. Try again in 10 minutes.");
  }

  const typed = String(password || "");
  const role = (config.adminPassword && typed === config.adminPassword) ? "admin"
    : (typed === config.password) ? "exec"
    : "";
  if (!role) {
    cache.put(userKey, String(failed + 1), 600);
    throw new ApiError_("WRONG_PASSWORD", "Wrong password.");
  }

  const who = String(name || "").trim().slice(0, 60);
  if (!who) throw new ApiError_("NAME_NEEDED", "Pick your name.");
  cache.remove(userKey);

  warmCaches_(false);   // sign-in may take a moment longer; every screen after it is quick
  return { ok: true, token: startSession_(who, role), name: who, role: role };
}

/** Reads the tables into the shared cache now, so the first click after signing in is not the slow one. */
function warmCaches_(doorOnly) {
  try {
    readRows_("Events"); readRows_("Tickets"); readRows_("Orders");
    if (!doorOnly) loadMembers_();
  } catch (err) { /* warming is a bonus: never block signing in */ }
}

/** A new signed-in session. It carries the current "epoch"; signing everyone out changes the epoch. */
function startSession_(name, role) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("session_" + token,
    JSON.stringify({ name: name, role: role, since: new Date().toISOString(), epoch: currentEpoch_() }), SESSION_SECONDS);
  return token;
}

function requireSession_(token) {
  const raw = token ? CacheService.getScriptCache().get("session_" + token) : null;
  if (!raw) throw new ApiError_("NOT_LOGGED_IN", "Please log in again.");
  const session = JSON.parse(raw);
  if ((session.epoch || "0") !== currentEpoch_()) throw new ApiError_("NOT_LOGGED_IN", "Please log in again.");   // everyone was signed out
  touchSession_(token, session);
  if (session.role === "door") checkDoorSession_(ROUTE_ACTION_);
  return session;
}

/** For admin-only actions (settings, change log, deleting, year rollover). */
function requireAdmin_(token) {
  const session = requireSession_(token);
  if (session.role !== "admin") throw new ApiError_("ADMIN_ONLY", "Only the admin password can do this.");
  return session;
}

function endSession_(token) {
  if (!token) return;
  CacheService.getScriptCache().remove("session_" + token);
  forgetSession_(token);
}

// ---- Who is online -------------------------------------------------------------
// A small registry in the cache: token -> { id, name, role, lastSeen, isScanner }. Every signed-in request (and the 30 s ping)
// refreshes its entry; anything not seen for 45 s is treated as closed or locked. The public `id` is what the portal sees and
// uses to sign a device out: the token itself never leaves the server.

const ACTIVE_SESSIONS_KEY = "ACTIVE_SESSIONS_INDEX";
const SESSION_ONLINE_MS = 45000;
const SESSION_TOUCH_MS = 10000;   // a session seen in the last 10 s isn't written again

function readSessionIndex_() {
  try { return JSON.parse(CacheService.getScriptCache().get(ACTIVE_SESSIONS_KEY) || "{}") || {}; } catch (e) { return {}; }
}

function writeSessionIndex_(index) {
  const now = Date.now();
  Object.keys(index).forEach(function (t) { if (now - index[t].lastSeen > SESSION_ONLINE_MS) delete index[t]; });
  try { CacheService.getScriptCache().put(ACTIVE_SESSIONS_KEY, JSON.stringify(index), SESSION_SECONDS); } catch (e) { /* the list is a bonus: never fail a request over it */ }
}

function touchSession_(token, session) {
  try {
    const now = Date.now();
    const index = readSessionIndex_();
    const prev = index[token];
    const scanner = session.role === "door" || REQ_SCANNER_;
    if (prev && now - prev.lastSeen < SESSION_TOUCH_MS && prev.isScanner === scanner) return;
    index[token] = { id: prev ? prev.id : Utilities.getUuid().slice(0, 8), token: token, name: session.name, role: session.role, lastSeen: now, isScanner: scanner };
    writeSessionIndex_(index);
  } catch (e) { /* see above */ }
}

function forgetSession_(token) {
  try {
    const index = readSessionIndex_();
    if (index[token]) { delete index[token]; writeSessionIndex_(index); }
  } catch (e) { /* see above */ }
}

/** How many scanner phones were seen in the last 45 s. */
function countActiveScanners_() {
  const now = Date.now(), index = readSessionIndex_();
  return Object.keys(index).filter(function (t) { return index[t].isScanner && now - index[t].lastSeen <= SESSION_ONLINE_MS; }).length;
}

/** The online list for Settings. No tokens: just a public id, name, role, when last seen, and which one is the caller's. */
function activeSessions_(ownToken) {
  const now = Date.now(), index = readSessionIndex_();
  return Object.keys(index).filter(function (t) { return now - index[t].lastSeen <= SESSION_ONLINE_MS; }).map(function (t) {
    const s = index[t];
    return { id: s.id, name: s.name, role: s.isScanner ? "scanner" : s.role, lastSeen: s.lastSeen, thisDevice: t === ownToken };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

/** Admin: sign one device out. It is logged out on its very next call. `tokenToKick` is the public id from the list. */
function kickSession_(session, ownToken, tokenToKick) {
  const index = readSessionIndex_();
  const wanted = String(tokenToKick || "");
  const key = Object.keys(index).filter(function (t) { return wanted && (index[t].id === wanted || t === wanted); })[0];
  if (!key) throw new ApiError_("NOT_FOUND", "That device is already offline.");
  if (key === ownToken) throw new ApiError_("BAD_REQUEST", "That is this device. Use Sign out instead.");
  const gone = index[key];
  CacheService.getScriptCache().remove("session_" + key);
  delete index[key];
  writeSessionIndex_(index);
  log_(session.name, "session.kick", "", { name: gone.name, role: gone.isScanner ? "scanner" : gone.role });
  return { ok: true };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
