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
