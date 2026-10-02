/**
 * CSS Platform API — events.
 *
 * An Event is everything the public page, the registration form and the door
 * need: details, image, ticket types with prices, extra questions and capacity.
 * Prices and questions are per-event settings, never code.
 */

const EVENT_STATUSES = ["draft", "published", "closed", "archived"];

function eventFromRow_(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    location: row.location,
    capacity: row.capacity === "" ? null : Number(row.capacity),
    capacityRule: row.capacityRule || "paid",
    status: row.status || "draft",
    entryOpen: row.entryOpen === "TRUE",
    imageFileId: row.imageFileId,
    imageUrl: row.imageUrl,
    ticketTypes: row.ticketTypes || [],
    questions: row.questions || [],
    codePrefix: row.codePrefix,
    registrationCloses: row.registrationCloses || "",
    archivedAt: row.archivedAt || "",       // set once the event's tickets and orders have moved to the yearly archive (Archive.js)
    archiveYear: row.archiveYear || "",
    summary: row.summary || {},            // frozen numbers of an archived event
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt
  };
}

function allEvents_() {
  return readRows_("Events").map(eventFromRow_).sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date));
  });
}

function findEvent_(test) {
  const events = allEvents_();
  for (let i = 0; i < events.length; i++) if (test(events[i])) return events[i];
  return null;
}

/** Tickets that take up a spot: paid ones, or every active one if the event counts all sign-ups. */
function spotsTaken_(event) {
  if (event.archivedAt) return Number((event.summary || {}).spotsTaken) || 0;
  return readRows_("Tickets").filter(function (t) {
    if (t.eventId !== event.id) return false;
    if (t.status === "paid") return true;
    return event.capacityRule === "all" && t.status === "awaiting";
  }).length;
}

// ---- Exec actions -----------------------------------------------------------

function saveEvent_(session, input) {
  const clean = cleanEventInput_(input || {});
  return withLock_(function () {
    const now = new Date().toISOString();
    const events = allEvents_();

    if (clean.id) {
      const current = events.filter(function (e) { return e.id === clean.id; })[0];
      if (!current) throw new ApiError_("NOT_FOUND", "That event no longer exists.");
      const changes = Object.assign({}, clean, { updatedBy: session.name, updatedAt: now });
      delete changes.id;
      delete changes.slug;   // the public link never changes once created
      updateRow_("Events", current.id, changes);
      log_(session.name, "event.update", current.id, { name: clean.name });
      return { ok: true, event: eventFromRow_(Object.assign({}, rowOf_(current), changes)) };
    }

    const event = Object.assign({}, clean, {
      id: newId_("EV"),
      slug: uniqueSlug_(clean.name, events),
      status: "draft",
      entryOpen: false,
      createdBy: session.name,
      createdAt: now,
      updatedBy: session.name,
      updatedAt: now
    });
    insertRow_("Events", event);
    log_(session.name, "event.create", event.id, { name: event.name });
    return { ok: true, event: eventFromRow_(rowOf_(event)) };
  });
}

function setEventStatus_(session, eventId, status) {
  if (EVENT_STATUSES.indexOf(status) === -1) throw new ApiError_("BAD_REQUEST", "Unknown status.");
  const current = findEvent_(function (e) { return e.id === eventId; });
  if (!current) throw new ApiError_("NOT_FOUND", "Event not found.");
  if ((status === "archived" || current.status === "archived") && session.role !== "admin") {
    throw new ApiError_("ADMIN_ONLY", "Only the admin password can archive or restore events.");
  }
  // Archiving moves the event's tickets and orders to the yearly archive spreadsheet; restoring brings them back (Archive.js)
  if (status === "archived") return archiveEvent_(session, eventId, true);
  if (current.status === "archived") {
    const restored = restoreEvent_(session, eventId);
    if (status === "closed") return restored;
  }
  return withLock_(function () {
    updateRow_("Events", eventId, { status: status, updatedBy: session.name, updatedAt: new Date().toISOString() });
    log_(session.name, "event.status", eventId, { status: status });
    return { ok: true };
  });
}

/** Saves an uploaded image (a data: URL made by the page) to Drive and makes it viewable by link. */
function uploadImage_(session, dataUrl, filename) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl || ""));
  if (!match) throw new ApiError_("BAD_REQUEST", "That isn't a JPG, PNG or WebP image.");
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > 5 * 1024 * 1024) throw new ApiError_("BAD_REQUEST", "Image is too big (max 5 MB).");

  const blob = Utilities.newBlob(bytes, match[1], String(filename || "event-image").slice(0, 80));
  const file = imageFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  log_(session.name, "image.upload", file.getId(), { name: file.getName() });
  return { ok: true, fileId: file.getId(), url: "https://lh3.googleusercontent.com/d/" + file.getId() + "=w1600" };
}

const IMAGE_LIST_MAX = 60;

/** Pictures already uploaded for events (newest first), so an exec can reuse one instead of uploading it again. */
function listImages_() {
  const folder = imageFolder_();
  const found = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (!/^image\//.test(f.getMimeType())) continue;
    found.push({ file: f, time: f.getDateCreated().getTime() });
  }
  found.sort(function (a, b) { return b.time - a.time; });
  return {
    ok: true,
    images: found.slice(0, IMAGE_LIST_MAX).map(function (x) {
      const id = x.file.getId();
      return {
        id: id, name: x.file.getName(), when: new Date(x.time).toISOString(),
        url: "https://lh3.googleusercontent.com/d/" + id + "=w1600",
        thumb: "https://lh3.googleusercontent.com/d/" + id + "=w300"
      };
    }),
    more: found.length > IMAGE_LIST_MAX
  };
}

function imageFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("IMAGE_FOLDER_ID");
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make a new one */ }
  }
  const root = DriveApp.createFolder("CSS Platform");
  const folder = root.createFolder("Event images");
  props.setProperty("IMAGE_FOLDER_ID", folder.getId());
  return folder;
}

// ---- Public actions (no login) ---------------------------------------------

function publicEvents_() {
  const today = Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");
  return {
    ok: true,
    site: siteInfo_(),
    events: allEvents_()
      .filter(function (e) { return e.status === "published" && e.date >= today; })
      .reverse()
      .map(publicEventView_)
  };
}

function publicEvent_(slug) {
  const event = findEvent_(function (e) { return e.slug === String(slug || "").toLowerCase(); });
  if (!event || event.status === "draft" || event.status === "archived") throw new ApiError_("NOT_FOUND", "Event not found.");
  return { ok: true, site: siteInfo_(), event: publicEventView_(event) };
}

/** Only what the public may see. */
function publicEventView_(event) {
  const taken = event.capacity ? spotsTaken_(event) : 0;
  const soldOut = !!event.capacity && taken >= event.capacity;
  return {
    slug: event.slug,
    name: event.name,
    description: event.description,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location,
    imageUrl: event.imageUrl,
    ticketTypes: event.ticketTypes.map(function (t) {
      return { id: t.id, name: t.name, price: t.price, needsMembership: !!t.needsMembership };
    }),
    questions: event.questions,
    registrationOpen: registrationOpen_(event) && !soldOut,
    registrationCloses: registrationClosesAt_(event),
    soldOut: soldOut,
    spotsLeft: event.capacity ? Math.max(event.capacity - taken, 0) : null,
    etransferEmail: getConfig_().etransferEmail
  };
}

// ---- Registration window ------------------------------------------------------

/** When registration closes ("yyyy-MM-ddTHH:mm", Calgary time). Default: when the event starts. */
function registrationClosesAt_(event) {
  if (event.registrationCloses) return event.registrationCloses;
  return event.date + "T" + (event.startTime || "23:59");
}

function registrationOpen_(event) {
  if (event.status !== "published") return false;
  const now = Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd'T'HH:mm");
  return now < registrationClosesAt_(event);
}

// ---- Helpers ----------------------------------------------------------------

function cleanEventInput_(input) {
  const text = function (v, max) { return String(v === undefined || v === null ? "" : v).trim().slice(0, max || 200); };
  const name = text(input.name, 120);
  if (!name) throw new ApiError_("BAD_REQUEST", "The event needs a name.");
  const date = text(input.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError_("BAD_REQUEST", "The event needs a date.");

  const ticketTypes = (input.ticketTypes || []).map(function (t) {
    const price = Number(t.price);
    if (!text(t.name, 60)) throw new ApiError_("BAD_REQUEST", "Every ticket type needs a name.");
    if (!(price >= 0)) throw new ApiError_("BAD_REQUEST", "Ticket prices must be 0 or more.");
    return {
      id: text(t.id, 20) || newId_("TT"),
      name: text(t.name, 60),
      price: Math.round(price * 100) / 100,
      needsMembership: !!t.needsMembership
    };
  });
  if (!ticketTypes.length) throw new ApiError_("BAD_REQUEST", "Add at least one ticket type.");

  const questions = (input.questions || []).filter(function (q) { return text(q.label); }).map(function (q) {
    const type = q.type === "choice" ? "choice" : "text";
    const options = type === "choice"
      ? (Array.isArray(q.options) ? q.options : String(q.options || "").split(","))
          .map(function (o) { return text(o, 60); }).filter(Boolean)
      : [];
    if (type === "choice" && options.length < 2) throw new ApiError_("BAD_REQUEST", "Choice questions need at least 2 options.");
    return { id: text(q.id, 20) || newId_("Q"), label: text(q.label, 150), type: type, options: options, required: !!q.required };
  });

  const capacity = text(input.capacity) === "" ? "" : Math.max(0, Math.floor(Number(input.capacity) || 0));
  const prefix = text(input.codePrefix, 4).toUpperCase().replace(/[^A-Z0-9]/g, "") || initials_(name);
  const closes = text(input.registrationCloses, 16);
  if (closes && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(closes)) throw new ApiError_("BAD_REQUEST", "Registration closing time doesn't look right.");

  return {
    id: text(input.id, 20),
    name: name,
    description: text(input.description, 4000),
    date: date,
    startTime: text(input.startTime, 5),
    endTime: text(input.endTime, 5),
    location: text(input.location, 150),
    capacity: capacity,
    capacityRule: input.capacityRule === "all" ? "all" : "paid",
    imageFileId: text(input.imageFileId, 80),
    imageUrl: text(input.imageUrl, 300),
    ticketTypes: ticketTypes,
    questions: questions,
    codePrefix: prefix,
    registrationCloses: closes
  };
}

function initials_(name) {
  const letters = name.split(/\s+/).map(function (w) { return w.charAt(0); }).join("").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (letters || "EV").slice(0, 3);
}

function uniqueSlug_(name, events) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "event";
  const taken = {};
  events.forEach(function (e) { taken[e.slug] = true; });
  let slug = base;
  for (let n = 2; taken[slug]; n++) slug = base + "-" + n;
  return slug;
}

/** Turns an Event object back into a row-shaped object (for returning after an update). */
function rowOf_(event) {
  const row = {};
  TABLES.Events.forEach(function (c) {
    const v = event[c];
    row[c] = JSON_COLUMNS[c] ? v : (v === true ? "TRUE" : v === false ? "FALSE" : v === null || v === undefined ? "" : String(v));
  });
  return row;
}
