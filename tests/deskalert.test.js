const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

run(`
TBL.Events = [{ id:"EV1", slug:"mj", name:"Mahjong", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
  status:"published", entryOpen:"TRUE", ticketTypes:[{id:"T2",name:"General",price:9}], questions:[], codePrefix:"MJ", archivedAt:"", summary:{} }];
TBL.Orders = []; TBL.Tickets = [];
insertRow_("Orders", { id:"O1", code:"MJ-1", eventId:"EV1", payerName:"P", payerEmail:"p@x.ca", total:9, status:"paid", createdAt:"2026-10-01T00:00:00Z", notes:"" });
insertRow_("Orders", { id:"O2", code:"MJ-2", eventId:"EV1", payerName:"Q", payerEmail:"q@x.ca", total:9, status:"awaiting", createdAt:"2026-10-01T00:00:00Z", notes:"" });
function tk(id, name, status, flag, orderId) { insertRow_("Tickets", { id:id, secret:(id + "0000000000000000000000000000000").slice(0,32).toLowerCase(), orderId:orderId, eventId:"EV1", name:name, email:"", ucid:"", memberId:"", ticketType:"General", price:9, answers:{}, flag:flag, status:status, checkedInAt:"", createdAt:"2026-10-01T00:00:00Z", emailedAt:"x" }); }
tk("TKTGOOD001", "Good Guest", "paid", "", "O1");
tk("TKTFLAG001", "Flagged Guest", "paid", "Member price, but no membership found", "O1");
tk("TKTUNPD001", "Unpaid Guest", "awaiting", "", "O2");
tk("TKTREFD001", "Refunded Guest", "refunded", "", "O1");
tk("TKTFRESH01", "Fresh Guest", "paid", "", "O1");
var S = function (role, by) { return { name: by, role: role }; };
// the real versions open Google Sheets: the in-memory tables stand in
function table_() {}
function withLock_(fn) { return fn(); }
function findTicketFresh_(kind, value) { return TBL.Tickets.filter(function (t) { return (kind === "secret" ? t.secret : t.id) === value; })[0] || null; }
`);
const alerts = () => run('deskAlerts_("EV1")').alerts;
const scan = (role, scanner, id, atDesk) => run(`REQ_SCANNER_ = ${scanner}; scan_(S("${role}", "Volunteer"), "EV1", "${id}", ${!!atDesk})`);

// A good scan: no alert
scan("door", true, "TKTGOOD001");
ok(alerts().length === 0, "a green check-in makes no alert");

// Orange / red answers from a scanner phone
scan("door", true, "TKTFLAG001");
scan("door", true, "TKTUNPD001");
scan("door", true, "TKTREFD001");
let list = alerts();
ok(list.length === 3, "flagged, unpaid and refunded each make an alert: " + list.length);
ok(list[0].name === "Refunded Guest" && list[0].color === "red", "newest first, refunded is red");
ok(list.some((a) => a.name === "Unpaid Guest" && /Not paid yet/.test(a.reason)), "the unpaid alert says why");
ok(list.some((a) => a.name === "Flagged Guest" && /help desk/.test(a.reason) && a.by === "Volunteer"), "the flagged alert says why and who scanned");

// The same person scanned again within 30 s: still one alert
scan("door", true, "TKTUNPD001");
ok(alerts().filter((a) => a.name === "Unpaid Guest").length === 1, "a repeat scan of the same person does not stack");

// Not from a scanner phone (the help desk's own typed scan): no alert
run(`CacheService.getScriptCache().remove("deskalerts_EV1")`);
scan("exec", false, "TKTUNPD001");
ok(alerts().length === 0, "the help desk's own scan makes no alert");
scan("exec", true, "TKTUNPD001");
ok(alerts().length === 1, "an exec using the scanner page does make one");

// A desk override check-in never alerts
run(`CacheService.getScriptCache().remove("deskalerts_EV1")`);
scan("exec", true, "TKTFLAG001", true);
ok(alerts().length === 0, "a desk override check-in makes no alert");

// Entry closed: nothing for the desk to do
run(`CacheService.getScriptCache().remove("deskalerts_EV1"); TBL.Events[0].entryOpen = "FALSE";`);
scan("door", true, "TKTFRESH01");
ok(alerts().length === 0, "'entry is closed' makes no alert");

// Only the last few are kept
run(`TBL.Events[0].entryOpen = "TRUE"; for (var i = 0; i < 12; i++) { tk("TKTXTRA0" + i, "Extra " + i, "awaiting", "", "O2"); scan_(S("door", "V"), "EV1", "TKTXTRA0" + i, false); }`.replace("scan_(", "REQ_SCANNER_ = true; scan_("));
ok(alerts().length === 8, "only the last 8 are kept: " + alerts().length);

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
