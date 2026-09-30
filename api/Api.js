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
    return json_({ ok: false, error: "SERVER_ERROR", message: String(err && err.message || err) });
  }
}

function route_(req) {
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

    // ---- Exec ----
    case "login":
      return login_(req.password, req.name);

    case "logout":
      endSession_(req.token);
      return { ok: true };

    case "searchMembers": {
      const session = requireSession_(req.token);
      const matches = searchMembers_(loadMembers_(), req.query, 100000);
      return { ok: true, name: session.name, results: matches.slice(0, 25), total: matches.length };
    }

    case "getMember": {
      requireSession_(req.token);
      const member = findMemberById_(loadMembers_(), req.memberId);
      if (!member) throw new ApiError_("NOT_FOUND", "No member with that ID.");
      return { ok: true, member: member };
    }

    case "listEvents":
      requireSession_(req.token);
      return { ok: true, events: allEvents_(), counts: registrationCounts_() };

    case "saveEvent":
      return saveEvent_(requireSession_(req.token), req.event);

    case "setEventStatus":
      return setEventStatus_(requireSession_(req.token), req.eventId, req.status);

    case "uploadImage":
      return uploadImage_(requireSession_(req.token), req.dataUrl, req.filename);

    case "listOrders":
      requireSession_(req.token);
      return listOrders_(req.eventId);

    case "markOrderPaid":
      return markOrderPaid_(requireSession_(req.token), req.orderId, !!req.force, req.siteUrl);

    case "refundOrder":
      return refundOrder_(requireSession_(req.token), req.orderId, req.reason);

    case "resendTickets":
      return resendTickets_(requireSession_(req.token), req.orderId, req.siteUrl);

    case "sendPendingEmails": {
      requireSession_(req.token);
      const result = sendPendingTicketEmails_(null);
      return { ok: true, emailsSent: result.sent, emailsWaiting: result.waiting };
    }

    case "setEntryOpen":
      return setEntryOpen_(requireSession_(req.token), req.eventId, !!req.open);

    case "scan":
      return scan_(requireSession_(req.token), req.eventId, req.code, !!req.atDesk);

    case "undoCheckIn":
      return undoCheckIn_(requireSession_(req.token), req.ticketId);

    case "updateTicket":
      return updateTicket_(requireSession_(req.token), req.ticketId, req.changes, req.siteUrl);

    case "walkIn":
      return walkIn_(requireSession_(req.token), req.eventId, req.walkIn);

    case "doorList":
      requireSession_(req.token);
      return doorList_(req.eventId);

    default:
      throw new ApiError_("UNKNOWN_ACTION", "Unknown action: " + req.action);
  }
}

// ---- Login & sessions -------------------------------------------------------

function login_(password, name) {
  const config = getConfig_();
  if (!config.password) throw new ApiError_("SETUP_NEEDED", "EXEC_PASSWORD is missing from Script Properties.");

  const cache = CacheService.getScriptCache();
  const failed = parseInt(cache.get("failed_logins") || "0", 10);
  if (failed >= MAX_FAILED_LOGINS) {
    throw new ApiError_("TOO_MANY_TRIES", "Too many wrong passwords. Try again in 10 minutes.");
  }

  const typed = String(password || "");
  const role = (config.adminPassword && typed === config.adminPassword) ? "admin"
    : (typed === config.password) ? "exec"
    : "";
  if (!role) {
    cache.put("failed_logins", String(failed + 1), 600);
    throw new ApiError_("WRONG_PASSWORD", "Wrong password.");
  }

  const who = String(name || "").trim().slice(0, 60);
  if (!who) throw new ApiError_("NAME_NEEDED", "Pick your name.");

  const token = Utilities.getUuid();
  cache.put("session_" + token, JSON.stringify({ name: who, role: role, since: new Date().toISOString() }), SESSION_SECONDS);
  return { ok: true, token: token, name: who, role: role };
}

function requireSession_(token) {
  const raw = token ? CacheService.getScriptCache().get("session_" + token) : null;
  if (!raw) throw new ApiError_("NOT_LOGGED_IN", "Please log in again.");
  return JSON.parse(raw);
}

/** For admin-only actions (settings, change log, deleting, year rollover). */
function requireAdmin_(token) {
  const session = requireSession_(token);
  if (session.role !== "admin") throw new ApiError_("ADMIN_ONLY", "Only the admin password can do this.");
  return session;
}

function endSession_(token) {
  if (token) CacheService.getScriptCache().remove("session_" + token);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
