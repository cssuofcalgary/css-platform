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
           "ticketTypes", "questions", "codePrefix", "createdBy", "createdAt", "updatedBy", "updatedAt"],
  Orders: ["id", "code", "eventId", "payerName", "payerEmail", "etransferName", "total", "status",
           "createdAt", "paidAt", "paidBy", "notes"],
  Tickets: ["id", "secret", "orderId", "eventId", "name", "email", "ucid", "memberId", "ticketType",
            "price", "answers", "flag", "status", "checkedInAt", "checkedInBy", "createdAt", "emailedAt"],
  Log: ["time", "who", "action", "target", "details"]
};

/** Columns holding lists/objects; stored as JSON text. */
const JSON_COLUMNS = { ticketTypes: true, questions: true, answers: true };

/**
 * Remembered for the rest of this one request only (each request starts fresh),
 * so a scan opens the spreadsheet once instead of on every read and write.
 */
const DB_ = { spreadsheet: null, sheets: {}, headers: {}, rows: {} };

function dataSpreadsheet_() {
  if (DB_.spreadsheet) return DB_.spreadsheet;
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty("DATA_SHEET_ID");
  if (existing) return (DB_.spreadsheet = SpreadsheetApp.openById(existing));

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
  let sheet = spreadsheet.getSheetByName(name);

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

  const header = headerOf_(sheet);
  const missing = columns.filter(function (c) { return header.indexOf(c) === -1; });
  if (missing.length) {
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
  }
  DB_.headers[name] = header.concat(missing);
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
const DATE_COLUMNS = { date: "yyyy-MM-dd", startTime: "HH:mm", endTime: "HH:mm" };

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
    if (!text) return column === "answers" ? {} : [];
    try { return JSON.parse(text); } catch (e) { return column === "answers" ? {} : []; }
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
  const sheet = table_(name);
  const values = sheet.getDataRange().getValues();
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
  return (DB_.rows[name] = rows);
}

function insertRow_(name, obj) {
  const sheet = table_(name);
  const header = headerFor_(name);
  delete DB_.rows[name];
  const range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, header.length);
  range.setNumberFormat("@");   // keep "2026-10-21" and "18:00" as text, not dates
  range.setValues([header.map(function (column) { return toCell_(column, obj[column]); })]);
}

/**
 * Updates the row whose id matches. Only the columns in `changes` are touched.
 * `rowHint` (a row's `_row` from readRows_) skips the search, after checking the id is still there.
 */
function updateRow_(name, id, changes, rowHint) {
  const sheet = table_(name);
  const header = headerFor_(name);
  const idCol = header.indexOf("id");
  let row = -1;
  if (rowHint && String(sheet.getRange(rowHint, idCol + 1).getValue()) === String(id)) {
    row = rowHint;
  } else {
    const ids = sheet.getRange(1, idCol + 1, sheet.getLastRow(), 1).getValues();
    for (let r = 1; r < ids.length; r++) if (String(ids[r][0]) === String(id)) { row = r + 1; break; }
  }
  if (row === -1) throw new ApiError_("NOT_FOUND", name + " " + id + " not found.");
  delete DB_.rows[name];

  // Write side-by-side columns in one go (e.g. checkedInAt + checkedInBy).
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
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new ApiError_("BUSY", "The system is busy. Try again in a moment.");
  try { return fn(); } finally { lock.releaseLock(); }
}

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase();
}
