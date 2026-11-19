/**
 * CSS Platform API — the platform's own data.
 *
 * One spreadsheet, "CSS Platform Data", that the system creates the first time
 * it's needed and then owns. Nobody has to open it. Each table is a tab and row 1
 * holds the column names. Rows are always found by their id, never by row number,
 * so sorting or filtering the sheet by hand can't make the system edit the wrong row.
 */

const TABLES = {
  Events: ["id", "slug", "name", "description", "date", "startTime", "endTime", "location",
           "capacity", "capacityRule", "status", "entryOpen", "imageFileId", "imageUrl",
           "ticketTypes", "questions", "codePrefix", "createdBy", "createdAt", "updatedBy", "updatedAt",
           "registrationCloses", "archivedAt", "archiveYear", "summary", "waitlist",
           "mailRegistration", "mailTickets", "mailReminders"],
  Orders: ["id", "code", "eventId", "payerName", "payerEmail", "etransferName", "total", "status",
           "createdAt", "paidAt", "paidBy", "notes", "remindedAt", "cancelRequestedAt", "cancelRequestedBy", "requestId", "received", "lastWrite"],   // lastWrite stays LAST: see applyWrites_
  Tickets: ["id", "secret", "orderId", "eventId", "name", "email", "ucid", "memberId", "ticketType",
            "price", "answers", "flag", "status", "checkedInAt", "checkedInBy", "createdAt", "emailedAt"],
  Emails: ["id", "subject", "title", "subtitle", "intro", "closing", "updatedBy", "updatedAt"],
  Feedback: ["id", "eventId", "memberId", "name", "rating", "comment", "createdAt", "updatedAt"],
  Partners: ["id", "name", "offer", "address", "active", "sort", "createdAt", "createdBy", "updatedAt", "updatedBy"],
  MemberNotes: ["id", "memberId", "year", "text", "createdBy", "createdAt", "removedAt", "removedBy"],
  Redemptions: ["id", "time", "receivedAt", "memberId", "memberName", "partnerId", "partnerName", "offer"],
  Waitlist: ["id", "eventId", "name", "email", "ucid", "memberId", "ticketTypeId", "ticketType", "answers", "status",
             "createdAt", "offeredAt", "offeredBy", "orderId", "orderCode", "notes", "offerEmail"],
  // Money owed back to people (see Refunds.js). One row per decision; "returns" lists each time money was handed back.
  Refunds: ["id", "orderId", "orderCode", "eventId", "payerName", "payerEmail", "kind", "ticketIds", "owed", "returns", "status", "reason", "createdAt", "createdBy", "closedAt"],
  // One row per press of a button that records money or registrations, so pressing it again (or a retry) can't record it twice.
  Requests: ["id", "action", "who", "status", "plan", "reply", "createdAt", "doneAt"],
  Log: ["time", "who", "action", "target", "details"]
};

/** Columns holding lists/objects; stored as JSON text. */
const JSON_COLUMNS = { ticketTypes: true, questions: true, answers: true, summary: true, returns: true, ticketIds: true, plan: true, reply: true };

/**
 * Remembered for the rest of this one request only (each request starts fresh),
 * so a scan opens the spreadsheet once instead of on every read and write.
 */
const DB_ = { spreadsheet: null, sheets: {}, headers: {}, rows: {} };

/**
 * Google's spreadsheet service fails now and then for no reason ("Service Spreadsheets
 * timed out", "Server error occurred"). These are momentary, so try again a couple of
 * times before giving up. Only used for reads and for writes that are safe to repeat.
 */
function isTransient_(err) {
  return /timed out|service spreadsheets|server error|internal error|try again|temporar|unavailable|backend/i
    .test(String(err && err.message || err));
}

function retry_(fn) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (err instanceof ApiError_ || !isTransient_(err)) throw err;
      last = err;
      Utilities.sleep(400 * (attempt + 1));
    }
  }
  throw last;
}

function dataSpreadsheet_() {
  if (DB_.spreadsheet) return DB_.spreadsheet;
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty("DATA_SHEET_ID");
  if (existing) return (DB_.spreadsheet = retry_(function () { return SpreadsheetApp.openById(existing); }));

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const again = props.getProperty("DATA_SHEET_ID");
    if (again) return (DB_.spreadsheet = SpreadsheetApp.openById(again));
    const spreadsheet = SpreadsheetApp.create("CSS Platform Data (managed by the system, don't edit by hand)");
    props.setProperty("DATA_SHEET_ID", spreadsheet.getId());
    return (DB_.spreadsheet = spreadsheet);
  } finally {
    lock.releaseLock();
  }
}

/** Returns the tab for a table, creating it (or adding new columns) if needed. */
function table_(name) {
  if (DB_.sheets[name]) return DB_.sheets[name];
  const spreadsheet = dataSpreadsheet_();
  const columns = TABLES[name];
  let sheet = retry_(function () { return spreadsheet.getSheetByName(name); });

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange("A:AZ").setNumberFormat("@");   // plain text: stops Sheets turning "18:00" into a time
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    const starter = spreadsheet.getSheetByName("Sheet1");
    if (starter && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(starter);
    DB_.headers[name] = columns.slice();
    return (DB_.sheets[name] = sheet);
  }

  // The column names rarely change, so they are remembered between requests (per API version: a new deploy re-checks).
  const cache = CacheService.getScriptCache();
  const hdrKey = "dbhdr_" + API_VERSION + "_" + name;
  let remembered = null;
  try { remembered = JSON.parse(cache.get(hdrKey) || "null"); } catch (e) { /* read it fresh */ }
  if (remembered) { DB_.headers[name] = remembered; return (DB_.sheets[name] = sheet); }

  const header = retry_(function () { return headerOf_(sheet); });
  const missing = columns.filter(function (c) { return header.indexOf(c) === -1; });
  if (missing.length) {
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
  }
  DB_.headers[name] = header.concat(missing);
  try { cache.put(hdrKey, JSON.stringify(DB_.headers[name]), 21600); } catch (e) { /* fine */ }
  return (DB_.sheets[name] = sheet);
}

function headerFor_(name) {
  table_(name);
  return DB_.headers[name];
}

function headerOf_(sheet) {
  const width = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  while (header.length && !header[header.length - 1]) header.pop();
  return header;
}

function toCell_(column, value) {
  if (value === null || value === undefined) return "";
  if (JSON_COLUMNS[column]) return JSON.stringify(value);
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  return String(value);
}

/** Columns Sheets likes to turn into real dates/times; read them back as plain text. */
const DATE_COLUMNS = { date: "yyyy-MM-dd", startTime: "HH:mm", endTime: "HH:mm", registrationCloses: "yyyy-MM-dd'T'HH:mm" };

function fromCell_(column, value) {
  let text;
  if (value instanceof Date) {
    text = DATE_COLUMNS[column]
      ? Utilities.formatDate(value, "America/Edmonton", DATE_COLUMNS[column])
      : value.toISOString();
  } else {
    text = String(value === null ? "" : value);
  }
  if (JSON_COLUMNS[column]) {
    const empty = (column === "answers" || column === "summary") ? {} : [];
    if (!text) return empty;
    try { return JSON.parse(text); } catch (e) { return empty; }
  }
  return text;
}

/**
 * All rows of a table as objects (read once per request; any write resets it).
 * Each row also carries its sheet row number as a hidden `_row`, so an update
 * right after a read doesn't have to search again.
 */
function readRows_(name) {
  if (DB_.rows[name]) return DB_.rows[name];

  // Shared cache between requests: skips opening the spreadsheet entirely. See "Table cache" below.
  const cached = cacheableTable_(name) ? tableCacheGet_(name) : null;
  if (cached) return (DB_.rows[name] = cached);
  const version = cacheableTable_(name) ? tableVersion_(name) : "";   // taken BEFORE reading the sheet

  const sheet = table_(name);
  const values = retry_(function () { return sheet.getDataRange().getValues(); });
  const rows = [];
  if (values.length >= 2) {
    const header = values[0].map(String);
    for (let r = 1; r < values.length; r++) {
      if (values[r].every(function (v) { return v === ""; })) continue;
      const row = {};
      header.forEach(function (column, c) { if (column) row[column] = fromCell_(column, values[r][c]); });
      Object.defineProperty(row, "_row", { value: r + 1, enumerable: false });
      rows.push(row);
    }
  }
  if (version) tableCachePut_(name, version, rows);
  return (DB_.rows[name] = rows);
}

// ---- Table cache -------------------------------------------------------------------------------
// Reading a whole tab from Sheets costs roughly half a second or more. So each table is also kept in
// Apps Script's shared cache, under a version number. EVERY write (insertRow_ / updateRowOnce_) picks a
// new version, which makes the old copy unreachable at once, so the next read always sees fresh data.
// A reader takes the version before it reads the sheet, so a copy read around a write can only ever be
// stored under the old, already-dead version. If the cache is empty, too big or fails, we just read the
// sheet as before. The Log is never cached (it only grows and is read from the end).

const TABLE_CACHE_SECONDS = 1800;   // safety net for edits made by hand in the sheet
const TABLE_CACHE_MAX_CHARS = 2400000;

function cacheableTable_(name) { return name !== "Log"; }

function tableVersion_(name) {
  try {
    const cache = CacheService.getScriptCache();
    let v = cache.get("dbver_" + name);
    if (!v) { v = Utilities.getUuid().slice(0, 8); cache.put("dbver_" + name, v, 21600); }
    return v;
  } catch (e) { return ""; }
}

/** Called by every write: the table's cached copy is dead from this moment. */
function bumpTableVersion_(name) {
  if (!cacheableTable_(name)) return;
  try {
    const cache = CacheService.getScriptCache();
    const old = cache.get("dbver_" + name);
    cache.put("dbver_" + name, Utilities.getUuid().slice(0, 8), 21600);
    if (old) cache.remove("tbl_" + name + "_" + old + "_count");
  } catch (e) { /* the next reads just miss */ }
}

function tableCacheGet_(name) {
  try {
    const v = tableVersion_(name);
    if (!v) return null;
    const packed = cacheGetJson_(CacheService.getScriptCache(), "tbl_" + name + "_" + v);
    if (!packed) return null;
    return packed.map(function (p) {
      Object.defineProperty(p[1], "_row", { value: p[0], enumerable: false });
      return p[1];
    });
  } catch (e) { return null; }
}

function tableCachePut_(name, version, rows) {
  try {
    const packed = rows.map(function (r) { return [r._row, r]; });
    if (JSON.stringify(packed).length > TABLE_CACHE_MAX_CHARS) return;   // too big for the cache: read the sheet each time
    cachePutJson_(CacheService.getScriptCache(), "tbl_" + name + "_" + version, packed, TABLE_CACHE_SECONDS);
  } catch (e) { /* caching is a bonus, never a failure */ }
}

/**
 * One row straight from the sheet (never the cache). The door uses it to double-check a ticket right
 * before checking someone in. Returns null if that row no longer holds this id (rows moved).
 */
function readRowFresh_(name, rowNumber, id) {
  const sheet = table_(name);
  const header = headerFor_(name);
  const values = retry_(function () { return sheet.getRange(rowNumber, 1, 1, header.length).getValues(); })[0];
  const row = {};
  header.forEach(function (column, c) { if (column) row[column] = fromCell_(column, values[c]); });
  if (id !== undefined && String(row.id) !== String(id)) return null;
  Object.defineProperty(row, "_row", { value: rowNumber, enumerable: false });
  return row;
}

/**
 * Where each ticket sits in the Tickets tab: { ticket id or secret: row number }. A ticket's id and secret never
 * change, so unlike the table itself this survives every check-in and payment; only NEW tickets are missing from it.
 * A door scan uses it to go straight to one row instead of reading the whole tab. (Rebuilt when it can't be found or
 * a row has moved; a miss rebuilds at most once every 5 seconds, so garbage codes can't make every scan slow.)
 */
function ticketRowIndex_(rebuild) {
  const cache = CacheService.getScriptCache();
  const key = "tixidx_" + API_VERSION;
  if (!rebuild) {
    try { const found = cacheGetJson_(cache, key); if (found) return found; } catch (e) { /* rebuild below */ }
  }
  const index = {};
  readRows_("Tickets").forEach(function (t) { index[t.id] = t._row; if (t.secret) index[t.secret] = t._row; });
  try { cachePutJson_(cache, key, index, 21600); cache.put("tixidx_built", "1", 5); } catch (e) { /* fine */ }
  return index;
}

function forgetTicketRowIndex_() {
  try { const c = CacheService.getScriptCache(); c.remove("tixidx_" + API_VERSION + "_count"); c.remove("tixidx_built"); } catch (e) { /* fine */ }
}

/** One ticket by secret or id: its row is found in the index, then READ FRESH from the sheet. Null when there is none. */
function findTicketFresh_(kind, value) {
  const matches = function (t) { return t && (kind === "secret" ? t.secret === value : t.id === value); };
  let index = ticketRowIndex_(false);
  if (!index[value] && !CacheService.getScriptCache().get("tixidx_built")) index = ticketRowIndex_(true);   // maybe a brand-new ticket
  if (!index[value]) return null;
  let t = readRowFresh_("Tickets", index[value]);
  if (matches(t)) return t;
  dropTableCache_("Tickets");      // the row moved (sheet sorted by hand): forget the cached copy too, then rebuild from the sheet
  index = ticketRowIndex_(true);
  return index[value] ? (matches(t = readRowFresh_("Tickets", index[value])) ? t : null) : null;
}

/** Forget every copy of a table (this request's and the shared one). */
function dropTableCache_(name) {
  delete DB_.rows[name];
  bumpTableVersion_(name);
}

/** The last `count` rows of a table (newest last), without reading the whole sheet. Used for the Log, which only grows. */
function readLastRows_(name, count) {
  const sheet = table_(name);
  const header = headerFor_(name);
  const last = retry_(function () { return sheet.getLastRow(); });
  if (last < 2) return [];
  const first = Math.max(2, last - count + 1);
  const values = retry_(function () { return sheet.getRange(first, 1, last - first + 1, header.length).getValues(); });
  return values.filter(function (v) { return !v.every(function (x) { return x === ""; }); }).map(function (v) {
    const row = {};
    header.forEach(function (column, c) { if (column) row[column] = fromCell_(column, v[c]); });
    return row;
  });
}

function insertRow_(name, obj) {
  const sheet = table_(name);
  const header = headerFor_(name);
  delete DB_.rows[name];
  const values = header.map(function (column) { return toCell_(column, obj[column]); });
  try {
    if (name !== "Events") {
      sheet.appendRow(values);   // one call; these tabs' columns are plain text since they were created
    } else {
      const range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, header.length);
      range.setNumberFormat("@");   // keep "2026-10-21" and "18:00" as text, not dates
      range.setValues([values]);
    }
  } finally {
    bumpTableVersion_(name);   // AFTER the write: the cached copy is now out of date
    if (name === "Tickets") forgetTicketRowIndex_();   // a new ticket: the row index must learn about it
  }
}

/** Several rows in one go (e.g. every ticket of an order): two calls however many rows there are. */
function insertRows_(name, objs) {
  if (!objs.length) return;
  if (objs.length === 1 || name === "Events") { objs.forEach(function (o) { insertRow_(name, o); }); return; }
  const sheet = table_(name);
  const header = headerFor_(name);
  delete DB_.rows[name];
  try {
    const rows = objs.map(function (obj) { return header.map(function (column) { return toCell_(column, obj[column]); }); });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
  } finally {
    bumpTableVersion_(name);
    if (name === "Tickets") forgetTicketRowIndex_();
  }
}

/**
 * Updates the row whose id matches. Only the columns in `changes` are touched.
 * `rowHint` (a row's `_row` from readRows_) skips the search, after checking the id is still there.
 */
function updateRow_(name, id, changes, rowHint, rowVerified) {
  return retry_(function () { return updateRowOnce_(name, id, changes, rowHint, rowVerified); });   // writing the same values twice is harmless
}

/** `rowVerified` = the caller has just read this row fresh from the sheet (readRowFresh_), so skip re-checking its id. */
function updateRowOnce_(name, id, changes, rowHint, rowVerified) {
  const sheet = table_(name);
  const header = headerFor_(name);
  const idCol = header.indexOf("id");
  let row = -1;
  if (rowHint && rowVerified) {
    row = rowHint;
  } else if (rowHint && String(sheet.getRange(rowHint, idCol + 1).getValue()) === String(id)) {
    row = rowHint;
  } else {
    const ids = sheet.getRange(1, idCol + 1, sheet.getLastRow(), 1).getValues();
    for (let r = 1; r < ids.length; r++) if (String(ids[r][0]) === String(id)) { row = r + 1; break; }
  }
  if (row === -1) throw new ApiError_("NOT_FOUND", name + " " + id + " not found.");
  delete DB_.rows[name];

  // Write side-by-side columns in one go (e.g. checkedInAt + checkedInBy).
  try {
  const cols = Object.keys(changes)
    .map(function (column) { return { c: header.indexOf(column), v: toCell_(column, changes[column]) }; })
    .filter(function (x) { return x.c !== -1; })
    .sort(function (a, b) { return a.c - b.c; });
  const contiguous = cols.every(function (x, i) { return i === 0 || x.c === cols[i - 1].c + 1; });
  if (cols.length > 1 && contiguous) {
    sheet.getRange(row, cols[0].c + 1, 1, cols.length).setValues([cols.map(function (x) { return x.v; })]);
  } else {
    cols.forEach(function (x) { sheet.getRange(row, x.c + 1).setValue(x.v); });
  }
  } finally {
    bumpTableVersion_(name);   // AFTER the write: the cached copy is now out of date
  }
  return true;
}

/** The change log: every change made through the portal. */
function log_(who, action, target, details) {
  insertRow_("Log", {
    time: new Date().toISOString(),
    who: who,
    action: action,
    target: target || "",
    details: typeof details === "string" ? details : JSON.stringify(details || {})
  });
}

/** Runs fn while holding the script-wide lock, so two people can't change the same data at once. */
/**
 * A second, separate lock for everything that ADDS orders and tickets (online registration, "add a paid
 * registration", walk-ins). Door scans, payments and edits use the main lock above, so a rush of sign-ups
 * can never make a scanner wait. (Both locks belong to the one account that owns the script.)
 */
function withIntakeLock_(fn) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(25000)) throw new ApiError_("BUSY", "The system is busy. Try again in a moment.");
  try { return fn(); } finally { lock.releaseLock(); }
}

/**
 * For anything that MAKES PAID TICKETS (a free registration, a registration added by Finance, a waitlist offer): the intake
 * lock first, then the main lock that Mark paid and refunds use, so a last spot can't be handed out twice at the same moment.
 * Always in this order (intake, then main), and the main lock is never held while waiting for the intake lock.
 */
function withIntakeAndScriptLock_(fn) {
  return withIntakeLock_(function () { return withLock_(fn); });
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new ApiError_("BUSY", "The system is busy. Try again in a moment.");
  try { return fn(); } finally { lock.releaseLock(); }
}

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase();
}

// ---- Pressing a button twice ---------------------------------------------------------------------
// The dashboard sends a requestId with each press of a button that records money or registrations, and the SAME id when it
// tries again (busy server, dropped connection). The Requests tab remembers each press: "started" with the list of writes it
// is about to make, then "done" with the answer it gave. A repeat of a finished press gets that same answer back and records
// nothing; a repeat of a press that stopped halfway finishes the same list of writes instead of working it all out again.

/** The page's id for one press (letters, digits and dashes), or "" when it sent none (an older page). */
function cleanRequestId_(value) {
  const id = String(value || "");
  return /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : "";
}

/** What an earlier try of this press saved, or null. Call it inside the lock (it reads fresh). */
function savedRequest_(action, rid) {
  if (!rid) return null;
  delete DB_.rows["Requests"];
  return readRows_("Requests").filter(function (r) { return r.id === action + ":" + rid; })[0] || null;
}

/** Writes down what this press is about to do, before doing any of it. */
function startRequest_(action, rid, who, plan) {
  if (!rid) return;
  insertRow_("Requests", { id: action + ":" + rid, action: action, who: who, status: "started", plan: plan || {}, reply: {}, createdAt: new Date().toISOString(), doneAt: "" });
}

/** Keeps the answer, so a repeat gets the same one. Never fails the press: what it saved already stops anything being recorded twice. */
function finishRequest_(action, rid, who, reply) {
  if (!rid) return;
  try {
    const row = savedRequest_(action, rid);
    const done = { status: "done", reply: reply, doneAt: new Date().toISOString() };
    if (row) updateRow_("Requests", row.id, done, row._row);
    else insertRow_("Requests", Object.assign({ id: action + ":" + rid, action: action, who: who, plan: {}, createdAt: done.doneAt }, done));
  } catch (e) { console.error("Could not keep the answer for " + action + ": " + e.message); }
}

/**
 * Carries out a list of planned writes: { table, id, set, was } changes a row, { table, add } adds one. `op` names the press
 * ("applyTransfer:<id>"); every order it changes gets `lastWrite: op`, so a repeat can tell "this press already changed that
 * order" apart from "a different payment happened to leave the same numbers" (two real $5 payments look identical otherwise).
 *
 * All or nothing for what is left: every write is checked first, and if any row was changed by someone else since the plan
 * was made (it no longer holds `was` and this press didn't change it), NOTHING more is written: no refund, no "paid" for a
 * payment whose order step can't be finished. The ids are returned in `conflicts` for Finance to check by hand.
 * Returns { conflicts: [ids], done: [ids already written by an earlier try] }.
 *
 * lastWrite is the last Orders column, so updateRow_ writes it after the money columns: if a write stops halfway, the order
 * never claims a change it didn't get (the repeat then sees a mismatch and asks for a check instead of guessing).
 */
function applyWrites_(writes, op) {
  const rows = {}, todo = [], done = [], conflicts = [];
  const table = function (name) { return rows[name] || (rows[name] = readRows_(name).slice()); };
  (writes || []).forEach(function (w) {
    if (w.add) {
      if (table(w.table).some(function (r) { return String(r.id) === String(w.add.id); })) done.push(w.add.id); else todo.push(w);
      return;
    }
    const row = table(w.table).filter(function (r) { return String(r.id) === String(w.id); })[0];
    if (!row) { conflicts.push(w.id); return; }
    const holds = function (column, value) { return toCell_(column, row[column]) === toCell_(column, value); };
    const wasHeld = !w.was || Object.keys(w.was).every(function (c) { return holds(c, w.was[c]); });
    if (op && w.table === "Orders") {
      if (String(row.lastWrite || "") === op) done.push(w.id);       // this press changed it already
      else if (wasHeld) todo.push({ w: w, row: row });
      else conflicts.push(w.id);                                      // someone else changed it: don't guess
      return;
    }
    // Rows without a lastWrite mark (tickets), and plans saved before marks existed: fixed values already there = done.
    if (Object.keys(w.set).every(function (c) { return holds(c, w.set[c]); })) { done.push(w.id); return; }
    if (wasHeld) todo.push({ w: w, row: row }); else conflicts.push(w.id);
  });
  if (conflicts.length) return { conflicts: conflicts, done: done };
  todo.forEach(function (x) {
    if (x.add) return insertRow_(x.table, x.add);
    const set = op && x.w.table === "Orders" ? Object.assign({}, x.w.set, { lastWrite: op }) : x.w.set;
    updateRow_(x.w.table, x.w.id, set, x.row._row);
  });
  return { conflicts: [], done: done };
}

/** Plain words for Finance when a repeat can't finish: which orders to check before recording anything again. */
function needsReviewReply_(conflicts, alreadySaved) {
  const orderOf = function (id) { return readRows_("Orders").filter(function (x) { return x.id === id; })[0]; };
  const which = conflicts.map(function (id) { const o = orderOf(id); return o ? o.code : id; }).join(", ");
  const saved = (alreadySaved || []).map(orderOf).filter(Boolean).map(function (o) { return o.code; });
  return {
    ok: false, error: "NEEDS_REVIEW", conflicts: conflicts, alreadySaved: saved,
    message: "This was cut off last time, and " + which + " has changed since, so it can't tell whether it was saved. Nothing more was recorded. " +
      "Check " + which + " (amount received and notes) before recording it again."
  };
}
