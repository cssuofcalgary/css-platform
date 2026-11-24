// Comments on a payment: adding, listing (newest first), refusing bad ones, removing (writer or admin, kept in the sheet),
// what the payment card gets from listOrders (count + newest comment, from one read), sign-in, and the Activity sentences.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const attempt = (code) => { try { return { value: run(code) }; } catch (e) { return { error: e.code || "ERROR", message: e.message }; } };

run(`
function table_() { return {}; }
var __locks = 0, __inLock = 0;
function withLock_(f) { __locks++; __inLock++; try { return f(); } finally { __inLock--; } }
var __logs = [];
function log_(who, action, target, details) { __logs.push({ who: who, action: action, target: target, details: details, locked: __inLock > 0 }); }
var __noteReads = 0;
var __readRowsReal = readRows_;
readRows_ = function (name) { if (name === "PaymentNotes") __noteReads++; return __readRowsReal(name); };
TBL.Events = [{ id:"EV1", slug:"mj", name:"Mahjong", description:"", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"",
  capacityRule:"paid", waitlist:"FALSE", status:"published", entryOpen:"FALSE", ticketTypes:[{id:"T2",name:"General",price:9}],
  questions:[], codePrefix:"MJ", registrationCloses:"", archivedAt:"", archiveYear:"", summary:{}, createdAt:"", updatedAt:"" }];
TBL.Orders = [
  { id:"O1", code:"MJ-1111", eventId:"EV1", payerName:"Amy Friend", payerEmail:"amy@example.com", total:9, status:"awaiting", createdAt:"2026-11-20T10:00:00Z", notes:"" },
  { id:"O2", code:"MJ-2222", eventId:"EV1", payerName:"Bo Payer", payerEmail:"bo@example.com", total:9, status:"awaiting", createdAt:"2026-11-20T11:00:00Z", notes:"" }];
TBL.Tickets = [
  { id:"K1", orderId:"O1", eventId:"EV1", name:"Amy Friend", ticketType:"General", price:9, status:"awaiting" },
  { id:"K2", orderId:"O2", eventId:"EV1", name:"Bo Payer", ticketType:"General", price:9, status:"awaiting" }];
TBL.Refunds = []; TBL.Waitlist = []; TBL.PaymentNotes = [];
var __ann = startSession_("TEST Exec Ann", "exec");
var __bo = startSession_("TEST Exec Bo", "exec");
var __admin = startSession_("TEST Admin", "admin");
var __door = startSession_("TEST Door", "door");
`);

// ---- Adding
let reply = run('route_({action:"addPaymentNote", token:__ann, orderId:"O1", text:"  Outstanding: it\'s Amy\'s friend, she\'ll pay at the door.  ", by:"Someone else"})');
ok(reply.ok && reply.note.text === "Outstanding: it's Amy's friend, she'll pay at the door." && reply.note.by === "TEST Exec Ann" && !isNaN(Date.parse(reply.note.createdAt)),
  "a comment saves its text, time and the signed-in exec's name (a supplied author is ignored)");
ok(reply.noteCount === 1 && reply.latestNote && reply.latestNote.by === "TEST Exec Ann", "the reply carries the card's new count and newest comment");
ok(run('TBL.PaymentNotes[0].orderId === "O1" && TBL.PaymentNotes[0].eventId === "EV1" && TBL.PaymentNotes[0].removedAt === ""'), "the row is linked by order ID and event ID");
ok(run('__locks') === 1, "adding happens under the lock");
ok(run('__logs.length === 1 && __logs[0].action === "payment.note" && __logs[0].target === "MJ-1111" && __logs[0].who === "TEST Exec Ann"'), "adding is logged against the payment code");

// ---- Newest first
run('TBL.PaymentNotes[0].createdAt = "2026-11-21T09:00:00.000Z";');
run('route_({action:"addPaymentNote", token:__bo, orderId:"O1", text:"Texted her, she says Friday"})');
let listed = run('route_({action:"listPaymentNotes", token:__admin, orderId:"O1"})');
ok(listed.ok && listed.notes.length === 2 && listed.notes[0].text === "Texted her, she says Friday" && listed.notes[0].by === "TEST Exec Bo" && listed.notes[1].by === "TEST Exec Ann",
  "the list shows every comment, newest first, with who wrote it");
ok(run('route_({action:"listPaymentNotes", token:__ann, orderId:"O2"}).notes.length') === 0, "comments stay with their own payment");

// ---- Refused
for (const text of ["", "   ", "x".repeat(1001)]) {
  ok(attempt(`route_({action:"addPaymentNote", token:__ann, orderId:"O1", text:${JSON.stringify(text)}})`).error === "BAD_REQUEST", "an empty or too-long comment is refused (" + text.length + " characters)");
}
ok(run(`route_({action:"addPaymentNote", token:__ann, orderId:"O2", text:${JSON.stringify("y".repeat(1000))}}).ok`), "a comment of exactly 1000 characters is accepted");
ok(attempt('route_({action:"addPaymentNote", token:__ann, orderId:"NOPE", text:"Hello"})').error === "NOT_FOUND", "a payment that doesn't exist can't get a comment");
ok(attempt('route_({action:"addPaymentNote", token:__ann, text:"Hello"})').error === "NOT_FOUND", "a comment with no payment is refused");

// ---- Formula-looking text and line breaks
run('TBL.PaymentNotes = [];');
run('route_({action:"addPaymentNote", token:__ann, orderId:"O1", text:"=HYPERLINK(\\"http://x\\")"})');
ok(run('TBL.PaymentNotes[0].text').indexOf("'=") === 0, "a comment that looks like a formula is stored so the sheet can't run it");
ok(run('route_({action:"listPaymentNotes", token:__bo, orderId:"O1"}).notes[0].text') === '=HYPERLINK("http://x")', "…and reads back exactly as typed");
run('TBL.PaymentNotes[0].createdAt = "2026-11-21T09:00:00.000Z";');
run('route_({action:"addPaymentNote", token:__ann, orderId:"O1", text:"- paid $5 cash\\n- $4 still to come"})');
ok(run('route_({action:"listPaymentNotes", token:__bo, orderId:"O1"}).notes[0].text') === "- paid $5 cash\n- $4 still to come", "a comment keeps its leading dash and line break");

// ---- What the payment card gets
run('__noteReads = 0;');
let orders = run('listOrders_("EV1", { filter:"all" }).orders');
const o1 = orders.find((o) => o.id === "O1"), o2 = orders.find((o) => o.id === "O2");
ok(o1.noteCount === 2 && o1.latestNote.text === "- paid $5 cash - $4 still to come" && o1.latestNote.by === "TEST Exec Ann" && !!o1.latestNote.createdAt,
  "listOrders gives each payment its comment count and newest comment (on one line): " + JSON.stringify(o1.latestNote));
ok(o2.noteCount === 0 && o2.latestNote === null, "a payment with no comments says 0 and no newest comment");
ok(run('__noteReads') === 1, "the comments tab is read once for the whole list, not once per payment");
run('route_({action:"addPaymentNote", token:__ann, orderId:"O2", text:"' + "z".repeat(300) + '"})');
const long = run('listOrders_("EV1", { filter:"all" }).orders').find((o) => o.id === "O2").latestNote.text;
ok(long.length <= 120 && long.endsWith("…"), "a long newest comment is cut short for the card (" + long.length + " characters)");
run('var __realSummaries = paymentNoteSummaries_; paymentNoteSummaries_ = function () { throw new Error("TEST sheet hiccup"); };');
const still = attempt('listOrders_("EV1", { filter:"all" })');
ok(still.value && still.value.ok && still.value.orders.every((o) => o.noteCount === 0), "a problem reading comments never stops the payments list opening");
run('paymentNoteSummaries_ = __realSummaries;');

// ---- Removing
run('TBL.PaymentNotes = []; __logs = []; __locks = 0;');
const annNote = run('route_({action:"addPaymentNote", token:__ann, orderId:"O1", text:"Ann wrote this"}).note.id');
run('TBL.PaymentNotes[0].createdAt = "2026-11-21T09:00:00.000Z";');
const boNote = run('route_({action:"addPaymentNote", token:__bo, orderId:"O1", text:"Bo wrote this"}).note.id');
let refused = attempt(`route_({action:"removePaymentNote", token:__bo, id:${JSON.stringify(annNote)}})`);
ok(refused.error === "ADMIN_ONLY" && /TEST Exec Ann/.test(refused.message), "another exec can't remove someone else's comment (and is told who can)");
reply = run(`route_({action:"removePaymentNote", token:__ann, id:${JSON.stringify(annNote)}})`);
ok(reply.ok && reply.orderId === "O1" && reply.noteCount === 1 && reply.latestNote.text === "Bo wrote this", "the writer can remove their own comment; the reply has the card's new count and newest comment");
listed = run('route_({action:"listPaymentNotes", token:__bo, orderId:"O1"}).notes');
ok(listed.length === 1 && listed[0].id === boNote, "a removed comment disappears for everyone");
ok(run('listOrders_("EV1", { filter:"all" }).orders').find((o) => o.id === "O1").noteCount === 1, "…and isn't counted on the payment card");
ok(run(`TBL.PaymentNotes.length === 2 && TBL.PaymentNotes.filter(function (n) { return n.id === ${JSON.stringify(annNote)}; })[0].removedBy === "TEST Exec Ann" && !!TBL.PaymentNotes.filter(function (n) { return n.id === ${JSON.stringify(annNote)}; })[0].removedAt`),
  "…but it's kept in the sheet, marked removed (not deleted)");
reply = run(`route_({action:"removePaymentNote", token:__admin, id:${JSON.stringify(boNote)}})`);
ok(reply.ok && reply.noteCount === 0 && reply.latestNote === null, "an admin can remove anyone's comment");
ok(attempt(`route_({action:"removePaymentNote", token:__admin, id:${JSON.stringify(boNote)}})`).error === "NOT_FOUND", "removing it again says it's no longer there");
ok(attempt('route_({action:"removePaymentNote", token:__admin, id:"PNNOTHERE"})').error === "NOT_FOUND", "an unknown comment can't be removed");
ok(run('__locks') === 7 && run('__logs.filter(function (l) { return l.action === "payment.noteRemoved" && l.target === "MJ-1111" && l.locked; }).length') === 2,
  "removing happens under the lock and is logged against the payment code");

// ---- Pressing Post again after a dropped connection
run('TBL.PaymentNotes = [];');
const first = run('route_({action:"addPaymentNote", token:__ann, orderId:"O2", text:"Once only", clientId:"PNabc123def456"})');
const again = run('route_({action:"addPaymentNote", token:__ann, orderId:"O2", text:"Once only", clientId:"PNabc123def456"})');
ok(first.note.id === "PNabc123def456" && again.repeated && run('TBL.PaymentNotes.length') === 1 && again.noteCount === 1, "the same comment sent twice is only added once");
ok(run('route_({action:"addPaymentNote", token:__ann, orderId:"O2", text:"Odd", clientId:"../../x"}).note.id') !== "../../x", "a made-up comment name of the wrong shape is ignored");

// ---- Sign-in
for (const action of ["listPaymentNotes", "addPaymentNote", "removePaymentNote"]) {
  ok(attempt(`route_({action:"${action}", orderId:"O1", text:"Hello", id:"x"})`).error === "NOT_LOGGED_IN", action + " needs sign-in");
  ok(attempt(`route_({action:"${action}", token:"made-up", orderId:"O1", text:"Hello", id:"x"})`).error === "NOT_LOGGED_IN", action + " refuses a made-up sign-in");
  ok(attempt(`route_({action:"${action}", token:__door, orderId:"O1", text:"Hello", id:"x"})`).error === "DOOR_ONLY", action + " isn't available to door-only volunteers");
}

// ---- Activity reads as sentences
run(`TBL.Log = [
  { time:"2026-11-21T10:00:00Z", who:"TEST Exec Ann", action:"payment.note", target:"MJ-1111", details:"{}" },
  { time:"2026-11-21T10:01:00Z", who:"TEST Exec Ann", action:"payment.noteRemoved", target:"MJ-1111", details:"{}" }];
readLastRows_ = function (name, n) { return (TBL[name] || []).slice(-n); };`);
const act = run('activityLog_({ group: "payments" }).entries');
ok(/commented on payment MJ-1111/.test((act.find((e) => e.action === "payment.note") || {}).summary) &&
  /removed a comment from payment MJ-1111/.test((act.find((e) => e.action === "payment.noteRemoved") || {}).summary), "comments read as sentences under Payments in Activity");
ok(act.every((e) => e.eventId === "EV1"), "…and are linked to the payment's event");

// ---- What the exec sees: the card's bubble and newest comment, and the comments window (Exec Portal, fake page)
function portal() {
  const fs = require("fs"), path = require("path"), vm = require("vm");
  const elements = {}, listeners = {};
  const element = (id) => elements[id] || (elements[id] = {
    id, hidden: false, disabled: false, value: "", textContent: "", placeholder: "", open: false, html: "",
    addEventListener(type, fn) { listeners[id + ":" + type] = fn; }, focus() {}, requestSubmit() { listeners[id + ":submit"]({ preventDefault() {} }); },
    showModal() { this.open = true; }, close() { this.open = false; if (listeners[id + ":close"]) listeners[id + ":close"](); },
    set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }
  });
  const context = vm.createContext({
    console, URL, Set,
    $: element, requests: [], replies: [], toasts: [], confirmAnswers: [],
    escapeHtml: (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    money: (n) => "$" + Number(n).toFixed(2), dollars: (n) => "$" + Number(n).toFixed(2), ticketUrl: () => "https://example.com/ticket",
    eventsState: { loaded: true, events: [] }, state: { name: "TEST Exec Ann", role: "exec" },
    location: { href: "https://example.com/" }, PUBLIC_SITE_URL: "https://example.com/",
    setInterval() {}, setTimeout() {}, clearTimeout() {},
    document: { querySelectorAll() { return []; }, querySelector() { return null; } },
    showToast(message) { context.toasts.push(message); }, errorText: (reply) => reply.message || reply.error,
    signOutLocally() {}, showLogin() {}, handleEventError() {}, stoppedTicketMark: () => "", moneyLines: () => "", canDisableTicket: () => false,
    newRequestId: () => "1234abcd-5678-ef90-1234-567890abcdef",
    api: async (action, details) => { context.requests.push({ action, details }); return context.replies.shift(); }
  });
  context.askConfirm = async () => context.confirmAnswers.shift() || false;
  const page = (code) => vm.runInContext(code, context);
  for (const file of ["strings.js", "payments.js"]) page(fs.readFileSync(path.join(__dirname, "../exec-portal", file), "utf8"));
  return { page, context, elements, listeners };
}

(async () => {
  const p = portal();
  const order = { id: "O1", code: "MJ-1111", payerName: "Amy Friend", payerEmail: "amy@example.com", status: "awaiting", total: 9, received: 0, stillDue: 9,
    tickets: [], noteCount: 2, latestNote: { text: "Outstanding: Amy's friend, pays at the door", by: "TEST Exec Bo", createdAt: "2026-11-21T10:00:00Z" } };
  p.page(`payState.eventId = "EV1"; payState.data = { orders: [${JSON.stringify(order)}], event: { id: "EV1" } };`);
  let card = p.page("orderCard(payState.data.orders[0])");
  ok(/class="pnote-row has" data-act="notes"/.test(card) && /#i-chat/.test(card) && /<span>2<\/span>/.test(card), "a payment with comments shows the speech bubble with the count");
  ok(card.includes("TEST Exec Bo, ") && card.includes("Outstanding: Amy&#39;s friend, pays at the door"), "…and the newest comment with who and when, on the card");
  const bare = p.page("orderCard(Object.assign({}, payState.data.orders[0], { noteCount: 0, latestNote: null }))");
  ok(/class="pnote-row" data-act="notes"/.test(bare) && bare.includes(">Comment<"), "a payment with no comments still has a way to add one");

  // Open the window: the list loads, newest first, with × only on my own comments
  p.context.replies.push({ ok: true, notes: [
    { id: "PN2", orderId: "O1", text: "Bo's newer comment", by: "TEST Exec Bo", createdAt: "2026-11-21T10:00:00Z" },
    { id: "PN1", orderId: "O1", text: "Ann's <b>older</b> comment\nline two", by: "TEST Exec Ann", createdAt: "2026-11-20T10:00:00Z" }], noteCount: 2, latestNote: order.latestNote });
  await p.page("openPayNotes(payState.data.orders[0])");
  const list = p.elements["pn-list"].html;
  ok(p.elements["pay-notes-dialog"].open && p.elements["pn-title"].textContent === "Comments on MJ-1111", "the comments window opens for that payment");
  ok(p.context.requests[0].action === "listPaymentNotes" && p.context.requests[0].details.orderId === "O1", "…and loads its comments");
  ok(list.indexOf("Bo&#39;s newer") < list.indexOf("Ann&#39;s"), "comments are listed newest first");
  ok(!list.includes('data-pnote-remove="PN2"') && list.includes('data-pnote-remove="PN1"'), "only my own comments have a remove ×");
  ok(list.includes("&lt;b&gt;older&lt;/b&gt;"), "comment text is shown as typed, never as page code");

  // Enter posts; Shift+Enter doesn't
  p.elements["pn-text"].value = "She'll pay at the door";
  let prevented = false;
  p.context.replies.push({ ok: true, note: { id: "PNx", orderId: "O1", text: "She'll pay at the door", by: "TEST Exec Ann", createdAt: "2026-11-22T10:00:00Z" },
    noteCount: 3, latestNote: { text: "She'll pay at the door", by: "TEST Exec Ann", createdAt: "2026-11-22T10:00:00Z" } });
  p.listeners["pn-text:keydown"]({ key: "Enter", shiftKey: true, preventDefault() { prevented = true; } });
  ok(!prevented && p.context.requests.length === 1, "Shift+Enter starts a new line instead of posting");
  p.listeners["pn-text:keydown"]({ key: "Enter", shiftKey: false, preventDefault() { prevented = true; } });
  await new Promise(setImmediate);
  const post = p.context.requests[1];
  ok(prevented && post && post.action === "addPaymentNote" && post.details.orderId === "O1" && post.details.text === "She'll pay at the door" && /^PN[A-Za-z0-9]{8,}$/.test(post.details.clientId), "Enter posts the comment (with its own name, so a retry isn't added twice)");
  ok(p.elements["pn-text"].value === "" && p.elements["pn-list"].html.indexOf("She&#39;ll pay") < p.elements["pn-list"].html.indexOf("Bo&#39;s newer"), "the new comment appears at the top and the box clears");
  ok(p.page("payState.data.orders[0].noteCount") === 3 && p.page("payState.data.orders[0].latestNote.by") === "TEST Exec Ann", "the card's count and newest comment update without reloading the list");

  // A failed post keeps the text and says why
  p.elements["pn-text"].value = "Try again";
  p.context.replies.push({ ok: false, error: "BUSY", message: "The system is busy. Try again in a moment." });
  await p.page("postPayNote({ preventDefault() {} })");
  ok(p.elements["pn-text"].value === "Try again" && !p.elements["pn-error"].hidden && /busy/.test(p.elements["pn-error"].textContent), "a failed post keeps the text and says what went wrong");
  const firstId = p.context.requests.at(-1).details.clientId;
  p.context.replies.push({ ok: true, note: { id: firstId, orderId: "O1", text: "Try again", by: "TEST Exec Ann", createdAt: "2026-11-22T11:00:00Z" }, noteCount: 4, latestNote: null });
  await p.page("postPayNote({ preventDefault() {} })");
  ok(p.context.requests.at(-1).details.clientId === firstId, "pressing Post again sends the same comment name");

  // Remove my own comment
  p.context.confirmAnswers.push(true);
  p.context.replies.push({ ok: true, orderId: "O1", noteCount: 3, latestNote: { text: "Bo's newer comment", by: "TEST Exec Bo", createdAt: "2026-11-21T10:00:00Z" } });
  await p.listeners["pn-list:click"]({ target: { closest: () => ({ dataset: { pnoteRemove: "PN1" }, disabled: false }) } });
  ok(p.context.requests.at(-1).action === "removePaymentNote" && p.context.requests.at(-1).details.id === "PN1", "× removes that comment after a confirmation");
  ok(!p.elements["pn-list"].html.includes('data-pnote-remove="PN1"') && p.page("payState.data.orders[0].noteCount") === 3 && p.context.toasts.includes("Comment removed."), "…it leaves the window and the card updates");
  p.elements["pn-close"] && p.listeners["pn-close:click"]();
  ok(!p.elements["pay-notes-dialog"].open, "Close shuts the window");

  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((err) => { console.log("FAIL the page test crashed: " + (err && err.stack || err)); process.exit(1); });
