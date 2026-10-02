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

// The scanner phone is told only "go to the help desk"; the desk's alert and the desk's own scan keep the reason
run(`CacheService.getScriptCache().remove("deskalerts_EV1"); REQ_SCANNER_ = true;`);
const phone = scan("door", true, "TKTUNPD001").result;
ok(phone.message === "Go to the help desk." && phone.color === "orange" && phone.person.name === "Unpaid Guest" && phone.desk === undefined, "scanner phone: short message, name kept: " + JSON.stringify(phone.message));
ok(/Not paid yet/.test(alerts()[0].reason), "the desk alert still carries the full reason");
const deskScan = scan("exec", false, "TKTUNPD001").result;
ok(/Not paid yet/.test(deskScan.message), "the help desk's own scan keeps the full message");
ok(scan("door", true, "TKTGOOD001").result.message.indexOf("Already checked in") === 0, "'already checked in' stays as it was");

// Only the last few are kept
run(`TBL.Events[0].entryOpen = "TRUE"; for (var i = 0; i < 12; i++) { tk("TKTXTRA0" + i, "Extra " + i, "awaiting", "", "O2"); scan_(S("door", "V"), "EV1", "TKTXTRA0" + i, false); }`.replace("scan_(", "REQ_SCANNER_ = true; scan_("));
ok(alerts().length === 8, "only the last 8 are kept: " + alerts().length);

// ---- Scan log
run(`CacheService.getScriptCache().remove("scanlog_EV1"); TBL.__members = [{ memberId:"CSS0011234", name:"Mia Member", paid:true, email:"mia@x.ca", ucid:"30111222" }]; TBL.Events[0].entryOpen = "TRUE";`);
scan("door", true, "CSS0011234");        // a member with no ticket
scan("door", true, "CSS-0099999");       // not on the sheet
scan("door", true, "hello world");       // unreadable
const lg = run('scanLog_("EV1")').log;
ok(lg.length === 3 && lg[0].kind === "unreadable" && lg[0].color === "red", "every scan is logged, newest first, unreadable ones too: " + lg.length);
ok(/not there/.test(lg[1].note) && lg[1].value === "CSS0099999" && /Member ID not found/.test(lg[1].message), "a missing member says what was looked up and the full message: " + lg[1].note);
ok(/Mia Member/.test(lg[2].note) && /no ticket/.test(lg[2].note) && lg[2].via === "scanner", "a member with no ticket logs who they are and why: " + lg[2].note);
const secretScan = run(`(function(){ SCAN_NOTE_ = ""; return noteScanLog_(S("exec","E"), "EV1", "https://events/ticket.html?t=0123456789abcdef0123456789abcdef", false, { color:"green", message:"ok", person:{ id:"x", name:"N" } }); })()`);
ok(run('scanLog_("EV1")').log[0].raw.indexOf("0123456789abcdef0123") === -1, "ticket secrets are cut short in the log");
ok(run('scanLog_("EV1")').log.length === 4, "log grows");

// ---- A pass nobody recognized still reaches the help desk
run('CacheService.getScriptCache().remove("deskalerts_EV1")');
const unknown = scan("door", true, "CSS-0099999").result;
ok(unknown.message.indexOf("Go to the help desk") === 0 && /wasn't recognized/.test(unknown.message), "the phone says go to the help desk and that the pass wasn't recognized: " + unknown.message);
const ua = alerts();
ok(ua.length === 1 && ua[0].name === "Unrecognized member pass" && /Member ID not found/.test(ua[0].reason) && /CSS-0099999/.test(ua[0].reason), "the desk gets an alert with what the scanner read: " + (ua[0] && ua[0].reason));
scan("door", true, "hello world");
ok(alerts().length === 1, "an unreadable code makes no alert (the scanner just scans again)");
const memberAlert = scan("door", true, "CSS0011234").result;
ok(alerts()[0].name === "Mia Member", "a known member with no ticket alerts under their name");

// ---- The real member pass QR is a link with the ID in the path
for (const text of ["http://member.ucalgarycss.ca/CSS0011234", "https://member.ucalgarycss.ca/CSS0011234/", "https://member.ucalgarycss.ca/pass/css-0011234?x=1", "CSS0011234", "CSS-0011234", "https://member.ucalgarycss.ca/?member=CSS0011234"]) {
  const k = run("ticketKey_(" + JSON.stringify(text) + ")");
  ok(k && k.kind === "member" && k.value === "CSS0011234", "member pass text reads as CSS0011234: " + text + " -> " + JSON.stringify(k));
}
ok(run('ticketKey_("https://events.ucalgarycss.ca/ticket.html?t=0123456789abcdef0123456789abcdef")').kind === "secret", "a ticket link is still a ticket");
const viaLink = scan("door", true, "http://member.ucalgarycss.ca/CSS0011234").result;
ok(viaLink.person && /Mia Member/.test(viaLink.person.name), "scanning the real pass link finds the member (then no ticket): " + JSON.stringify(viaLink.message));

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
