/**
 * CSS Platform API — storage.
 *
 * The ONLY file that knows the data lives in Google Sheets. Swap this file to
 * change where data is stored; nothing else has to change.
 * v0.1 only reads. The project has full Sheets permission (Gordon's call, so
 * later versions can write without a new permission step), so staying
 * read-only is up to this code: nothing in v0.1 writes to a sheet.
 */

function loadMembers_() {
  const cache = CacheService.getScriptCache();
  const cached = cacheGetJson_(cache, "members");
  if (cached) return cached;

  const config = getConfig_();
  if (!config.membershipSheetId) {
    throw new ApiError_("SETUP_NEEDED", "MEMBERSHIP_SHEET_ID is missing from Script Properties.");
  }
  let members;
  try {
    members = retry_(function () {
      const spreadsheet = SpreadsheetApp.openById(config.membershipSheetId);
      const sheet = spreadsheet.getSheetByName(config.membershipTab) || spreadsheet.getSheets()[0];
      return rowsToMembers_(sheet.getDataRange().getValues());
    });
  } catch (err) {
    // Google is having a moment: an older copy (up to 6 h) beats an error page.
    const older = cacheGetJson_(cache, "members_old");
    if (older) return older;
    throw err;
  }

  cachePutJson_(cache, "members", members, MEMBER_CACHE_SECONDS);
  cachePutJson_(cache, "members_old", members, 21600);
  return members;
}

// ---- Writing to the Membership sheet (sign-ups and "mark paid") --------------------------------------
// Always works on a FRESH read of the sheet (never the cached copy), and only inside a lock.

/** The column a field is written to (a missing one is added at the end of the header row, named like the old form named it). */
function openMemberSheet_() {
  const config = getConfig_();
  if (!config.membershipSheetId) throw new ApiError_("SETUP_NEEDED", "MEMBERSHIP_SHEET_ID is missing from Script Properties.");
  const spreadsheet = SpreadsheetApp.openById(config.membershipSheetId);
  const sheet = spreadsheet.getSheetByName(config.membershipTab) || spreadsheet.getSheets()[0];
  let header = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
  let columns = mapMemberColumns_(header);
  Object.keys(MEMBER_COLUMNS).forEach(function (field) {
    if (columns[field] !== -1) return;
    sheet.getRange(1, header.length + 1).setValue(MEMBER_COLUMNS[field][0]);
    header = header.concat([MEMBER_COLUMNS[field][0]]);
    columns[field] = header.length - 1;
  });
  const lastRow = sheet.getLastRow();
  const values = lastRow > 1 ? sheet.getRange(1, 1, lastRow, header.length).getValues() : [header];
  const portal = header.map(normalizeHeader_).indexOf("portallink");   // the old tool's link column, filled when it exists
  return { sheet: sheet, header: header, columns: columns, portalColumn: portal, lastRow: lastRow, members: rowsToMembers_(values) };
}

/** record = { field: value } using the Member field names (name, ucid, email, memberId, paid, mailStatus, signedUp, payment...). */
function appendMemberRow_(book, record) {
  const row = book.header.map(function () { return ""; });
  Object.keys(record).forEach(function (field) { if (book.columns[field] !== -1) row[book.columns[field]] = record[field]; });
  if (book.portalColumn !== -1 && record.memberId) row[book.portalColumn] = MEMBER_PORTAL_URL.replace(/[/]+$/, "") + "/" + encodeURIComponent(record.memberId);
  book.sheet.getRange(book.lastRow + 1, 1, 1, row.length).setValues([row]);
  forgetMembers_();
}

/** Changes cells on one member's row (changes = { paid: "PAID", mailStatus: "Sent" }). */
function setMemberCells_(book, member, changes) {
  Object.keys(changes).forEach(function (field) {
    book.sheet.getRange(member.row, book.columns[field] + 1).setValue(changes[field]);
  });
  forgetMembers_();
}

/** The member list is cached for a few minutes: forget it so the next search sees the change. */
function forgetMembers_() {
  try { CacheService.getScriptCache().removeAll(["members_count"]); } catch (e) { /* the cache expires on its own */ }
}

// Apps Script caches hold at most 100 KB per entry, so big values are split into chunks.
const CACHE_CHUNK_SIZE = 90000;

function cachePutJson_(cache, key, value, seconds) {
  // Escape non-ASCII (e.g. Chinese names) so each 90,000-character chunk stays under the cache's 100 KB limit.
  const text = JSON.stringify(value).replace(/[^ -~]/g, function (c) { return String.fromCharCode(92) + "u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4); });
  const chunks = {};
  let count = 0;
  for (let i = 0; i < text.length; i += CACHE_CHUNK_SIZE) {
    chunks[key + "_" + count] = text.slice(i, i + CACHE_CHUNK_SIZE);
    count++;
  }
  chunks[key + "_count"] = String(count);
  cache.putAll(chunks, seconds);
}

function cacheGetJson_(cache, key) {
  const count = parseInt(cache.get(key + "_count"), 10);
  if (!count) return null;
  const keys = [];
  for (let i = 0; i < count; i++) keys.push(key + "_" + i);
  const parts = cache.getAll(keys);
  let text = "";
  for (let i = 0; i < count; i++) {
    if (parts[keys[i]] === undefined) return null;
    text += parts[keys[i]];
  }
  return JSON.parse(text);
}
