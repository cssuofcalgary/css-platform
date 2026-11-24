// Browser audit regressions: no real server, camera, email or attendee data.
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
let failures = 0;
const ok = (condition, message) => { console.log((condition ? "PASS " : "FAIL ") + message); if (!condition) failures++; };
const store = () => { const data = new Map(); return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) }; };
function page(extra = {}) {
  const elements = {};
  const el = (id) => elements[id] ||= { value: "", textContent: "", innerHTML: "", hidden: false, attributes: {}, dataset: {},
    setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }, focus() {}, addEventListener() {} };
  const context = vm.createContext({ console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, clearInterval,
    location: { search: "", hash: "", hostname: "events.ucalgarycss.ca" }, localStorage: store(), sessionStorage: store(),
    document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, readyState: "complete" },
    window: { matchMedia: () => ({ matches: false }) }, ...extra });
  return { context, el, run: (code) => vm.runInContext(code, context) };
}
async function main() {
  for (const file of ["public/public.js", "public/ticket.js", "public/tickets.js"]) {
    const timers = [], cleared = [], requests = [];
    const p = page({ API_URL: "https://test.invalid", setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout(id) { cleared.push(id); },
      fetch: async (url, request) => { requests.push(request); return { json: async () => ({ ok: true }) }; } });
    // Load the actual API helper without starting the page.
    const source = read(file), end = source.indexOf("\nfunction applySite");
    p.run(source.slice(0, end));
    const reply = await p.run("api('readTest')");
    ok(reply.ok && requests.length === 1 && requests[0].signal instanceof AbortSignal, file + ": works when AbortSignal.timeout is unavailable");
    ok(cleared.length === 1, file + ": successful requests clear their timeout");
    p.context.fetch = (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("TEST timeout"))));
    const pending = p.run("api('slowTest')");
    timers[1]();
    ok((await pending).error === "NETWORK" && cleared.length === 2, file + ": a timed-out request ends with the existing connection error");
  }

  const handlers = {}, editor = { postMessage() {} };
  const preview = page({ CONTACT_EMAIL: "club@example.com", INSTAGRAM_URL: "", setTimeout: () => 1, clearTimeout() {},
    location: { hash: "#preview=TEST-preview", hostname: "events.ucalgarycss.ca" },
    window: { opener: editor, addEventListener(name, fn) { handlers[name] = fn; }, removeEventListener() {} } });
  preview.run(read("public/strings.js"));
  preview.run(read("public/public.js").replace(/\bstart\(\);\s*$/, ""));
  preview.run("var rendered=null; renderEvent=(event)=>{rendered=event;}; start();");
  const message = { source: editor, origin: "https://attacker.example", data: { previewKey: "TEST-preview", event: { name: "TEST Preview" } } };
  handlers.message(message);
  ok(preview.run("rendered===null"), "an untrusted opener cannot display a spoofed event preview");
  handlers.message({ ...message, origin: "https://exec.ucalgarycss.ca", data: { ...message.data, previewKey: "wrong" } });
  ok(preview.run("rendered===null"), "the trusted preview still requires the matching one-use key");
  handlers.message({ ...message, origin: "https://exec.ucalgarycss.ca" });
  ok(preview.run("rendered.name==='TEST Preview'"), "the club's event editor can still preview its draft");
  ok(!preview.run("trustedPreviewOrigin('http://localhost:8766')"), "the live site does not accept a random local editor");
  preview.run("location.hostname='localhost'");
  ok(preview.run("trustedPreviewOrigin('http://127.0.0.1:8766')"), "local development can preview from another local port");

  const portal = page();
  portal.run(read("exec-portal/strings.js"));
  portal.run(read("exec-portal/app.js"));
  portal.run("var refreshed=0; apiRequest=async()=>({ok:true}); pandaBusy=()=>{}; function refreshMailStatus(){refreshed++;}");
  const mailActions = ["markOrderPaid", "markOrdersPaid", "sendPendingEmails", "resendTickets", "addOrder", "sendReminders", "updateTicket", "offerWaitlistSpot", "emailAttendees", "applyTransfer", "markMemberPaid", "resendMemberPass", "addMember", "updateMember"];
  for (const action of mailActions) await portal.run(`api(${JSON.stringify(action)})`);
  ok(portal.run("refreshed") === mailActions.length, "every actual email-producing action refreshes the quota indicator");
  portal.run("apiRequest=async()=>({ok:false,error:'TEST'});");
  await portal.run("api('updateTicket')");
  ok(portal.run("refreshed") === mailActions.length, "a rejected action does not claim to have used email quota");
  portal.run("var stopped=0; function stopCamera(){stopped++;} state.token='TEST'; signOutLocally();");
  ok(portal.run("stopped===1 && state.token===''"), "local sign-out stops the camera for both logout and expired sessions");

  const scanner = page({ location: { search: "?mode=scanner" } });
  scanner.run(read("exec-portal/app.js"));
  scanner.run("showSearch=()=>{}; switchTab=()=>{}; state.name='TEST'; state.role='door'; showApp();");
  ok(scanner.el("full-portal-link").hidden, "door-only sessions cannot use Full portal");
  scanner.run("state.role='exec'; showApp();");
  ok(!scanner.el("full-portal-link").hidden, "an exec signing in after a volunteer regains the Full portal link");

  const camera = page();
  camera.run(read("exec-portal/strings.js"));
  camera.run(read("exec-portal/app.js"));
  camera.run("var doorState={scanner:null,cameraGeneration:0}, finishedStart, cameraStops=0; state.token='TEST'; function showIdle(){} function showResult(){} function onCode(){}; class Html5Qrcode { start(){return new Promise(resolve=>{finishedStart=resolve;});} async stop(){cameraStops++;} }");
  const doorCode = read("exec-portal/door.js");
  camera.run(doorCode.slice(doorCode.indexOf("async function toggleCamera()"), doorCode.indexOf("const PAUSE_AFTER_RESULT_MS")));
  const starting = camera.run("toggleCamera()");
  camera.run("signOutLocally(); finishedStart();");
  await starting;
  ok(camera.run("cameraStops===2 && doorState.scanner===null") && camera.el("camera").hidden, "a camera that finishes starting after sign-out is stopped again");

  const nav = page();
  nav.context.$ = nav.el;
  nav.run(read("exec-portal/overview.js").split('document.addEventListener("click"')[0]);
  nav.run("var globalEventId='', payState={}, doorState={}, switched=''; function switchTab(tab){switched=tab;}");
  nav.el("global-event").options = [];
  nav.run("goToTab('door','TEST-CLICKED')");
  ok(nav.run("doorState.eventId==='TEST-CLICKED' && doorState.picked && switched==='door'"), "Open in Door preserves the event that was clicked");

  const practice = page();
  practice.context.$ = practice.el;
  practice.context.escapeHtml = portal.run("escapeHtml");
  practice.run(read("exec-portal/strings.js"));
  practice.run("var eventsState={loaded:true}, reloads=0, sheets=0, signedOut=0, loginMessage='', apiReply={ok:false,error:'NETWORK'}; function api(action){ return Promise.resolve(action==='practiceSheet'?{ok:true,exists:false}:apiReply); } function loadEvents(){reloads++;} function askConfirm(){return Promise.resolve(true);} function errorText(r){return r.error;} function showToast(){} function signOutLocally(){signedOut++;} function showLogin(message){loginMessage=message;}");
  practice.run(read("exec-portal/practice.js"));
  practice.run("var actualShowSheet=showPracticeSheet; showPracticeSheet=()=>{sheets++;};");
  await practice.run("openPractice()");
  ok(practice.run("reloads===0 && sheets===0 && !practiceState.busy"), "a rejected Practice creation does not refresh Events or open a fake sheet");
  practice.run("apiReply={ok:true,exists:true,cards:[]};");
  await practice.run("openPractice()");
  ok(practice.run("reloads===1 && sheets===1 && !eventsState.loaded"), "successful Practice creation refreshes Events and opens its sheet");
  practice.el("practice-dialog").close = () => { practice.el("practice-dialog").hidden = true; };
  practice.run("apiReply={ok:false,error:'NOT_LOGGED_IN'};");
  await practice.run("removePracticeEvent()");
  ok(practice.run("signedOut===1 && loginMessage==='NOT_LOGGED_IN'") && practice.el("practice-dialog").hidden, "an expired session while removing Practice closes the sheet and returns to sign-in");
  practice.run("var fakeDialog={open:false,scrollTop:80,showModal(){this.open=true;}}; practiceDialog=()=>fakeDialog; actualShowSheet({archived:true,cards:[{name:'TEST',expect:'RED',qr:'data:image/png;base64,TEST'}]});");
  ok(practice.el("practice-print").disabled && !practice.el("practice-error").hidden && !practice.el("practice-remove").disabled,
    "an archived practice sheet offers removal and does not print unusable tickets");
  ok(practice.run("fakeDialog.open && fakeDialog.scrollTop===0"), "the Practice dialog opens at its heading instead of jumping to its bottom buttons");

  const entryUi = page();
  entryUi.context.$ = entryUi.el;
  entryUi.run(read("exec-portal/strings.js"));
  entryUi.run(`var SCANNER_MODE=false, doorCalls=[], toasted='', renderedEvents=0, renderedDoor=0,
    doorState={eventId:'EV2',data:{event:{id:'EV2',entryOpen:false}}},
    eventsState={events:[{id:'EV1',name:'First Event',entryOpen:true},{id:'EV2',name:'Second Event',entryOpen:false}]};
    async function api(action,details){doorCalls.push({action,details});return {ok:true,entryOpen:true,closedEvents:[{id:'EV1',name:'First Event'}]};}
    function showToast(text){toasted=text;} function renderEvents(){renderedEvents++;} function renderDoor(){renderedDoor++;} function showResult(){} function errorText(r){return r.error;}`);
  entryUi.run(doorCode.slice(doorCode.indexOf("async function toggleEntry()"), doorCode.indexOf("// ---- View all check-ins")));
  await entryUi.run("toggleEntry()");
  ok(entryUi.run("doorCalls.length===1 && doorCalls[0].action==='setEntryOpen' && !eventsState.events[0].entryOpen && eventsState.events[1].entryOpen && toasted.includes('First Event')"),
    "opening entry uses one atomic setEntryOpen call and updates closed events from the reply");

  // ---- Card payments (Square Hosted Checkout): optional, behind cardEnabled, e-transfer always kept ----
  const cardSettings = page();
  cardSettings.context.$ = cardSettings.el;
  cardSettings.run(read("exec-portal/strings.js"));
  cardSettings.run(read("exec-portal/settings.js"));
  cardSettings.run("showCardSettings({squareEnvironment:'production',squarePassFee:true})");
  ok(cardSettings.el("set-card-fee-toggle").hidden && cardSettings.el("set-card-fee-fields").hidden && !cardSettings.el("set-card-pass-fee").checked,
    "real-payment settings cannot expose or retain the sandbox fee toggle");
  cardSettings.run("showCardSettings({squareEnvironment:'sandbox',squarePassFee:true});");
  ok(!cardSettings.el("set-card-fee-toggle").hidden && !cardSettings.el("set-card-fee-fields").hidden,
    "the explicitly enabled fee prototype remains available in test mode");
  cardSettings.el("set-card-env").value = "production";
  cardSettings.run("updateCardFeeFields()");
  ok(cardSettings.el("set-card-fee-toggle").hidden && !cardSettings.el("set-card-pass-fee").checked,
    "switching from test to real payments clears the buyer-fee selection");
  const strings = read("public/strings.js"), publicSrc = read("public/public.js"), ticketSrc = read("public/ticket.js");
  const T = page().run(strings + "; T");
  ok(T.payByCard === "Pay by card" && T.payByEtransfer === "Pay by Interac e-transfer" && !!T.cardOpening && !!T.cardFailed && !!T.payNoteCard,
    "card payment strings live in public/strings.js");
  ok(T.cardNotCompleted === "Payment not completed yet — you can try card again or pay by e-transfer.", "the came-back-unpaid message is in public/strings.js");
  ok(!/Pay by card|Payment not completed/.test(publicSrc + ticketSrc), "public.js and ticket.js use T.xxx for the card wording, not inline text");

  const payPage = () => {
    const p = page({ API_URL: "https://test.invalid", setTimeout: () => 1, clearTimeout() {},
      location: { href: "https://events.ucalgarycss.ca/?e=test", search: "?e=test", hash: "", hostname: "events.ucalgarycss.ca" },
      window: { scrollTo() {}, addEventListener() {}, matchMedia: () => ({ matches: false }) } });
    p.run(strings);
    p.run(publicSrc.replace(/\bstart\(\);\s*$/, ""));
    p.run("var apiCalls=[]; var apiReply={ok:false,error:'NETWORK'}; api=async(action,details)=>{apiCalls.push({action,details});return apiReply;}; pandaImg=()=>'';");
    return p;
  };
  const unpaid = (extra) => JSON.stringify(Object.assign({ order: { status: "awaiting", total: 15, code: "TEST-1" }, etransferEmail: "pay@example.com",
    tickets: [{ name: "TEST Person", ticketType: "General", price: 15, page: "ticket.html?t=TESTSECRET" }] }, extra));
  const off = payPage();
  off.run(`showPaymentScreen(${unpaid({})})`);
  const offHtml = off.el("page").innerHTML;
  ok(!offHtml.includes("pay-card") && offHtml.includes(T.sendEtransfer) && offHtml.includes("pay-box") && offHtml.includes("TEST-1") && offHtml.includes(T.statusWaiting),
    "card switched off: the payment screen is the plain e-transfer screen, unchanged");
  const on = payPage();
  on.run(`showPaymentScreen(${unpaid({ cardEnabled: true })})`);
  const onHtml = on.el("page").innerHTML;
  ok(onHtml.includes('id="pay-card"') && onHtml.includes(T.payByCard) && onHtml.indexOf("pay-card") < onHtml.indexOf(T.payByEtransfer) && onHtml.indexOf(T.payByEtransfer) < onHtml.indexOf("pay-box"),
    "card switched on: Pay by card comes first, then the Pay by Interac e-transfer heading");
  ok(onHtml.includes("pay@example.com") && onHtml.includes("TEST-1") && onHtml.includes(T.statusWaiting), "card switched on: the e-transfer amount, email, code and status are all still shown");
  for (const [label, extra] of [["free", { cardEnabled: true, order: { status: "paid", total: 0, code: "TEST-2" } }], ["held for review", { cardEnabled: true, needsReview: true }], ["without a ticket link", { cardEnabled: true, tickets: [{ name: "TEST", ticketType: "General", price: 15 }] }]]) {
    const p = payPage();
    p.run(`showPaymentScreen(${unpaid(extra)})`);
    ok(!p.el("page").innerHTML.includes("pay-card"), "no card button when the registration is " + label);
  }
  const withFee = payPage();
  withFee.run(`showPaymentScreen(${unpaid({ cardEnabled: true, cardTotal: 15.76, cardFee: 0.76 })})`);
  ok(withFee.el("page").innerHTML.includes(T.payByCardFee("$15.76", "$0.76")), "buyer card fee is shown upfront on the registration done button");
  withFee.run("apiReply={ok:false,error:'SOLD_OUT',message:'TEST Full.'}");
  await withFee.run("payByCard('TESTSECRET','',T.payByCardFee('$15.76','$0.76'))");
  ok(withFee.el("pay-card").textContent === T.payByCardFee("$15.76", "$0.76"), "after an error, the button keeps its fee wording");
  on.run("apiReply={ok:true,url:'https://evil.example/square.link'}");
  await on.run("payByCard('TESTSECRET','https://events.ucalgarycss.ca/ticket.html?t=TESTSECRET')");
  ok(on.context.location.href === "https://events.ucalgarycss.ca/?e=test" && !on.el("card-error").hidden && !on.el("pay-card").disabled,
    "a checkout address that is not Square's is never opened");
  const call = on.run("apiCalls[0]");
  ok(call.action === "createCardCheckout" && call.details.secret === "TESTSECRET" && call.details.siteUrl === "https://events.ucalgarycss.ca/", "Pay by card sends the ticket secret and the events site address");
  on.run("apiCalls=[]; apiReply={ok:false,error:'NETWORK'}");
  await on.run("payByCard('TESTSECRET','')");
  ok(on.run("apiCalls.length") === 1 && on.el("card-error").textContent === T.cardFailed, "a dropped connection is not retried by itself and shows a calm message");
  on.run("apiCalls=[]; apiReply={ok:false,error:'SOLD_OUT',message:'TEST This event is full.'}");
  await on.run("payByCard('TESTSECRET','')");
  ok(on.el("card-error").textContent === "TEST This event is full." && on.el("card-error").hidden === false && on.el("pay-card").textContent === T.payByCard, "a refusal shows the server's message and Pay by card can be pressed again");
  on.run("apiReply={ok:true,alreadyPaid:true}");
  await on.run("payByCard('TESTSECRET','https://events.ucalgarycss.ca/ticket.html?t=TESTSECRET')");
  ok(on.context.location.href === "https://events.ucalgarycss.ca/ticket.html?t=TESTSECRET", "already paid: opens the ticket instead of a new checkout");
  on.el("pay-card").disabled = false;
  on.run("apiReply={ok:true,url:'https://sandbox.square.link/u/TEST'}");
  await on.run("payByCard('TESTSECRET','')");
  ok(on.context.location.href === "https://sandbox.square.link/u/TEST", "a Square checkout address is opened");
  const allowed = (src) => { const p = page(); p.run(src.slice(src.indexOf("function squareCheckoutUrl"), src.indexOf("\n}\n", src.indexOf("function squareCheckoutUrl")) + 3).replace(/\r/g, "")); return (u) => p.run(`squareCheckoutUrl(${JSON.stringify(u)})`) !== ""; };
  for (const [file, src] of [["public.js", publicSrc], ["ticket.js", ticketSrc]]) {
    const test = allowed(src.replace(/\r\n/g, "\n"));
    ok(test("https://square.link/u/TEST") && test("https://checkout.squareup.com/TEST") && test("https://sandbox.squareupsandbox.com/TEST")
      && !test("http://square.link/u/TEST") && !test("https://evilsquare.link/TEST") && !test("https://square.link.evil.example/TEST") && !test("javascript:alert(1)"),
      file + ": only https Square addresses (square.link, squareup.com, squareupsandbox.com) are allowed");
  }
  ok(!/createCardCheckout[\s\S]{0,300}(for \(let attempt|setTimeout\(\s*resolve)/.test(publicSrc + ticketSrc), "createCardCheckout is never wrapped in a retry loop");

  // Ticket page: back from Square with ?card=1
  const ticketPage = (search, getReply, confirmReply) => {
    const order = [];
    const loc = { href: "https://events.ucalgarycss.ca/ticket.html" + search, search, hash: "", pathname: "/ticket.html", hostname: "events.ucalgarycss.ca" };
    const p = page({ API_URL: "https://test.invalid", CONTACT_EMAIL: "club@example.com", INSTAGRAM_URL: "", navigator: {}, location: loc,
      history: { replaceState(_s, _t, url) { order.push("replaceState:" + url); loc.search = url.slice(url.indexOf("?")); loc.href = "https://events.ucalgarycss.ca" + url; } },
      window: { addEventListener() {} } });
    p.run(strings);
    p.run(ticketSrc.replace(/\bstart\(\);\s*$/, ""));
    p.context.order = order; p.context.getReply = getReply; p.context.confirmReply = confirmReply;
    p.run("api=async(action,details)=>{order.push(action+':'+details.secret);return action==='getTicket'?getReply:confirmReply;};");
    return { p, order, loc };
  };
  const awaitingTicket = (extra) => Object.assign({ ok: true, ticket: { id: "TKTTEST1", name: "TEST Person", ticketType: "General", status: "awaiting", checkedIn: false, orderCode: "TEST-1" },
    event: { name: "TEST Event", date: "2099-01-01" }, etransferEmail: "pay@example.com", orderTotal: 15, orderReceived: 0 }, extra);
  const back = ticketPage("?t=TESTSECRET&card=1", awaitingTicket({ cardEnabled: true }), { ok: true, paid: false });
  await back.p.run("start()");
  ok(back.order[0] === "replaceState:/ticket.html?t=TESTSECRET" && back.order[1] === "confirmCardPayment:TESTSECRET" && back.order[2] === "getTicket:TESTSECRET",
    "ticket page: card=1 is removed from the address (t= kept), then confirmCardPayment, then the ticket loads");
  const backHtml = back.p.el("page").innerHTML;
  ok(backHtml.includes(T.cardNotCompleted.replace(/'/g, "&#39;")) && backHtml.indexOf(T.cardNotCompleted.slice(0, 20)) < backHtml.indexOf("TEST Person"),
    "came back without paying: the calm message is above the normal unpaid ticket");
  ok(backHtml.includes('id="pay-card"') && backHtml.includes("pay@example.com") && backHtml.includes("TEST-1"), "an unpaid ticket offers Pay by card next to the e-transfer details");
  const feeTicket = ticketPage("?t=TESTSECRET", awaitingTicket({ cardEnabled: true, cardTotal: 15.76, cardFee: 0.76 }), null);
  await feeTicket.p.run("start()");
  ok(feeTicket.p.el("page").innerHTML.includes(T.payByCardFee("$15.76", "$0.76")), "ticket page shows the card total and fee upfront when buyer fee is on");
  const paidBack = ticketPage("?t=TESTSECRET&card=1", awaitingTicket({ cardEnabled: true, ticket: { id: "TKTTEST1", name: "TEST Person", ticketType: "General", status: "paid", checkedIn: false, orderCode: "TEST-1" } }), { ok: true, paid: true });
  paidBack.p.run("function QRCode(holder, options){ qrText = options.text; } QRCode.CorrectLevel={M:1}; var qrText='';");
  paidBack.p.el("qr").querySelector = () => null;
  await paidBack.p.run("start()");
  ok(paidBack.p.run("qrText") === "https://events.ucalgarycss.ca/ticket.html?t=TESTSECRET" && !paidBack.p.el("page").innerHTML.includes(T.cardNotCompleted.slice(0, 20)) && !paidBack.p.el("page").innerHTML.includes("pay-card"),
    "paid by card: the QR shows, holding the clean ticket address without card=1");
  const plain = ticketPage("?t=TESTSECRET", awaitingTicket({ cardEnabled: false }), null);
  await plain.p.run("start()");
  ok(plain.order.length === 1 && plain.order[0] === "getTicket:TESTSECRET" && !plain.p.el("page").innerHTML.includes("pay-card") && plain.p.el("page").innerHTML.includes("pay@example.com"),
    "card switched off: no confirm call and no card button; the e-transfer details are unchanged");
  plain.p.run(`render(${JSON.stringify(awaitingTicket({ cardEnabled: true }))}, { state: "offline", savedAt: Date.now() })`);
  ok(!plain.p.el("page").innerHTML.includes("pay-card"), "the saved offline copy never shows Pay by card");
  ok(/etransferEmail: data\.etransferEmail, orderTotal: data\.orderTotal, orderReceived: data\.orderReceived \}/.test(ticketSrc), "the offline copy still saves the same ticket fields");

  // Page versions and the offline worker
  const ver = (html, file) => (html.match(new RegExp(file.replace(".", "\\.") + "\\?v=([0-9.]+)")) || [])[1] || "";
  const atLeast = (v, min) => { const a = v.split(".").map(Number), b = min.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); } return true; };
  const indexHtml = read("public/index.html"), ticketHtml = read("public/ticket.html");
  ok(ver(indexHtml, "strings.js") === ver(ticketHtml, "strings.js") && ver(indexHtml, "public.css") === ver(ticketHtml, "public.css"), "index.html and ticket.html load the same strings.js and public.css versions");
  ok(atLeast(ver(indexHtml, "strings.js"), "1.9.2") && atLeast(ver(indexHtml, "public.js"), "1.9.2") && atLeast(ver(ticketHtml, "ticket.js"), "1.7.2") && atLeast(ver(indexHtml, "public.css"), "1.9.1"),
    "card payment script versions were bumped so browsers fetch the new files");
  const swEvents = {};
  const sw = vm.createContext({ URL, Promise, setTimeout: () => 1, clearTimeout() {}, caches: { open: async () => ({ add: async () => {} }), keys: async () => [] },
    self: { location: { origin: "https://events.ucalgarycss.ca" }, addEventListener: (name, fn) => { swEvents[name] = fn; }, skipWaiting() {}, clients: { claim() {} } } });
  vm.runInContext(read("public/sw.js"), sw);
  let swIntercepted = 0;
  for (const request of [{ method: "POST", url: "https://events.ucalgarycss.ca/api/square-webhook" }, { method: "GET", url: "https://events.ucalgarycss.ca/api/square-webhook" }])
    swEvents.fetch({ request, respondWith: () => { swIntercepted++; } });
  ok(swIntercepted === 0 && /css-ticket-shell-v([3-9]|\d\d)/.test(read("public/sw.js")), "the ticket page worker never answers /api/ requests, and its cache name was bumped");

  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
  process.exitCode = failures ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
