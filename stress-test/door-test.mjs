// Door speed test: how fast does ONE scanner go, and then TWO scanners at once?  Run it yourself (asks for the exec password):
//
//     node stress-test/door-test.mjs            (scanners go back-to-back, the hardest case)
//     node stress-test/door-test.mjs --think 2000   (each scanner waits 2 s between people, like a real queue)
//
// It makes a "DOOR TEST (delete me)" event with free tickets for 60 fake people (@example.com: nothing is emailed),
// opens entry, then:
//   Test 1: one scanner checks in 30 people one after another.
//   Test 2: two scanners work at the same time on 30 different people, then both scan the same 6 tickets at once.
// It reports the time per scan, scans per minute, any "busy" answers, and whether anyone got in twice.

import readline from "node:readline";
import { randomUUID } from "node:crypto";

const API = process.env.CSS_API || "https://script.google.com/macros/s/AKfycbxJ_a_cHyRXadK17ocIebhE2XDFcpEADCzSqOVXwdCgIQe1T-UPi-efzgla2mn7ML2d/exec";
const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > -1 ? Number(process.argv[i + 1]) : fallback; };
const THINK = arg("think", 0);

async function ask(question, hidden) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a.trim()); }));
}
async function call(action, body = {}) {
  const started = Date.now();
  try {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, ...body }), signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { ok: false, error: "NOT_JSON", message: text.slice(0, 80) }; }
    return { ...data, _ms: Date.now() - started };
  } catch (err) { return { ok: false, error: "NETWORK", message: String(err.message || err), _ms: Date.now() - started }; }
}
/** Like the real scanner page: "busy" is tried again (up to 4 times). */
async function scan(token, eventId, code) {
  const started = Date.now();
  let r, tries = 0;
  for (let a = 1; a <= 4; a++) {
    tries = a; r = await call("scan", { token, eventId, code });
    if (r.ok || r.error !== "BUSY" || a === 4) break;
    await sleep(1200 * a);
  }
  return { ...r, _ms: Date.now() - started, _tries: tries };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(tasks, limit) {
  const out = new Array(tasks.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } }));
  return out;
}
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0; };
const colour = (r) => r.ok ? r.result.color : "error";
const report = (label, rs, seconds) => {
  const ms = rs.map((r) => r._ms);
  const busy = rs.filter((r) => !r.ok).length, retried = rs.filter((r) => r._tries > 1).length;
  console.log(`   ${label}: ${rs.length} scans in ${seconds.toFixed(1)}s = ${(rs.length / seconds * 60).toFixed(0)} scans/min. Per scan: median ${pct(ms, 50)} ms, 95th ${pct(ms, 95)} ms, slowest ${Math.max(...ms)} ms. Failed: ${busy}, needed a retry: ${retried}`);
};
const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass }); console.log(`   ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };

// ---- set up ---------------------------------------------------------------------------------
const password = process.env.CSS_EXEC_PASSWORD || await ask("Exec password: ", true);
const tokens = [];
for (const name of ["Door 1", "Door 2"]) {
  const r = await call("login", { password, name });
  if (!r.ok) { console.error("Sign-in failed:", r.message || r.error); process.exit(1); }
  tokens.push(r.token);
}
const token = tokens[0];
const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
const saved = await call("saveEvent", { token, event: {
  name: `DOOR TEST ${new Date().toISOString().slice(5, 16)} (delete me)`, date: tomorrow, startTime: "18:00", endTime: "21:00", location: "Nowhere (test)",
  capacity: "", capacityRule: "paid", codePrefix: "DT", description: "Automated door speed test.",
  ticketTypes: [{ name: "Guest", price: 0, needsMembership: false }], questions: [] } });
if (!saved.ok) { console.error("Couldn't create the event:", saved.message || saved.error); process.exit(1); }
const eventId = saved.event.id;
await call("setEventStatus", { token, eventId, status: "published" });
const pub = await call("publicEvent", { slug: saved.event.slug });
const typeId = pub.event.ticketTypes[0].id;
console.log(`Making 60 free tickets for ${saved.event.name} (nothing is emailed)...`);
const regs = await pool(Array.from({ length: 60 }, (_, i) => () => call("register", { slug: saved.event.slug, requestId: randomUUID(), website: "",
  people: [{ name: `Door Person ${String(i + 1).padStart(2, "0")}`, email: `door${String(i + 1).padStart(2, "0")}@example.com`, ticketTypeId: typeId, answers: {} }] })), 6);
console.log(`   ${regs.filter((r) => r.ok).length}/60 registered.`);
await sleep(3000);
await call("setEntryOpen", { token, eventId, open: true });
const list = await call("listOrders", { token, eventId, filter: "all", limit: 200 });
const tickets = list.orders.flatMap((o) => o.tickets).filter((t) => t.status === "paid");
if (tickets.length < 60) { console.error(`Only ${tickets.length} tickets are ready; stopping.`); process.exit(1); }
await call("doorList", { token, eventId });   // warm-up, like opening the Door tab

// ---- test 1: one scanner -----------------------------------------------------------------------
console.log(`\n=== Test 1: ONE scanner, 30 people${THINK ? `, ${THINK / 1000}s between people` : ", back-to-back"} ===`);
const first = tickets.slice(0, 30);
let t0 = Date.now();
const one = [];
for (const t of first) { one.push(await scan(tokens[0], eventId, t.secret)); if (THINK) await sleep(THINK); }
const oneSeconds = (Date.now() - t0 - (THINK ? THINK * first.length : 0)) / 1000;
report("one scanner", one, Math.max(oneSeconds, 0.1));
check("every person got a green", one.every((r) => colour(r) === "green"), `${one.filter((r) => colour(r) === "green").length}/30`);

// ---- test 2: two scanners --------------------------------------------------------------------------
console.log(`\n=== Test 2: TWO scanners at the same time, 30 different people${THINK ? `, ${THINK / 1000}s between people` : ", back-to-back"} ===`);
const second = tickets.slice(30, 60);
const worker = async (token, mine) => { const out = []; for (const t of mine) { out.push(await scan(token, eventId, t.secret)); if (THINK) await sleep(THINK); } return out; };
t0 = Date.now();
const [a, b] = await Promise.all([worker(tokens[0], second.filter((_, i) => i % 2 === 0)), worker(tokens[1], second.filter((_, i) => i % 2 === 1))]);
const twoSeconds = (Date.now() - t0 - (THINK ? THINK * 15 : 0)) / 1000;
const both = a.concat(b);
report("two scanners together", both, Math.max(twoSeconds, 0.1));
check("every person got a green", both.every((r) => colour(r) === "green"), `${both.filter((r) => colour(r) === "green").length}/30`);

console.log("\n=== Test 3: both scanners scan the SAME 6 tickets at the same instant ===");
const same = tickets.slice(30, 36);   // already checked in by test 2 → must all say 'already checked in'
const dup = await Promise.all(same.flatMap((t) => [scan(tokens[0], eventId, t.secret), scan(tokens[1], eventId, t.secret)]));
check("nobody was let in a second time", dup.every((r) => colour(r) === "orange"), dup.map(colour).join(","));
const final = await call("eventSummary", { token, eventId });
check("the door counter says 60 inside", final.ok && final.totals.checkedIn === 60, final.ok ? `${final.totals.checkedIn} inside` : "couldn't read");

console.log(`\n${checks.filter((c) => !c.pass).length ? "Some checks FAILED." : "All checks passed."}`);
console.log(`Event id ${eventId}: archive it in the portal (Events tab, admin password) when you're done.`);
process.exit(checks.every((c) => c.pass) ? 0 : 2);
