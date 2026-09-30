/**
 * CSS Platform API — activity (the readable change log).
 *
 * The Log tab of the data sheet records every change. This turns each row into a
 * sentence ("Kevin marked MGN-4408 paid") so disputes ("I paid!") are quick to settle.
 */

const ACTIVITY_MAX = 300;

/** Groups the filter chips use. */
const ACTIVITY_GROUPS = {
  payments: ["order.paid", "order.refunded", "order.cancelled", "order.create", "order.manual", "tickets.resend", "reminders.send"],
  door: ["checkin", "checkin.desk", "checkin.undo", "walkin", "entry.open", "entry.close"],
  edits: ["ticket.edit"],
  events: ["event.create", "event.update", "event.status", "image.upload"],
  settings: ["settings.save", "sessions.clear"]
};

function activityGroup_(action) {
  const groups = Object.keys(ACTIVITY_GROUPS);
  for (let i = 0; i < groups.length; i++) if (ACTIVITY_GROUPS[groups[i]].indexOf(action) !== -1) return groups[i];
  return "other";
}

/** newest first; filters: eventId, who, group, query (all optional) */
function activityLog_(filters) {
  filters = filters || {};
  const events = {}, byTicket = {}, byOrderCode = {};
  allEvents_().forEach(function (e) { events[e.id] = e.name; });
  readRows_("Tickets").forEach(function (t) { byTicket[t.id] = t.eventId; });
  readRows_("Orders").forEach(function (o) { byOrderCode[o.code] = o.eventId; });

  // Newest rows are at the bottom of the sheet; read from the end, up to a generous cap
  const rows = readLastRows_("Log", 2000).reverse();
  const q = String(filters.query || "").trim().toLowerCase();
  const out = [];
  const people = {};

  rows.forEach(function (r) {
    people[r.who] = true;
    const eventId = events[r.target] ? r.target : (byTicket[r.target] || byOrderCode[r.target] || "");
    const group = activityGroup_(r.action);
    if (filters.eventId && eventId !== filters.eventId) return;
    if (filters.who && r.who !== filters.who) return;
    if (filters.group && filters.group !== "all" && group !== filters.group) return;
    const summary = activitySummary_(r, events);
    if (q && (summary + " " + r.target + " " + r.who).toLowerCase().indexOf(q) === -1) return;
    if (out.length < ACTIVITY_MAX) out.push({ time: r.time, who: r.who, action: r.action, group: group, target: r.target, eventId: eventId, summary: summary });
  });

  return { ok: true, entries: out, people: Object.keys(people).sort(), truncated: out.length >= ACTIVITY_MAX };
}

function activitySummary_(r, events) {
  let d = {};
  try { d = JSON.parse(r.details || "{}") || {}; } catch (e) { d = {}; }
  const money = function (n) { return moneyText_(n); };
  const eventName = events[r.target] || "";
  switch (r.action) {
    case "order.paid": return "marked " + r.target + " paid (" + money(d.total) + ", " + d.tickets + " ticket" + (d.tickets === 1 ? "" : "s") + ")" + (d.overCapacity ? ", over capacity" : "");
    case "order.refunded": return "refunded " + r.target + " (" + money(d.total) + ")" + (d.reason ? ": " + d.reason : "");
    case "order.cancelled": return "cancelled " + r.target + (d.reason ? ": " + d.reason : "");
    case "order.create": return "registered online: " + r.target + " for " + (d.event || "an event") + " (" + d.tickets + " ticket" + (d.tickets === 1 ? "" : "s") + ", " + money(d.total) + ")";
    case "order.manual": return "added " + d.name + " as paid: " + r.target + " (" + d.type + ", " + money(d.total) + ")";
    case "tickets.lookup": return "a member used Find my tickets (" + (d.by === "ucid" ? "UCID" : "email") + ", " + (d.emails || 0) + " email" + (d.emails === 1 ? "" : "s") + " sent)";
    case "pass.lookup": return "a member used Find my pass (" + (d.by === "ucid" ? "UCID" : "email") + ", " + (d.sent ? "email sent" : "nothing sent") + ")";
    case "tickets.resend": return "resent tickets for order " + r.target;
    case "reminders.send": return "sent " + (d.sent || 0) + " payment reminder" + (d.sent === 1 ? "" : "s");
    case "checkin": return "checked in " + d.name;
    case "checkin.desk": return "checked in " + d.name + " at the help desk" + (d.flag ? " (" + d.flag + ")" : "");
    case "checkin.undo": return "undid the check-in of " + d.name;
    case "walkin": return "added walk-in " + d.name + " (" + d.type + ", " + money(d.total) + " " + d.method + ") " + r.target;
    case "entry.open": return "opened entry" + (eventName ? " for " + eventName : "");
    case "entry.close": return "closed entry" + (eventName ? " for " + eventName : "");
    case "ticket.edit": {
      const parts = Object.keys(d.to || {}).map(function (k) {
        const show = function (v) { return typeof v === "object" ? JSON.stringify(v) : (v === "" || v === undefined ? "(blank)" : String(v)); };
        return k + ": " + show((d.from || {})[k]) + " → " + show(d.to[k]);
      });
      return "edited " + (d.name || r.target) + (d.order ? " (" + d.order + ")" : "") + ": " + parts.join("; ");
    }
    case "event.create": return "created the event " + (d.name || "");
    case "event.update": return "edited the event " + (d.name || "");
    case "event.status": return "set " + (eventName || "an event") + " to " + d.status;
    case "image.upload": return "uploaded an event image";
    case "settings.save": return "changed settings: " + (d.changed || []).join(", ");
    case "sessions.clear": return "signed everyone out";
    default: return r.action + (r.target ? " " + r.target : "");
  }
}
