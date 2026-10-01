/**
 * CSS Platform API — archiving finished events.
 *
 * The everyday sheet ("CSS Platform Data") should only hold events that are still going on, because every
 * request reads its whole Tickets and Orders tabs. Thirty days after an event, the nightly job moves that
 * event's tickets and orders into a yearly archive spreadsheet ("CSS Platform Archive 2026-27", September to
 * August) and keeps the event's final numbers on its Events row. Nothing is ever deleted. An admin can also
 * press Archive / Restore on the Events list (setEventStatus_ calls archiveEvent_ / restoreEvent_ below).
 *
 * Order of work (so a crash can never lose rows): stop new sign-ups -> copy rows to the archive -> check the
 * copy -> mark the event archived -> delete the live rows. A half-done archive is finished by the next nightly run.
 */

const ARCHIVE_AFTER_DAYS = 30;
const ARCHIVE_PER_RUN = 2;                  // events moved per nightly run (each can take a while)
const ARCHIVE_FOLDER_NAME = "CSS Platform Archive";
const ARCHIVE_TABLES = ["Tickets", "Orders"];
const LIVE_TICKETS_WARN = 3000;             // the shared table cache stops working around 4,800 tickets

/** "2026-10-05" -> "2026-27" (a school year runs September to August). */
function archiveYear_(date) {
  const y = parseInt(String(date).slice(0, 4), 10);
  const m = parseInt(String(date).slice(5, 7), 10);
  const start = m >= 9 ? y : y - 1;
  return start + "-" + String((start + 1) % 100).padStart(2, "0");
}

function assertNotArchived_(event) {
  if (event && event.archivedAt) throw new ApiError_("ARCHIVED", "This event is archived. Restore it first if you need to change it.");
}

// ---- The archive spreadsheets ---------------------------------------------------------------------

function archiveIds_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty("ARCHIVE_SHEETS") || "{}") || {}; } catch (e) { return {}; }
}

function archiveFolder_() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty("ARCHIVE_FOLDER_ID");
  if (saved) { try { return DriveApp.getFolderById(saved); } catch (e) { /* deleted: make a new one */ } }
  const found = DriveApp.getFoldersByName(ARCHIVE_FOLDER_NAME);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(ARCHIVE_FOLDER_NAME);
  props.setProperty("ARCHIVE_FOLDER_ID", folder.getId());
  return folder;
}

/** The spreadsheet for a school year, or null if there isn't one yet (and create is false). */
function archiveBook_(year, create) {
  const ids = archiveIds_();
  if (ids[year]) { try { return SpreadsheetApp.openById(ids[year]); } catch (e) { if (!create) return null; } }
  if (!create) return null;
  const book = SpreadsheetApp.create("CSS Platform Archive " + year + " (managed by the system, don't edit by hand)");
  try { DriveApp.getFileById(book.getId()).moveTo(archiveFolder_()); } catch (e) { console.error("Couldn't move the archive file into its folder: " + e.message); }
  ids[year] = book.getId();
  PropertiesService.getScriptProperties().setProperty("ARCHIVE_SHEETS", JSON.stringify(ids));
  return book;
}

/** A tab of an archive spreadsheet, created with the same columns as the live tab (and any new columns added). */
function archiveTab_(book, name) {
  const columns = TABLES[name];
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.getRange("A:AZ").setNumberFormat("@");
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    const starter = book.getSheetByName("Sheet1");
    if (starter && book.getSheets().length > 1) book.deleteSheet(starter);
    return { sheet: sheet, header: columns.slice() };
  }
  const header = headerOf_(sheet);
  const missing = columns.filter(function (c) { return header.indexOf(c) === -1; });
  if (missing.length) sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
  return { sheet: sheet, header: header.concat(missing) };
}

function tabRows_(tab) {
  const values = retry_(function () { return tab.sheet.getDataRange().getValues(); });
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    if (values[r].every(function (v) { return v === ""; })) continue;
    const row = {};
    tab.header.forEach(function (column, c) { if (column) row[column] = fromCell_(column, values[r][c]); });
    rows.push(row);
  }
  return rows;
}

function appendTabRows_(tab, rows) {
  if (!rows.length) return;
  const values = rows.map(function (obj) { return tab.header.map(function (column) { return toCell_(column, obj[column]); }); });
  tab.sheet.getRange(tab.sheet.getLastRow() + 1, 1, values.length, tab.header.length).setValues(values);
}

/** Deletes the rows whose id is in `ids` (bottom-up, in runs, so row numbers stay right). */
function deleteTabRows_(tab, ids) {
  const idCol = tab.header.indexOf("id");
  const last = tab.sheet.getLastRow();
  if (last < 2) return 0;
  const col = tab.sheet.getRange(1, idCol + 1, last, 1).getValues();
  const rows = [];
  for (let r = 1; r < col.length; r++) if (ids[String(col[r][0])]) rows.push(r + 1);
  let i = rows.length - 1, removed = 0;
  while (i >= 0) {
    let start = rows[i];
    let count = 1;
    while (i - 1 >= 0 && rows[i - 1] === start - 1) { start--; count++; i--; }
    tab.sheet.deleteRows(start, count);
    removed += count;
    i--;
  }
  return removed;
}

function idSet_(rows) {
  const set = {};
  rows.forEach(function (r) { set[String(r.id)] = true; });
  return set;
}

/** After rows moved in or out of the live Tickets / Orders tabs: forget every cached copy and the ticket row index. */
function forgetLiveRows_() {
  ARCHIVE_TABLES.forEach(function (t) { delete DB_.sheets[t]; dropTableCache_(t); });
  forgetTicketRowIndex_();
}

// ---- Reading an archived event -------------------------------------------------------------------

const ARCH_ = { rows: {} };   // this request only

/** One table of one event: from the live sheet, or from the yearly archive if the event has been archived. */
function eventRows_(table, event) {
  if (!event.archivedAt) return readRows_(table).filter(function (r) { return r.eventId === event.id; });
  const key = table + "|" + event.id;
  if (ARCH_.rows[key]) return ARCH_.rows[key];
  const book = archiveBook_(event.archiveYear, false);
  if (!book) return (ARCH_.rows[key] = []);
  const sheet = book.getSheetByName(table);
  if (!sheet) return (ARCH_.rows[key] = []);
  const tab = { sheet: sheet, header: headerOf_(sheet) };
  return (ARCH_.rows[key] = tabRows_(tab).filter(function (r) { return r.eventId === event.id; }));
}

// ---- Archive / restore -------------------------------------------------------------------------------

function daysSinceDate_(date) {
  try {
    const end = Utilities.parseDate(String(date) + " 23:59", "America/Edmonton", "yyyy-MM-dd HH:mm").getTime();
    return isNaN(end) ? -1 : (Date.now() - end) / 86400000;
  } catch (e) {
    return -1;   // an unreadable date is never "old"
  }
}

/**
 * Moves one event's tickets and orders to its year's archive spreadsheet. `force` (an admin pressing Archive)
 * skips the 30-day wait. Safe to run again after a crash: copies only what is missing, then finishes the delete.
 */
function archiveEvent_(session, eventId, force) {
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  if (!force && daysSinceDate_(event.date) < ARCHIVE_AFTER_DAYS) throw new ApiError_("BAD_REQUEST", "Events are archived " + ARCHIVE_AFTER_DAYS + " days after they happen.");
  const year = event.archiveYear || archiveYear_(event.date);

  return withIntakeLock_(function () {   // no new sign-ups, payments or scans for this moment
    return withLock_(function () {
      // 1. Stop new registrations at once (the public page and the register form look at the status)
      if (event.status !== "archived") {
        updateRow_("Events", eventId, { status: "archived", updatedBy: session.name, updatedAt: new Date().toISOString() });
      }

      // 2. Work out the final numbers while the rows are still in the live sheet (a restore-and-archive again recomputes them)
      let summary = event.summary && event.summary.totals ? event.summary : null;
      if (!summary || !event.archivedAt) {
        const full = eventSummary_(eventId, { full: true });
        summary = { totals: full.totals, money: full.money, byType: full.byType, questions: full.questions, spotsTaken: full.spotsTaken };
      }

      // 3. Copy to the archive (only what isn't there yet), then check the copy
      ARCHIVE_TABLES.forEach(function (t) { delete DB_.sheets[t]; dropTableCache_(t); });
      const book = archiveBook_(year, true);
      const moved = { Tickets: 0, Orders: 0 };
      ARCHIVE_TABLES.forEach(function (name) {
        const live = readRows_(name).filter(function (r) { return r.eventId === eventId; });
        const tab = archiveTab_(book, name);
        const there = idSet_(tabRows_(tab));
        appendTabRows_(tab, live.filter(function (r) { return !there[String(r.id)]; }));
        const check = idSet_(tabRows_(tab));
        live.forEach(function (r) { if (!check[String(r.id)]) throw new Error("The archive copy of " + name + " " + r.id + " is missing. Nothing was deleted."); });
        moved[name] = live.length;
      });

      // 4. Mark the event archived (its numbers now live on the Events row)
      updateRow_("Events", eventId, {
        status: "archived", archivedAt: new Date().toISOString(), archiveYear: year, summary: summary,
        entryOpen: false, updatedBy: session.name, updatedAt: new Date().toISOString()
      });

      // 5. Delete the live rows. The copy was checked in step 3.
      ARCHIVE_TABLES.forEach(function (name) {
        const live = readRows_(name).filter(function (r) { return r.eventId === eventId; });
        deleteTabRows_({ sheet: table_(name), header: headerFor_(name) }, idSet_(live));
      });
      forgetLiveRows_();
      ARCH_.rows = {};   // anything remembered from the archive earlier in this request is out of date now
      log_(session.name, "event.archive", eventId, { year: year, tickets: moved.Tickets, orders: moved.Orders });
      return { ok: true, archived: true, year: year, tickets: moved.Tickets, orders: moved.Orders };
    });
  });
}

/** Brings an archived event's rows back into the live sheet and reopens it as "closed". Admin only (checked by the caller). */
function restoreEvent_(session, eventId) {
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  return withIntakeLock_(function () {
    return withLock_(function () {
      const book = archiveBook_(event.archiveYear, false);
      const counts = { Tickets: 0, Orders: 0 };
      if (book) {
        ARCHIVE_TABLES.forEach(function (name) { delete DB_.sheets[name]; dropTableCache_(name); });
        ARCHIVE_TABLES.forEach(function (name) {
          const sheet = book.getSheetByName(name);
          if (!sheet) return;
          const tab = { sheet: sheet, header: headerOf_(sheet) };
          const mine = tabRows_(tab).filter(function (r) { return r.eventId === eventId; });
          const live = idSet_(readRows_(name));
          insertRows_(name, mine.filter(function (r) { return !live[String(r.id)]; }));   // only what isn't already back
          dropTableCache_(name);
          const back = idSet_(readRows_(name));
          mine.forEach(function (r) { if (!back[String(r.id)]) throw new Error("Restoring " + name + " " + r.id + " failed. The archive copy was kept."); });
          counts[name] = mine.length;
          deleteTabRows_(tab, idSet_(mine));
        });
      }
      updateRow_("Events", eventId, { status: "closed", archivedAt: null, archiveYear: null, summary: null, updatedBy: session.name, updatedAt: new Date().toISOString() });
      forgetLiveRows_();
      ARCH_.rows = {};
      log_(session.name, "event.restore", eventId, { tickets: counts.Tickets, orders: counts.Orders });
      return { ok: true, restored: true, tickets: counts.Tickets, orders: counts.Orders };
    });
  });
}

// ---- Deleting an event for good (admin) ---------------------------------------------------------------

/**
 * Removes an event and ALL its tickets and orders, from the live sheet and from the archive. Cannot be undone
 * (the backups made earlier still have a copy). The admin must type the event's exact name. If the event has
 * paid orders (real money was collected), `force` must also be true. The Log keeps one line saying it happened.
 */
function deleteEvent_(session, eventId, confirmName, force) {
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  if (String(confirmName || "").trim() !== String(event.name).trim()) throw new ApiError_("BAD_REQUEST", "The name you typed doesn't match the event's name. Nothing was deleted.");

  return withIntakeLock_(function () {
    return withLock_(function () {
      const orders = eventRows_("Orders", event);
      const tickets = eventRows_("Tickets", event);
      const paid = orders.filter(function (o) { return o.status === "paid" && Number(o.total) > 0; }).length;
      if (paid && !force) throw new ApiError_("NEEDS_FORCE", "This event has " + paid + " paid order" + (paid === 1 ? "" : "s") + ". Deleting it removes the record of that money. Confirm again to go ahead.");

      // stop the public page and the door first, then remove the rows
      updateRow_("Events", eventId, { status: "archived", entryOpen: false, updatedBy: session.name, updatedAt: new Date().toISOString() });
      if (event.archivedAt) {
        const book = archiveBook_(event.archiveYear, false);
        if (book) {
          ARCHIVE_TABLES.forEach(function (name) {
            const sheet = book.getSheetByName(name);
            if (!sheet) return;
            const tab = { sheet: sheet, header: headerOf_(sheet) };
            deleteTabRows_(tab, idSet_(tabRows_(tab).filter(function (r) { return r.eventId === eventId; })));
          });
        }
      } else {
        ARCHIVE_TABLES.forEach(function (name) { delete DB_.sheets[name]; dropTableCache_(name); });
        ARCHIVE_TABLES.forEach(function (name) {
          const live = readRows_(name).filter(function (r) { return r.eventId === eventId; });
          deleteTabRows_({ sheet: table_(name), header: headerFor_(name) }, idSet_(live));
        });
      }
      // a half-archived leftover in the archive (crash earlier) goes too
      const year = event.archiveYear || archiveYear_(event.date);
      const leftover = archiveBook_(year, false);
      if (leftover && !event.archivedAt) {
        ARCHIVE_TABLES.forEach(function (name) {
          const sheet = leftover.getSheetByName(name);
          if (!sheet) return;
          const tab = { sheet: sheet, header: headerOf_(sheet) };
          deleteTabRows_(tab, idSet_(tabRows_(tab).filter(function (r) { return r.eventId === eventId; })));
        });
      }
      deleteTabRows_({ sheet: table_("Events"), header: headerFor_("Events") }, { [eventId]: true });
      forgetLiveRows_();
      dropTableCache_("Events");
      ARCH_.rows = {};
      log_(session.name, "event.delete", eventId, { name: event.name, date: event.date, tickets: tickets.length, orders: orders.length, paidOrders: paid });
      return { ok: true, deleted: true, tickets: tickets.length, orders: orders.length };
    });
  });
}

// ---- The nightly job ---------------------------------------------------------------------------------

/**
 * Archives events more than 30 days old, and finishes any half-done archive (an event marked archived whose
 * rows are still in the live sheet, for example after a crash or a late sign-up). A few events per run.
 */
function archiveOldEvents_() {
  const today = Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");
  const liveEvents = {};
  ARCHIVE_TABLES.forEach(function (name) { readRows_(name).forEach(function (r) { liveEvents[r.eventId] = true; }); });

  const todo = allEvents_().filter(function (e) {
    if (e.status === "draft" || !e.date) return false;
    if (e.archivedAt) return !!liveEvents[e.id];                 // finish an unfinished move
    if (e.status === "archived") return true;                     // marked archived, copy never completed
    return daysSinceDate_(e.date) >= ARCHIVE_AFTER_DAYS;
  }).slice(0, ARCHIVE_PER_RUN);

  const done = [];
  todo.forEach(function (e) {
    try {
      archiveEvent_({ name: "system" }, e.id, true);
      done.push(e.name);
    } catch (err) {
      rememberError_("archive " + e.id, err);
      throw err;   // the nightly job reports it in the alert email
    }
  });
  return done;
}

/** For the health check: how big the live sheet is, and whether anything old is still sitting in it. */
function archiveStatus_() {
  const events = allEvents_();
  const live = readRows_("Tickets").length;
  const orders = readRows_("Orders").length;
  const archived = events.filter(function (e) { return e.archivedAt; });
  const years = {};
  archived.forEach(function (e) { years[e.archiveYear] = true; });
  const waiting = events.filter(function (e) { return !e.archivedAt && e.status !== "draft" && e.date && daysSinceDate_(e.date) >= ARCHIVE_AFTER_DAYS + 2; });
  const text = "live: " + live + " tickets, " + orders + " orders · archived: " + archived.length + " event" + (archived.length === 1 ? "" : "s") + " in " + Object.keys(years).length + " year" + (Object.keys(years).length === 1 ? "" : "s");
  if (live > LIVE_TICKETS_WARN) throw new Error(text + ". The live sheet is getting big: archive old events from the Events tab.");
  if (waiting.length) throw new Error(text + ". " + waiting.length + " old event" + (waiting.length === 1 ? " hasn't" : "s haven't") + " been archived yet (the nightly job does it; check the timers).");
  return text;
}
