// "My tickets": a ticket belongs to the attendee, ambiguous registrations are never silently added, and cancelled tickets explain themselves.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const fn = (code) => { try { return { ok: run(code) }; } catch (e) { return { error: e.code, message: e.message }; } };

run(`
TBL.Events = [{ id:"EV1", slug:"mj", name:"Mahjong", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
  status:"published", entryOpen:"FALSE", ticketTypes:[], questions:[], codePrefix:"MJ", archivedAt:"", summary:{} },
  { id:"EVOLD", slug:"old", name:"Old", date:"2020-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
  status:"published", entryOpen:"FALSE", ticketTypes:[], questions:[], codePrefix:"OL", archivedAt:"", summary:{} }];
TBL.__members = [{ memberId:"CSS0011234", name:"Mia Member", email:"mia@gmail.com", ucid:"30111222", paid:true }];
TBL.Orders = [
  { id:"O1", code:"MJ-1", eventId:"EV1", payerName:"Dad Member", payerEmail:"dad@x.ca", total:24, status:"paid", createdAt:"2026-10-01T00:00:00Z", notes:"" },
  { id:"O2", code:"MJ-2", eventId:"EV1", payerName:"Someone", payerEmail:"s@x.ca", total:8, status:"awaiting", createdAt:"2026-10-01T00:00:00Z", notes:"" },
  { id:"OF", code:"MJ-3", eventId:"EV1", payerName:"Gone", payerEmail:"g@x.ca", total:8, status:"cancelled", createdAt:"2026-10-01T00:00:00Z", notes:"registration failed: timed out" }
];
var n = 0;
function tk(id, orderId, eventId, name, email, status, extra) { TBL.Tickets.push(Object.assign({ id:id, secret:(id+"0000000000000000000000000000").slice(0,32).toLowerCase(), orderId:orderId, eventId:eventId, name:name, email:email, ucid:"", memberId:"", ticketType:"General", price:8, answers:{}, flag:"", status:status, checkedInAt:"", createdAt:"2026-10-01T00:00:00Z" }, extra || {})); }
TBL.Tickets = [];
// Dad paid for three: his own, Mia's (Mia's email on it), and a friend's who typed Mia's UCID by mistake
tk("TKTDAD01", "O1", "EV1", "Dad Member", "dad@x.ca", "paid");
tk("TKTMIA01", "O1", "EV1", "Mia Member", "mia@gmail.com", "paid");
tk("TKTFRND1", "O1", "EV1", "Frank Friend", "frank@x.ca", "paid", { ucid:"30111222" });   // wrong UCID typed: Mia's number, Frank's name
// a ticket with Mia's verified member ID and her name but no email
tk("TKTMIA02", "O2", "EV1", "Mia M.", "", "awaiting", { memberId:"CSS0011234" });
// cancelled and refunded tickets of Mia's, a failed registration, and an old event
tk("TKTMIA03", "O2", "EV1", "Mia Member", "mia@gmail.com", "refunded");
tk("TKTFAIL1", "OF", "EV1", "Mia Member", "mia@gmail.com", "cancelled");
tk("TKTOLD01", "O1", "EVOLD", "Mia Member", "mia@gmail.com", "paid");
`);
const KEY = run('linkKey_("pass", "CSS0011234")');
const mine = run(`myTickets_({ memberId: "CSS0011234", k: "${KEY}" })`);
const ids = mine.tickets.map((t) => t.id).sort();
ok(ids.indexOf("TKTMIA01") !== -1, "a ticket someone else paid for shows up for the attendee (her email is on it)");
ok(ids.indexOf("TKTMIA02") !== -1, "a ticket with her member ID and her name shows up even with no email");
ok(ids.indexOf("TKTDAD01") === -1, "the person who paid does not get the attendee's ticket in her account, and her account has none of his");
ok(ids.indexOf("TKTFRND1") === -1 && mine.possible === 1, "a friend's ticket that only carries her UCID (different name) is NOT added, and is counted as 'possible'");
const cancelled = mine.tickets.find((t) => t.id === "TKTMIA03");
ok(cancelled && cancelled.status === "cancelled", "a refunded ticket is shown as cancelled, so 'where did my ticket go?' has an answer");
ok(ids.indexOf("TKTFAIL1") === -1, "a registration that never completed is not shown");
ok(ids.indexOf("TKTOLD01") === -1, "tickets for events already past are not shown");
ok(mine.emailHint === "m*****@gmail.com", "the screen can show which email to use: " + mine.emailHint);
ok(mine.tickets.every((t) => t.event && t.event.name), "each ticket carries its event");

// A wrong key shows nothing
ok(fn('myTickets_({ memberId: "CSS0011234", k: "wrong" })').error === "NOT_ALLOWED", "a wrong key is refused");

// Guest by email: only tickets with that email
const guest = run(`myTickets_({ email: "dad@x.ca", k: "${run('linkKey_("tix", "dad@x.ca")')}" })`);
ok(guest.tickets.length === 1 && guest.tickets[0].id === "TKTDAD01", "a guest link shows only the tickets with that email");

// ---- F2: the door's member-pass scan and My tickets use the same rule (ticketOwnership_) -----------------------------
run(`
TBL.Events.push({ id:"EV2", slug:"bbq", name:"BBQ", date:"2099-02-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
  status:"published", entryOpen:"TRUE", ticketTypes:[], questions:[], codePrefix:"BB", archivedAt:"", summary:{} });
TBL.Orders.push({ id:"OB", code:"BB-1", eventId:"EV2", payerName:"P", payerEmail:"p@x.ca", total:8, status:"paid", createdAt:"2026-10-01T00:00:00Z", notes:"" });
TBL.__members.push(
  { memberId:"CSS0000001", name:"Ann Alpha", email:"ann@x.ca", ucid:"30000001", paid:true },
  { memberId:"CSS0000002", name:"Ben Beta", email:"ben@x.ca", ucid:"30000002", paid:true },
  { memberId:"CSS0000003", name:"Cat Gamma", email:"cat@x.ca", ucid:"30000003", paid:true },
  { memberId:"CSS0000004", name:"Dee Delta", email:"dee@x.ca", ucid:"30000004", paid:true },
  { memberId:"CSS0000005", name:"Eve Echo", email:"eve@x.ca", ucid:"30000005", paid:true });
tk("TKTANN001", "OB", "EV2", "Ann Alpha", "ann@x.ca", "paid");                                 // email match, her name
tk("TKTBEN001", "OB", "EV2", "Ben Beta", "", "paid", { ucid:"30000002" });                      // UCID match, his name, no email
tk("TKTCAT001", "OB", "EV2", "Frank Friend", "frank@x.ca", "paid", { ucid:"30000003" });        // Cat's UCID next to someone else's name
tk("TKTDEE001", "OB", "EV2", "Fiona Friend", "dee@x.ca", "paid");                               // Dee registered two friends with her email
tk("TKTDEE002", "OB", "EV2", "Gus Guest", "dee@x.ca", "paid");
tk("TKTEVE001", "OB", "EV2", "Eve Echo", "eve@x.ca", "paid");                                   // Eve's own ticket ...
tk("TKTEVE002", "OB", "EV2", "Hal Other", "hal@x.ca", "paid", { ucid:"30000005" });             // ... and someone who typed her UCID
function table_() {}
function withLock_(fn) { return fn(); }
function findTicketFresh_(kind, value) { return TBL.Tickets.filter(function (t) { return (kind === "secret" ? t.secret : t.id) === value; })[0] || null; }
var DOOR = { name:"Volunteer", role:"door", sid:"S1" };
`);
const listed = (id) => run(`myTickets_({ memberId: "${id}", k: linkKey_("pass", "${id}") })`);
const onEv2 = (r) => r.tickets.filter((t) => t.event.slug === "bbq").map((t) => t.id).sort();
const doorScan = (id) => run(`REQ_SCANNER_ = true; scan_(DOOR, "EV2", "${id}", false).result`);
const checkedIn = (id) => !!run(`TBL.Tickets.filter(function (t) { return t.id === "${id}"; })[0].checkedInAt`);
const alertFor = (name) => run(`deskAlerts_("EV2").alerts.filter(function (a) { return a.name === "${name}"; })[0] || null`);

let r = listed("CSS0000001"), s = doorScan("CSS0000001");
ok(onEv2(r).join() === "TKTANN001" && s.color === "green" && checkedIn("TKTANN001"), "email match: My tickets lists it and the pass checks in that same ticket");
r = listed("CSS0000002"); s = doorScan("CSS0000002");
ok(onEv2(r).join() === "TKTBEN001" && s.color === "green" && checkedIn("TKTBEN001"), "UCID + matching name: My tickets lists it and the pass checks in that same ticket");
r = listed("CSS0000003"); s = doorScan("CSS0000003");
ok(onEv2(r).length === 0 && r.possible === 1, "UCID with someone else's name: My tickets does not list it (counted as possible)");
ok(s.color === "orange" && s.message === "Go to the help desk." && !checkedIn("TKTCAT001"), "... and the pass does NOT check it in: the volunteer is told only 'Go to the help desk.'");
const catAlert = alertFor("Cat Gamma");
ok(catAlert && /another name/.test(catAlert.reason) && /Frank Friend/.test(catAlert.reason), "... and the help desk sees why: " + (catAlert && catAlert.reason));
r = listed("CSS0000004"); s = doorScan("CSS0000004");
ok(onEv2(r).join() === "TKTDEE001,TKTDEE002", "two friends' tickets with the member's email: both listed in her My tickets");
ok(s.color === "orange" && s.message === "Go to the help desk." && !checkedIn("TKTDEE001") && !checkedIn("TKTDEE002"), "... but the pass doesn't guess which one to use: help desk, nothing checked in");
const deeAlert = alertFor("Dee Delta");
ok(deeAlert && /Fiona Friend/.test(deeAlert.reason) && /Gus Guest/.test(deeAlert.reason), "... and the help desk sees both names: " + (deeAlert && deeAlert.reason));
r = listed("CSS0000005"); s = doorScan("CSS0000005");
ok(onEv2(r).join() === "TKTEVE001" && r.possible === 1 && s.color === "green" && checkedIn("TKTEVE001") && !checkedIn("TKTEVE002"), "her own ticket plus a stranger's with her UCID: the pass checks in HER ticket only");
s = doorScan("CSS0000005");
ok(s.color === "orange" && /Already checked in/.test(run(`scan_({ name:"Desk", role:"exec" }, "EV2", "CSS0000005", false).result.message`)), "scanning her pass again says already checked in (the stranger's ticket is never used up)");
// Member history attributes tickets the same way
const owner = (id) => (run(`memberOfTicket_(TBL.Tickets.filter(function (t) { return t.id === "${id}"; })[0], TBL.__members)`) || {}).memberId || "";
ok(owner("TKTANN001") === "CSS0000001" && owner("TKTBEN001") === "CSS0000002" && owner("TKTCAT001") === "" && owner("TKTEVE002") === "" && owner("TKTDEE001") === "CSS0000004",
  "history/feedback credit the same member My tickets does (never the one whose UCID was typed under another name)");

// ---- F3: closing sign-ups never hides tickets people already have -------------------------------------------------
run(`TBL.Events[0].status = "closed"; TBL.Events[0].entryOpen = "TRUE";
var MAILED = []; function sendMyTicketsEmail_(to, items) { MAILED.push({ to: to, n: items.length }); return true; }`);
const closedList = onEvent("mj");
function onEvent(slug) { return run(`myTickets_({ memberId: "CSS0011234", k: "${KEY}" })`).tickets.filter((t) => t.event.slug === slug).map((t) => t.id); }
ok(closedList.indexOf("TKTMIA01") !== -1 && closedList.indexOf("TKTMIA02") !== -1, "sign-ups closed: the member's tickets still show in My tickets");
const guestClosed = run(`myTickets_({ email: "dad@x.ca", k: linkKey_("tix", "dad@x.ca") })`);
ok(guestClosed.tickets.length === 1, "sign-ups closed: a guest's tickets still show too");
run(`findMyTickets_({ email: "mia@gmail.com" })`);
ok(run("MAILED.length") === 1 && run("MAILED[0].n") >= 1, "sign-ups closed: 'Find my tickets' still emails the ticket links");
const access = fn(`openMyAccess_({ ucid: "30111222", lastName: "Friend" })`);
ok(access.ok && access.ok.kind === "tickets", "sign-ups closed: UCID + last name still opens a guest's tickets");
ok(run(`getTicket_(TBL.Tickets.filter(function (t) { return t.id === "TKTDAD01"; })[0].secret).ticket.status`) === "paid", "sign-ups closed: the ticket page still opens");
const closedScan = run(`scan_({ name:"Desk", role:"exec" }, "EV1", "https://events/ticket.html?t=" + TBL.Tickets.filter(function (t) { return t.id === "TKTDAD01"; })[0].secret, false).result`);
ok(closedScan.color === "green", "sign-ups closed: the ticket still checks in at the door: " + closedScan.message);
ok(!run(`publicEvents_().events.some(function (e) { return e.slug === "mj"; })`), "a closed event is still left off the public events list (no new sign-ups)");
run(`TBL.Events[0].status = "draft"`);
ok(onEvent("mj").length === 0, "a draft event's tickets are not listed");
run(`TBL.Events[0].status = "archived"`);
ok(onEvent("mj").length === 0, "an archived event's tickets are not listed");
run(`TBL.Events[0].status = "published"`);

// ---- F16: the guest My tickets page (public/tickets.js) -----------------------------------------------------------
(async () => {
  const fs = require("fs"), vm = require("vm"), path = require("path");
  const pub = path.join(__dirname, "..", "public");
  const page = (reply, saved) => {
    const els = {}, store = {};
    if (saved) store.CSS_MY_TICKETS_LINK = JSON.stringify(saved);
    const el = (id) => els[id] || (els[id] = { id, hidden: false, textContent: "", innerHTML: "", value: "", style: {}, dataset: {}, href: "", addEventListener() {} });
    const ctx = {
      console, URLSearchParams, JSON, AbortSignal, setTimeout: () => 0,
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
      document: { getElementById: el, querySelectorAll: () => [] },
      location: { search: "", pathname: "/tickets.html", href: "" }, history: { replaceState() {} },
      fetch: async () => { if (reply === "offline") throw new Error("offline"); return { json: async () => reply }; }
    };
    vm.createContext(ctx);
    for (const f of ["config.js", "strings.js", "tickets.js"]) vm.runInContext(fs.readFileSync(path.join(pub, f), "utf8"), ctx);
    return { ctx, els, store, run: (code) => vm.runInContext(code, ctx) };
  };
  const WHO = { email: "guest@example.com", k: "TEST-KEY" };
  const S = require("vm").runInNewContext(fs.readFileSync(path.join(pub, "strings.js"), "utf8") + ";T");
  for (const [label, reply] of [["BUSY", { ok: false, error: "BUSY", message: "Busy" }], ["TEMPORARY (Google slow)", { ok: false, error: "TEMPORARY", message: "Google was slow" }],
    ["SERVER_ERROR", { ok: false, error: "SERVER_ERROR" }], ["a timeout / no connection", "offline"]]) {
    const p = page(reply, WHO);
    await p.run(`showMyTickets(${JSON.stringify(WHO)})`);
    ok(p.store.CSS_MY_TICKETS_LINK && p.els["find-result"].textContent === S.myTicketsBusy && !(p.els["my-list"] && p.els["my-list"].hidden === false),
      "guest page, " + label + ": keeps the saved link and says try again (not 'bad link', not 'no tickets')");
  }
  const bad = page({ ok: false, error: "NOT_ALLOWED", message: "This link isn't valid." }, WHO);
  await bad.run(`showMyTickets(${JSON.stringify(WHO)})`);
  ok(!bad.store.CSS_MY_TICKETS_LINK && bad.els["find-result"].textContent === S.myTicketsExpired, "guest page, a link the server rejects: forgotten, and the page says to ask for a new one");
  const ev = { name: "TEST Event", date: "2099-01-01", startTime: "18:00", location: "MSC" };
  const mixed = page({ ok: true, name: "Guest", tickets: [
    { name: "TEST One", ticketType: "General", status: "cancelled", orderCode: "AUD-1", secret: "s1", event: ev },
    { name: "TEST Two", ticketType: "General", status: "awaiting", orderCode: "AUD-2", secret: "s2", event: ev },
    { name: "TEST Three", ticketType: "General", status: "paid", orderCode: "AUD-3", secret: "s3", event: ev }] }, null);
  await mixed.run(`showMyTickets(${JSON.stringify(WHO)})`);
  const cards = mixed.els["my-cards"].innerHTML.split("<li>").filter(Boolean);
  ok(/Cancelled/.test(cards[0]) && !/Waiting for payment|AUD-1/.test(cards[0]) && /state void/.test(cards[0]), "guest page: a cancelled ticket says Cancelled, with no payment code");
  ok(/Waiting for payment · code AUD-2/.test(cards[1]) && /Paid/.test(cards[2]), "guest page: unpaid and paid tickets read as before");
  ok(mixed.store.CSS_MY_TICKETS_LINK, "guest page: a good reply saves the link on this device");
})().catch((e) => { console.log("FAIL guest page test crashed: " + e.message); fails++; }).then(() => {
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
});
