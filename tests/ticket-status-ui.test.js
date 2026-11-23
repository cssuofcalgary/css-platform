// A disabled ticket stays visible without a QR or a reusable ticket link.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const dir = path.join(__dirname, "../public");
function browser(file) {
  const elements = {};
  const element = (id) => elements[id] || (elements[id] = { innerHTML: "", textContent: "", hidden: false, className: "", value: "", style: {}, addEventListener() {}, querySelector() { return null; } });
  const localStorage = {
    getItem(key) { return this[key] || null; },
    setItem(key, value) { this[key] = value; },
    removeItem(key) { delete this[key]; }
  };
  const context = vm.createContext({ console, URL, URLSearchParams, localStorage, CONTACT_EMAIL: "test@example.com", INSTAGRAM_URL: "https://example.com/", API_URL: "", document: { getElementById: element, querySelectorAll() { return []; }, title: "" }, window: { addEventListener() {} }, history: { replaceState() {} }, location: { href: "https://example.com/ticket.html?t=" + "a".repeat(32), search: "", pathname: "/ticket.html" }, setTimeout() {}, clearTimeout() {}, qrCount: 0 });
  vm.runInContext(fs.readFileSync(path.join(dir, "strings.js"), "utf8"), context);
  let src = fs.readFileSync(path.join(dir, file), "utf8");
  src = src.replace(/\b(?:start|openFromLink)\(\);\s*$/, "");
  vm.runInContext(src, context);
  vm.runInContext('function QRCode() { qrCount++; } QRCode.CorrectLevel={M:1};', context);
  return { elements, localStorage, run: (code) => vm.runInContext(code, context) };
}

async function main() {
  const b = browser("ticket.js");
  const disabled = { ok: true, ticket: { id: "TKTTEST1", name: "Test Attendee", ticketType: "General", status: "disabled", checkedIn: false, orderCode: "TEST-1" }, event: { name: "Test Event", date: "2099-01-01", startTime: "18:00", endTime: "21:00", location: "Hall" }, orderTotal: 5, orderReceived: 5, canRequestCancel: false, canGiveFeedback: false };
  b.localStorage.setItem("css_ticket_" + "a".repeat(32), JSON.stringify({ data: { ticket: { status: "paid" } }, qr: "data:old-paid-qr" }));
  b.run("render(" + JSON.stringify(disabled) + ', {state:"live",secret:"' + "a".repeat(32) + '"})');
  assert.match(b.elements.page.innerHTML, /DISABLED/);
  assert.match(b.elements.page.innerHTML, /This ticket is disabled/);
  assert.equal(b.run("qrCount"), 0);
  assert.equal(JSON.parse(b.localStorage.getItem("css_ticket_" + "a".repeat(32))).qr, "");
  console.log("PASS a live disabled ticket has a clear status, draws no QR and removes the old saved QR");
  b.run("render(" + JSON.stringify(disabled) + ', {state:"offline",savedAt:Date.now(),qr:"data:old-paid-qr"})');
  assert.equal(b.run("qrCount"), 0);
  assert.ok(!(b.elements.qr?.innerHTML || "").includes("data:old-paid-qr"));
  console.log("PASS an offline disabled copy cannot display a formerly paid QR");

  const cards = browser("tickets.js");
  cards.run('api=async()=>({ok:true,name:"Test",tickets:[{name:"Test Attendee",ticketType:"General",status:"disabled",event:{name:"Test Event",date:"2099-01-01"}}]})');
  await cards.run('showMyTickets({email:"test@example.com",k:"test"})');
  assert.match(cards.elements["my-cards"].innerHTML, /Disabled/);
  assert.ok(!cards.elements["my-cards"].innerHTML.includes("ticket.html?t="));
  assert.ok(!cards.elements["my-cards"].innerHTML.includes("Waiting for payment"));
  console.log("PASS My tickets retains the disabled entry without a ticket link or payment instructions");

  const doorContext = vm.createContext({ SCANNER_MODE: false, escapeHtml: (value) => String(value || ""), money: (value) => "$" + value, shortTime: () => "now" });
  vm.runInContext(fs.readFileSync(path.join(dir, "../exec-portal/strings.js"), "utf8"), doorContext);
  const doorSource = fs.readFileSync(path.join(dir, "../exec-portal/door.js"), "utf8");
  const doorStart = doorSource.indexOf("function personRow(");
  vm.runInContext(doorSource.slice(doorStart, doorSource.indexOf("// ---- Scanning", doorStart)), doorContext);
  const doorRow = vm.runInContext('personRow({id:"TKTTEST",name:"Test",ticketType:"General",status:"disabled",answers:{}},true)', doorContext);
  assert.match(doorRow, /Disabled/);
  assert.ok(!doorRow.includes("data-checkin") && !doorRow.includes("data-pay"));
  console.log("PASS disabled search results show Disabled at the door without Check in or Mark paid");
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
