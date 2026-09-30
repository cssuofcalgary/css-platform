// CSS Platform stress test. Run it yourself in a terminal (it asks for the exec password, typed hidden):
//
//     node stress-test/stress-test.mjs
//
// It talks to the LIVE API, so it makes a clearly-named test event ("LOAD TEST ... (delete me)"), then:
//   1. 50 people register AT THE SAME TIME (10 of the orders include a buddy; 5 orders are free; 5 use a member
//      price with a made-up member ID so they get flagged for the help desk)
//   2. Finance marks 25 of the paid-type orders paid AT THE SAME TIME
//   3. Door: every ticket is scanned by two scanners at the same instant, plus unpaid, flagged and fake codes
//   4. Checks the numbers (exactly one green per ticket, counts match) and prints PASS/FAIL + timings
//
// Emails: payers go to gordonchen04+stNN@gmail.com, buddies to epicfacewizzard46+bNN@gmail.com (plus-addresses land in
// the normal inbox, but each is unique so the "5 registrations per email" limit and duplicate flags don't interfere).
// Roughly 100 emails are sent (the CSS Gmail can send 500 a day).
//
// Options:  --regs 50 --paid 25 --burst 30   (burst = most requests in flight at once during the door test)
//           --raw   no automatic retries (harshest view); default behaves like the real pages

import readline from "node:readline";
import { randomUUID } from "node:crypto";

const API = process.env.CSS_API || "https://script.google.com/macros/s/AKfycbxJ_a_cHyRXadK17ocIebhE2XDFcpEADCzSqOVXwdCgIQe1T-UPi-efzgla2mn7ML2d/exec";   // CSS_API only for dry runs against a local copy
const SITE = "https://events.ucalgarycss.ca/";
const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > -1 ? Number(process.argv[i + 1]) : fallback; };
const REGS = arg("regs", 50), PAID = arg("paid", 25), BURST = arg("burst", 30);
const PAYER_MAIL = (n) => `gordonchen04+st${String(n).padStart(2, "0")}@gmail.com`;
const BUDDY_MAIL = (n) => `epicfacewizzard46+b${String(n).padStart(2, "0")}@gmail.com`;

// ---- helpers ----------------------------------------------------------------------------------
async function ask(question, hidden) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(answer.trim()); }));
}

async function call(action, body = {}) {
  const started = Date.now();
  try {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, ...body }), signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: false, error: "NOT_JSON", message: `HTTP ${res.status}: ${text.slice(0, 120).replace(/\s+/g, " ")}` }; }
    return { ...data, _ms: Date.now() - started };
  } catch (err) {
    return { ok: false, error: "NETWORK", message: String(err.message || err), _ms: Date.now() - started };
  }
}

// Default = behave like the real pages: "busy" is retried automatically (up to 4 tries), and a registration carries one
// requestId so a retry can never make a second order. --raw = no retries at all (the harshest view of the server).
const RAW = process.argv.includes("--raw");
let retriedRequests = 0, retryCount = 0;
async function send(action, body = {}) {
  if (RAW) return call(action, body);
  const started = Date.now();
  let r, tries = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    tries = attempt;
    r = await call(action, body);
    const again = !r.ok && (r.error === "BUSY" || (action === "register" && ["TEMPORARY", "NETWORK"].includes(r.error)));
    if (!again || attempt === 4) break;
    await new Promise((res) => setTimeout(res, 1200 * attempt));
  }
  if (tries > 1) { retriedRequests++; retryCount += tries - 1; }
  return { ...r, _ms: Date.now() - started, _tries: tries };
}

/** Runs tasks with at most `limit` in flight (limit >= tasks.length = all at once). */
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; results[i] = await tasks[i](); }
  }));
  return results;
}

const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0; };
const timing = (rs) => { const ms = rs.map((r) => r._ms); return `median ${pct(ms, 50)} ms, 95th ${pct(ms, 95)} ms, slowest ${Math.max(...ms)} ms`; };
const tally = (rs) => rs.reduce((m, r) => { const k = r.ok ? "ok" : (r.error || "error"); m[k] = (m[k] || 0) + 1; return m; }, {});
const checks = [];
const need = (name, count) => check(name, count > 0, count > 0 ? count + " found" : "nothing to test: an earlier step failed");
const check = (name, pass, detail) => { checks.push({ name, pass }); console.log(`   ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };
const heading = (t) => console.log(`\n=== ${t} ===`);

// ---- main -------------------------------------------------------------------------------------
const password = process.env.CSS_EXEC_PASSWORD || await ask("Exec password: ", true);
const who = ["Stress A", "Stress B", "Stress C"];
const sessions = [];
for (const name of who) {
  const r = await call("login", { password, name });
  if (!r.ok) { console.error("Sign-in failed:", r.message || r.error); process.exit(1); }
  sessions.push(r.token);
}
const token = sessions[0];
console.log(`Signed in as ${who.length} scanners/finance users (sign-in took about ${Math.round((await call("login", { password, name: "Stress D" }))._ms / 100) / 10}s).`);

// 1. the test event
heading("Setting up the test event");
const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
const saved = await call("saveEvent", { token, event: {
  name: `LOAD TEST ${new Date().toISOString().slice(5, 16)} (delete me)`, date: tomorrow, startTime: "18:00", endTime: "21:00", location: "Nowhere (test)",
  description: "Automated load test. Safe to archive.", capacity: "", capacityRule: "paid", codePrefix: "LT",
  ticketTypes: [{ name: "Member", price: 4, needsMembership: true }, { name: "Non-member", price: 9, needsMembership: false }, { name: "Guest", price: 0, needsMembership: false }],
  questions: [{ label: "Drink", type: "choice", options: ["Water", "Tea", "Juice"], required: false }]
} });
if (!saved.ok) { console.error("Couldn't create the event:", saved.message || saved.error); process.exit(1); }
const eventId = saved.event.id;
await call("setEventStatus", { token, eventId, status: "published" });
const pub = await call("publicEvent", { slug: saved.event.slug });
const typeId = Object.fromEntries(pub.event.ticketTypes.map((t) => [t.name, t.id]));
console.log(`Event ${saved.event.name} is published (${saved.event.slug}).`);

// 2. everyone registers at once
heading(`Step 1: ${REGS} people register at the same moment`);
const plan = Array.from({ length: REGS }, (_, i) => {
  const n = i + 1;
  const kind = n <= 5 ? "free" : n <= 10 ? "memberFlagged" : "nonMember";
  const buddy = n > 10 && n <= 20;   // 10 orders bring a buddy (paid-type orders)
  const people = [{ name: `Stress Person ${String(n).padStart(2, "0")}`, email: PAYER_MAIL(n),
    ticketTypeId: typeId[kind === "free" ? "Guest" : kind === "memberFlagged" ? "Member" : "Non-member"],
    memberId: kind === "memberFlagged" ? "CSS9999999" : "", answers: { [pub.event.questions[0].id]: ["Water", "Tea", "Juice"][n % 3] } }];
  if (buddy) people.push({ name: `Stress Buddy ${String(n).padStart(2, "0")}`, email: BUDDY_MAIL(n), ticketTypeId: typeId["Non-member"], answers: {} });
  return { n, kind, people, tickets: people.length };
});
const t0 = Date.now();
const regs = await pool(plan.map((p) => () => send("register", { slug: saved.event.slug, people: p.people, etransferName: p.people[0].name, website: "", requestId: randomUUID() })), REGS);
console.log(`All ${REGS} sent; everything answered after ${((Date.now() - t0) / 1000).toFixed(1)}s. ${timing(regs)}`);
console.log("   results:", JSON.stringify(tally(regs)));
regs.filter((r) => !r.ok).slice(0, 5).forEach((r) => console.log("   sample failure:", r.error, "-", r.message));
await new Promise((r) => setTimeout(r, 4000));
const all = await call("listOrders", { token, eventId, filter: "all", limit: 200 });
const okRegs = regs.filter((r) => r.ok).length;
need("at least one registration succeeded", okRegs);
check("every 'ok' registration exists exactly once in the sheet", all.ok && all.total === okRegs, `${okRegs} ok replies, ${all.total} orders`);
check("no registration was lost or doubled by the blast", all.ok && new Set(all.orders.map((o) => o.code)).size === all.orders.length, "payment codes are unique");
check(`all ${REGS} registrations got through`, okRegs === REGS, `${okRegs}/${REGS}; failures mean people would have seen an error`);
const free = all.ok ? all.orders.filter((o) => o.status === "paid").length : 0;
check("free (RSVP) orders were marked paid automatically", free >= Math.min(5, okRegs), `${free} paid already`);
const ticketsEmailed = all.ok ? all.orders.flatMap((o) => o.tickets).filter((t) => t.status === "paid" && t.emailedAt && !String(t.emailedAt).startsWith("test")).length : 0;
check("free RSVP tickets were emailed with their QR", ticketsEmailed >= Math.min(5, okRegs), `${ticketsEmailed} emailed`);

// 3. finance marks 25 paid at once
heading(`Step 2: Finance marks ${PAID} orders (+3 flagged ones) paid at the same moment`);
const awaitingOrders = (all.orders || []).filter((o) => o.status === "awaiting");
// PAID normal orders, plus 3 flagged ones so the help-desk path (paid but flagged) is tested too
const toPay = awaitingOrders.filter((o) => !o.tickets.some((t) => t.flag)).slice(0, PAID).concat(awaitingOrders.filter((o) => o.tickets.some((t) => t.flag)).slice(0, 3));
const paid = await pool(toPay.map((o) => () => send("markOrderPaid", { token: sessions[0], orderId: o.id, siteUrl: SITE })), toPay.length);
console.log(`   ${timing(paid)}; results:`, JSON.stringify(tally(paid)));
paid.filter((r) => !r.ok).slice(0, 5).forEach((r) => console.log("   sample failure:", r.error, "-", r.message));
await new Promise((r) => setTimeout(r, 3000));
const after = await call("listOrders", { token, eventId, filter: "all", limit: 200 });
need("there were orders to pay", toPay.length);
const payOk = paid.filter((r) => r.ok).length;
check(`all ${toPay.length} payments went through`, payOk === toPay.length, `${payOk}/${toPay.length}`);
check("the orders really say paid, with every ticket paid", after.ok && toPay.every((o) => { const x = after.orders.find((y) => y.id === o.id); return x && x.status === "paid" && x.tickets.every((t) => t.status === "paid"); }));
const unsent = after.ok ? after.unsentEmails : -1;
console.log(`   ticket emails still waiting: ${unsent}`);

// 4. the door
heading("Step 3: the door (3 scanners, every ticket scanned twice at the same instant)");
await call("setEntryOpen", { token, eventId, open: true });
const tickets = (after.orders || []).flatMap((o) => o.tickets.map((t) => ({ ...t, orderStatus: o.status })));
const payable = tickets.filter((t) => t.status === "paid" && !t.flag);
const unpaid = tickets.filter((t) => t.status === "awaiting");
const flagged = tickets.filter((t) => t.flag);
need("there were paid tickets to scan", payable.length);
const scanTasks = [];
payable.forEach((t, i) => {
  scanTasks.push(() => send("scan", { token: sessions[i % 3], eventId, code: t.secret }).then((r) => ({ r, t, kind: "valid" })));
  scanTasks.push(() => send("scan", { token: sessions[(i + 1) % 3], eventId, code: `${SITE}ticket.html?t=${t.secret}` }).then((r) => ({ r, t, kind: "valid" })));
});
unpaid.slice(0, 10).forEach((t) => scanTasks.push(() => send("scan", { token: sessions[0], eventId, code: t.secret }).then((r) => ({ r, t, kind: "unpaid" }))));
flagged.slice(0, 5).forEach((t) => scanTasks.push(() => send("scan", { token: sessions[1], eventId, code: t.secret }).then((r) => ({ r, t, kind: "flagged" }))));
for (let i = 0; i < 5; i++) scanTasks.push(() => send("scan", { token: sessions[2], eventId, code: `${SITE}ticket.html?t=${"f".repeat(31)}${i}` }).then((r) => ({ r, t: null, kind: "fake" })));
scanTasks.sort(() => Math.random() - 0.5);   // interleave, like a real queue
const s0 = Date.now();
const scans = await pool(scanTasks, BURST);
console.log(`   ${scans.length} scans in ${((Date.now() - s0) / 1000).toFixed(1)}s (max ${BURST} at once). ${timing(scans.map((x) => x.r))}`);
console.log("   transport results:", JSON.stringify(tally(scans.map((x) => x.r))));
scans.filter((x) => !x.r.ok).slice(0, 5).forEach((x) => console.log("   sample failure:", x.r.error, "-", x.r.message));
const colour = (x) => x.r.ok ? x.r.result.color : "error";
const greens = {};
scans.filter((x) => x.kind === "valid" && colour(x) === "green").forEach((x) => { greens[x.t.id] = (greens[x.t.id] || 0) + 1; });
const double = Object.entries(greens).filter(([, n]) => n > 1);
check("NO ticket was let in twice (exactly-once under simultaneous scans)", double.length === 0, double.length ? `double greens: ${double.map(([id]) => id).join(", ")}` : "0 doubles");
const answeredPairs = payable.filter((t) => scans.filter((x) => x.t && x.t.id === t.id && x.r.ok).length === 2);
check("every valid ticket got exactly one green and one 'already checked in'", answeredPairs.every((t) => { const c = scans.filter((x) => x.t && x.t.id === t.id).map(colour).sort().join(); return c === "green,orange"; }), `${answeredPairs.length}/${payable.length} tickets had both scans answered`);
check("unpaid tickets never got in", scans.filter((x) => x.kind === "unpaid").every((x) => colour(x) === "orange" || colour(x) === "error"));
check("flagged tickets were sent to the help desk (orange), not let in", scans.filter((x) => x.kind === "flagged").every((x) => colour(x) === "orange" || colour(x) === "error"));
check("fake codes were refused (red)", scans.filter((x) => x.kind === "fake").every((x) => colour(x) === "red" || colour(x) === "error"));
const final = await call("eventSummary", { token, eventId });
const checkedIn = Object.keys(greens).length;
check("the door counter matches the green scans", final.ok && final.totals.checkedIn === checkedIn, `server says ${final.ok ? final.totals.checkedIn : "?"}, greens ${checkedIn}`);
const transportErrors = scans.filter((x) => !x.r.ok).length;
check("no scan failed to reach the server", transportErrors === 0, transportErrors ? `${transportErrors} failed: a real scanner would have to rescan` : "");

console.log(`
Retries (${RAW ? "off, --raw" : "on, like the real pages"}): ${retriedRequests} requests needed a retry, ${retryCount} retries in total.`);

// 5. a warm, quiet read, for comparison
heading("Step 4: how fast are the screens now?");
for (const [label, action, extra] of [["Payments (first page)", "listOrders", { filter: "awaiting" }], ["Attendees (first page)", "eventSummary", {}], ["Door list", "doorList", {}], ["Events list", "listEvents", {}]]) {
  const runs = []; for (let i = 0; i < 5; i++) runs.push(await call(action, { token, eventId, ...extra }));
  console.log(`   ${label}: ${timing(runs)}`);
}

// 6. tidy up
heading("Summary");
const failed = checks.filter((c) => !c.pass);
console.log(failed.length ? `${failed.length} of ${checks.length} checks FAILED:\n - ${failed.map((c) => c.name).join("\n - ")}` : `All ${checks.length} checks passed.`);
console.log(`\nTest event id: ${eventId}. To hide it, sign in to the portal with the admin password, Events tab, Archive.`);
const adminPw = process.env.CSS_ADMIN_PASSWORD || await ask("Admin password to archive it now (Enter to skip): ", true);
if (adminPw) {
  const a = await call("login", { password: adminPw, name: "Stress cleanup" });
  if (a.ok && a.role === "admin") { const r = await call("setEventStatus", { token: a.token, eventId, status: "archived" }); console.log(r.ok ? "Archived." : "Couldn't archive: " + (r.message || r.error)); }
  else console.log("That wasn't the admin password; leaving it for you to archive.");
}
process.exit(failed.length ? 2 : 0);
