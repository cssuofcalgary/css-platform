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

function dataSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty("DATA_SHEET_ID");
  if (existing) return SpreadsheetApp.openById(existing);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const again = props.getProperty("DATA_SHEET_ID");
    if (again) return SpreadsheetApp.openById(again);
    const spreadsheet = SpreadsheetApp.create("CSS Platform Data (managed by the system, don't edit by hand)");
    props.setProperty("DATA_SHEET_ID", spreadsheet.getId());
    return spreadsheet;
  } finally {
    lock.releaseLock();
  }
}

/** Returns the tab for a table, creating it (or adding new columns) if needed. */
function table_(name) {
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
    return sheet;
  }

  const header = headerOf_(sheet);
  const missing = columns.filter(function (c) { return header.indexOf(c) === -1; });
  if (missing.length) {
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
  }
  return sheet;
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

/** All rows of a table as objects. */
function readRows_(name) {
  const sheet = table_(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values[0].map(String);
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    if (values[r].every(function (v) { return v === ""; })) continue;
    const row = {};
    header.forEach(function (column, c) { if (column) row[column] = fromCell_(column, values[r][c]); });
    rows.push(row);
  }
  return rows;
}

function insertRow_(name, obj) {
  const sheet = table_(name);
  const header = headerOf_(sheet);
  const range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, header.length);
  range.setNumberFormat("@");   // keep "2026-10-21" and "18:00" as text, not dates
  range.setValues([header.map(function (column) { return toCell_(column, obj[column]); })]);
}

/** Updates the row whose id matches. Only the columns in `changes` are touched. */
function updateRow_(name, id, changes) {
  const sheet = table_(name);
  const header = headerOf_(sheet);
  const idCol = header.indexOf("id");
  const ids = sheet.getRange(1, idCol + 1, sheet.getLastRow(), 1).getValues();
  for (let r = 1; r < ids.length; r++) {
    if (String(ids[r][0]) === String(id)) {
      Object.keys(changes).forEach(function (column) {
        const c = header.indexOf(column);
        if (c !== -1) sheet.getRange(r + 1, c + 1).setNumberFormat("@").setValue(toCell_(column, changes[column]));
      });
      return true;
    }
  }
  throw new ApiError_("NOT_FOUND", name + " " + id + " not found.");
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
