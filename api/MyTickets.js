/**
 * CSS Platform API — "Find my tickets" (public).
 *
 * A member types their email, or their UCID and last name. We never show tickets on screen
 * (a QR code is what gets someone in the door): we email the ticket links to the address on
 * the ticket. The reply is always the same wording, so nobody can use this page to check who
 * is registered. The only extra shown is a masked address ("g*****@gmail.com") when a UCID
 * and last name both match, for people who forgot which email they used.
 */

const FIND_TICKETS_WAIT_SECONDS = 600;   // the same search can email at most once per 10 minutes
const FIND_TICKETS_TRIES = 4;            // and can be tried at most 4 times per 10 minutes (typos allowed)
const FIND_TICKETS_DAILY_CAP = 40;       // emails this page may send per day (Gmail allows about 100 in total)
const FIND_TICKETS_MAX_EMAILS = 3;       // one search never emails more than this many addresses

function findMyTickets_(req) {
  const email = String(req.email || "").trim().toLowerCase().slice(0, 120);
  const ucid = String(req.ucid || "").replace(/\D/g, "").slice(0, 12);
  const lastName = normalizeName_(req.lastName || "");
  const byEmail = !!email;
  if (byEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError_("BAD_REQUEST", "That email doesn't look right.");
  if (!byEmail && (ucid.length < 6 || !lastName)) throw new ApiError_("BAD_REQUEST", "Enter your email, or your UCID and last name.");

  const generic = { ok: true, sent: false, message: "If we found tickets, we've emailed them. Check your inbox and spam folder. If you asked in the last 10 minutes, the email is already on its way." };
  const key = lookupKey_("t", byEmail ? "e:" + email : "u:" + ucid);
  if (lookupBlocked_(key)) return generic;

  const today = Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");
  const events = {};
  allEvents_().forEach(function (e) {
    if (e.status === "published" && e.date >= today) events[e.id] = e;
  });

  const matches = readRows_("Tickets").filter(function (t) {
    if (t.status !== "paid" || !events[t.eventId] || !t.email) return false;
    if (byEmail) return String(t.email).toLowerCase() === email;
    return t.ucid === ucid && nameEndsWith_(t.name, lastName);
  });
  if (!matches.length) return generic;

  // group by the address each ticket is emailed to
  const groups = {};
  matches.forEach(function (t) {
    const to = String(t.email).toLowerCase();
    (groups[to] = groups[to] || []).push(t);
  });
  const addresses = Object.keys(groups).slice(0, FIND_TICKETS_MAX_EMAILS);

  let sent = 0;
  addresses.forEach(function (to) {
    if (!lookupBudget_()) return;
    const items = groups[to].map(function (t) { return { event: events[t.eventId], ticket: t }; });
    if (sendMyTicketsEmail_(to, items)) { sent++; lookupSpend_(); }
  });
  if (sent > 0) lookupDone_(key);
  log_("public", "tickets.lookup", "", { by: byEmail ? "email" : "ucid", emails: sent });

  const reply = { ok: true, sent: sent > 0, message: generic.message };
  if (!byEmail && sent > 0) reply.maskedEmails = addresses.map(maskEmail_);
  return reply;
}

/** "Chan-Wong" and "chan wong" both match; accents and case don't matter. */
function normalizeName_(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/-/g, " ").replace(/[^a-z0-9一-鿿\s]/g, "").replace(/\s+/g, " ").trim();
}

/** True when the full name ends with the last name typed (so a two-word last name works too). */
function nameEndsWith_(fullName, lastName) {
  const full = normalizeName_(fullName);
  return full === lastName || full.slice(-(lastName.length + 1)) === " " + lastName;
}

function maskEmail_(address) {
  const at = address.indexOf("@");
  if (at < 1) return "***";
  return address.slice(0, 1) + "*****" + address.slice(at);
}

// ---- Find my member pass (member portal) --------------------------------------------

const MEMBER_PORTAL_URL = "https://member.ucalgarycss.ca/";

/** Same idea as findMyTickets_, for the member pass: emails the pass link to the address on the Membership sheet. */
function findMyPass_(req) {
  const email = String(req.email || "").trim().toLowerCase().slice(0, 120);
  const ucid = String(req.ucid || "").replace(/\D/g, "").slice(0, 12);
  const lastName = normalizeName_(req.lastName || "");
  const byEmail = !!email;
  if (byEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError_("BAD_REQUEST", "That email doesn't look right.");
  if (!byEmail && (ucid.length < 6 || !lastName)) throw new ApiError_("BAD_REQUEST", "Enter your email, or your UCID and last name.");

  const generic = { ok: true, sent: false, message: "If we found your membership, we've emailed your pass link. Check your inbox and spam folder. If you asked in the last 10 minutes, it's already on its way." };
  const key = lookupKey_("m", byEmail ? "e:" + email : "u:" + ucid);
  if (lookupBlocked_(key)) return generic;

  const found = loadMembers_().filter(function (m) {
    if (!m.email || !m.memberId) return false;
    if (byEmail) return String(m.email).toLowerCase() === email;
    return String(m.ucid).replace(/\D/g, "") === ucid && nameEndsWith_(m.name, lastName);
  })[0];
  if (!found || !lookupBudget_()) return generic;

  const to = String(found.email).toLowerCase();
  const sent = sendMyPassEmail_(to, found, MEMBER_PORTAL_URL + "?member=" + encodeURIComponent(found.memberId));
  if (sent) { lookupSpend_(); lookupDone_(key); }
  log_("public", "pass.lookup", "", { by: byEmail ? "email" : "ucid", sent: sent ? 1 : 0 });

  const reply = { ok: true, sent: sent, message: generic.message };
  if (!byEmail && sent) reply.maskedEmails = [maskEmail_(to)];
  return reply;
}

// ---- Shared limits for both lookups ---------------------------------------------------

function lookupKey_(kind, who) {
  return "find_" + kind + "_" + Utilities.base64EncodeWebSafe(who).slice(0, 200);
}

/** True when this search already got its email, or has been tried too often in the last 10 minutes. Counts the try. */
function lookupBlocked_(key) {
  const cache = CacheService.getScriptCache();
  if (cache.get(key + "_sent")) return true;
  const tries = parseInt(cache.get(key) || "0", 10);
  if (tries >= FIND_TICKETS_TRIES) return true;
  cache.put(key, String(tries + 1), FIND_TICKETS_WAIT_SECONDS);
  return false;
}

function lookupDone_(key) {
  CacheService.getScriptCache().put(key + "_sent", "1", FIND_TICKETS_WAIT_SECONDS);
}

function lookupDayKey_() {
  return "FIND_COUNT_" + Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");
}

/** Emails left in today's allowance for these public lookups (tickets and passes together). */
function lookupBudget_() {
  return parseInt(PropertiesService.getScriptProperties().getProperty(lookupDayKey_()) || "0", 10) < FIND_TICKETS_DAILY_CAP;
}

function lookupSpend_() {
  const props = PropertiesService.getScriptProperties();
  const day = lookupDayKey_();
  props.setProperty(day, String(parseInt(props.getProperty(day) || "0", 10) + 1));
}
