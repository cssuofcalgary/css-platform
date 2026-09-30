/**
 * CSS Platform API — stress-test kit (run by hand from the Apps Script editor, never from the web).
 *
 * buildStressTest()        Makes two closed test events and 46 varied fake attendees, then emails an
 *                          HTML sheet of 50 QR codes (46 tickets + 4 bad codes) to TEST_KIT_EMAIL
 *                          (default gordonchen04@gmail.com). Run it ONCE.
 * emailStressTestSheet()   Sends that sheet again (for example after deleting the email).
 * removeStressTest()       Archives both test events so they leave the portal's lists.
 *
 * Every fake person has an address at example.com, which the system never emails.
 * The expected result of scanning each code is printed on the sheet, so a wrong answer is obvious.
 */

const STRESS_EVENT = "Stress Test (delete me)";
const STRESS_OTHER = "Stress Test Other Event (delete me)";
const STRESS_SITE = "https://events.ucalgarycss.ca/";

// kind: m = Member ($4), n = Non-member ($9), g = Guest (free)
// status: paid | awaiting | refunded | cancelled;  in: already checked in;  other: ticket belongs to the other event
// expect: GREEN (let in) | ORANGE (help desk / already in) | RED (not valid)
const STRESS_SPECS = [
  { name: "Alex Tremblay", kind: "n", expect: "GREEN", note: "Plain paid ticket" },
  { name: "李明 (Ming Li)", kind: "m", member: "CSS0000000", expect: "GREEN", note: "Chinese characters in the name" },
  { name: "Zoë Ñuñez-O'Brien", kind: "n", expect: "GREEN", note: "Accents, hyphen and apostrophe" },
  { name: "Jean-Pierre de la Cruz-Villanueva-Montgomery III", kind: "n", expect: "GREEN", note: "Very long name: does it fit on screen?" },
  { name: "Q", kind: "g", expect: "GREEN", note: "One-letter name" },
  { name: "王小明", kind: "g", expect: "GREEN", note: "Name only in Chinese" },
  { name: "Priya Sharma", kind: "g", expect: "GREEN", note: "Free ticket" },
  { name: "Seán O'Connor", kind: "n", expect: "GREEN", note: "" },
  { name: "Amélie Côté", kind: "m", member: "CSS0000000", expect: "GREEN", note: "" },
  { name: "Hyun-woo Kim", kind: "n", expect: "GREEN", note: "" },
  { name: "Sam Patel", kind: "n", expect: "GREEN", note: "" },
  { name: "Taylor Nguyen", kind: "m", member: "CSS0000000", expect: "GREEN", note: "" },
  { name: "Jordan Lee", kind: "n", expect: "GREEN", note: "" },
  { name: "Morgan Wong", kind: "g", expect: "GREEN", note: "" },
  { name: "Riley Chan", kind: "n", expect: "GREEN", note: "" },
  { name: "Casey Zhang", kind: "m", member: "CSS0000000", expect: "GREEN", note: "" },
  { name: "Jamie Liu", kind: "n", expect: "GREEN", note: "" },
  { name: "Avery Huang", kind: "n", expect: "GREEN", note: "" },
  { name: "Drew Lam", kind: "g", expect: "GREEN", note: "" },
  { name: "Quinn Ho", kind: "n", expect: "GREEN", note: "" },
  { name: "Wei Chen", kind: "n", group: "Chen family", expect: "GREEN", note: "Group order of 4 (payer)" },
  { name: "Mei Chen", kind: "n", group: "Chen family", expect: "GREEN", note: "Group order of 4" },
  { name: "Bo Chen", kind: "n", group: "Chen family", expect: "GREEN", note: "Group order of 4" },
  { name: "Lily Chen", kind: "g", group: "Chen family", expect: "GREEN", note: "Group order of 4" },
  { name: "Ken Yip", kind: "n", status: "awaiting", group: "Yip friends", expect: "ORANGE", note: "Unpaid group of 3: help desk marks the ORDER paid, then rescan" },
  { name: "Amy Yip", kind: "n", status: "awaiting", group: "Yip friends", expect: "ORANGE", note: "Unpaid group of 3" },
  { name: "Ted Yip", kind: "n", status: "awaiting", group: "Yip friends", expect: "ORANGE", note: "Unpaid group of 3" },
  { name: "Nora Unpaid", kind: "n", status: "awaiting", expect: "ORANGE", note: "Unpaid single: pay at the help desk, then rescan" },
  { name: "Fiona NotAMember", kind: "m", flag: "Member price, but no membership found", expect: "ORANGE", note: "Flagged: only the help desk lets flagged people in" },
  { name: "Gus NoMemberId", kind: "m", flag: "Member price, but no member ID or UCID given", expect: "ORANGE", note: "Flagged" },
  { name: "Hana UnpaidMember", kind: "m", flag: "Member price, but membership isn't paid yet", expect: "ORANGE", note: "Flagged" },
  { name: "Ivy Duplicate", kind: "n", flag: "Already registered with this email", expect: "ORANGE", note: "Flagged: possible duplicate" },
  { name: "Rex Refunded", kind: "n", status: "refunded", expect: "RED", note: "Refunded: must never get in" },
  { name: "Rita Refunded", kind: "m", member: "CSS0000000", status: "refunded", expect: "RED", note: "Refunded" },
  { name: "Cal Cancelled", kind: "n", status: "cancelled", expect: "RED", note: "Cancelled" },
  { name: "Ivan AlreadyIn", kind: "n", in: true, expect: "ORANGE", note: "Already checked in (30 min ago)" },
  { name: "Isla AlreadyIn", kind: "g", in: true, expect: "ORANGE", note: "Already checked in" },
  { name: "Ira AlreadyIn", kind: "n", in: true, expect: "ORANGE", note: "Already checked in" },
  { name: "Wanda WrongEvent", kind: "n", other: true, expect: "RED", note: "Ticket for a DIFFERENT event: should say so" },
  { name: "Warren WrongEvent", kind: "n", other: true, expect: "RED", note: "Ticket for a different event" },
  { name: "Dana Drinks", kind: "n", drink: "Juice", expect: "GREEN", note: "Shows drink answer (Juice)" },
  { name: "Eli Tea", kind: "n", drink: "Tea", expect: "GREEN", note: "Shows drink answer (Tea)" },
  { name: "Flo Water", kind: "g", drink: "Water", expect: "GREEN", note: "Shows drink answer (Water)" },
  { name: "Tina TypedId", kind: "n", expect: "GREEN", note: "Test the manual way: type her ticket ID (printed on the card) or search her name" },
  { name: "Sam 🎉 Party", kind: "n", expect: "GREEN", note: "Emoji in the name" },
  { name: "Dupe Scan", kind: "n", expect: "GREEN", note: "Scan twice in a row: 2nd is ignored for 10 s, then says already checked in" }
];

const STRESS_BAD_CODES = [
  { label: "Random ticket, not in the system", expect: "RED", note: "Should say ticket not found", text: function () { return STRESS_SITE + "ticket.html?t=" + Utilities.getUuid().replace(/-/g, ""); } },
  { label: "Cut-off ticket link", expect: "RED", note: "Should say ticket not found", text: function () { return STRESS_SITE + "ticket.html?t=abc123"; } },
  { label: "Membership card (not a ticket)", expect: "RED", note: "Should say it's a membership card", text: function () { return "https://member.ucalgarycss.ca/CSS-2026-0001"; } },
  { label: "Unrelated QR code", expect: "RED", note: "Should say couldn't read that code", text: function () { return "https://example.com/hello-world"; } }
];

function stressTestEmail_() {
  return PropertiesService.getScriptProperties().getProperty("TEST_KIT_EMAIL") || "gordonchen04@gmail.com";
}

function buildStressTest() {
  if (allEvents_().some(function (e) { return e.name === STRESS_EVENT; })) {
    throw new Error("The stress test already exists. Run emailStressTestSheet() to get the QR sheet again, or removeStressTest() first.");
  }
  const now = new Date().toISOString();
  const types = [
    { id: newId_("TT"), name: "Member", price: 4, needsMembership: true },
    { id: newId_("TT"), name: "Non-member", price: 9, needsMembership: false },
    { id: newId_("TT"), name: "Guest", price: 0, needsMembership: false }
  ];
  const questions = [{ id: newId_("Q"), label: "Which drink would you like?", type: "choice", options: ["Water", "Juice", "Tea"], required: false }];

  const makeEvent = function (name, prefix) {
    const event = {
      id: newId_("EV"), slug: uniqueSlug_(name, allEvents_()), name: name,
      description: "Stress test data. Safe to delete.", date: "2026-10-05", startTime: "18:00", endTime: "21:00",
      location: "Test lab", capacity: 150, capacityRule: "paid", status: "closed", entryOpen: false,
      imageFileId: "", imageUrl: "", ticketTypes: types, questions: questions, codePrefix: prefix,
      createdBy: "Stress test kit", createdAt: now, updatedBy: "Stress test kit", updatedAt: now, registrationCloses: ""
    };
    insertRow_("Events", event);
    return event;
  };
  const main = makeEvent(STRESS_EVENT, "ST");
  const other = makeEvent(STRESS_OTHER, "SB");
  log_("Stress test kit", "event.create", main.id, { name: main.name });

  const typeOf = function (kind) { return types[kind === "m" ? 0 : kind === "n" ? 1 : 2]; };
  const orderFor = {};   // group name -> order
  const thirtyMinAgo = new Date(Date.now() - 30 * 60000).toISOString();

  STRESS_SPECS.forEach(function (spec, i) {
    const n = i + 1;
    const event = spec.other ? other : main;
    const status = spec.status || "paid";
    const type = typeOf(spec.kind);
    let order = spec.group ? orderFor[spec.group] : null;
    if (!order) {
      order = {
        id: newId_("OR"), code: uniqueCode_(event, readRows_("Orders")), eventId: event.id,
        payerName: spec.name, payerEmail: "stress-" + pad2_(n) + "@example.com", etransferName: "",
        total: 0, status: status, createdAt: now,
        paidAt: status === "awaiting" ? "" : now, paidBy: status === "awaiting" ? "" : "Stress test kit",
        notes: "Stress test: " + (spec.group || spec.name)
      };
      insertRow_("Orders", order);
      if (spec.group) orderFor[spec.group] = order;
    }
    if (spec.group) {   // keep the group's total right (updated once per person)
      order.total = (Number(order.total) || 0) + type.price;
      updateRow_("Orders", order.id, { total: order.total });
    } else {
      order.total = type.price;
      updateRow_("Orders", order.id, { total: type.price });
    }
    const answers = {};
    if (spec.drink) answers["Which drink would you like?"] = spec.drink;
    insertRow_("Tickets", {
      id: newTicketId_(), secret: Utilities.getUuid().replace(/-/g, ""), orderId: order.id, eventId: event.id,
      name: spec.name, email: "stress-" + pad2_(n) + "@example.com", ucid: "", memberId: spec.member || "",
      ticketType: type.name, price: type.price, answers: answers, flag: spec.flag || "", status: status,
      checkedInAt: spec.in ? thirtyMinAgo : "", checkedInBy: spec.in ? "Test Volunteer" : "",
      createdAt: now, emailedAt: "test kit, no email"
    });
  });

  emailStressTestSheet();
  console.log("Stress test built: " + STRESS_SPECS.length + " tickets. The QR sheet was emailed to " + stressTestEmail_() + ".");
}

function pad2_(n) { return (n < 10 ? "0" : "") + n; }

function removeStressTest() {
  allEvents_().forEach(function (e) {
    if (e.name === STRESS_EVENT || e.name === STRESS_OTHER) updateRow_("Events", e.id, { status: "archived", updatedBy: "Stress test kit", updatedAt: new Date().toISOString() });
  });
  console.log("Stress test events archived.");
}

function emailStressTestSheet() {
  const main = allEvents_().filter(function (e) { return e.name === STRESS_EVENT; })[0];
  if (!main) throw new Error("Run buildStressTest() first.");
  const bySpec = {};
  readRows_("Tickets").forEach(function (t) {
    const m = /^stress-(\d+)@example\.com$/.exec(t.email);
    if (m) bySpec[parseInt(m[1], 10)] = t;
  });

  const cards = [];
  STRESS_SPECS.forEach(function (spec, i) {
    const t = bySpec[i + 1];
    if (!t) return;
    cards.push({
      n: i + 1, title: spec.name, sub: t.ticketType + " · " + t.id + (t.flag ? " · flagged" : ""),
      expect: spec.expect, note: spec.note, qr: STRESS_SITE + "ticket.html?t=" + t.secret
    });
  });
  STRESS_BAD_CODES.forEach(function (bad, j) {
    cards.push({ n: STRESS_SPECS.length + j + 1, title: bad.label, sub: "Not a real ticket", expect: bad.expect, note: bad.note, qr: bad.text() });
  });

  const html = stressSheetHtml_(cards);
  const blob = Utilities.newBlob(html, "text/html", "stress-test-qr-sheet.html");
  const file = DriveApp.createFile(blob);
  MailApp.sendEmail({
    to: stressTestEmail_(),
    subject: "CSS stress test: 50 QR codes",
    body: "Open the attached stress-test-qr-sheet.html in a browser (download it first). It has 50 QR codes with what each scan should do. A copy is also in Google Drive: " + file.getUrl(),
    attachments: [blob],
    name: MAIL_FROM_NAME
  });
  console.log("Sheet emailed to " + stressTestEmail_() + " and saved to Drive: " + file.getUrl());
}

function stressSheetHtml_(cards) {
  const color = { GREEN: "#4c6b47", ORANGE: "#c2740c", RED: "#a12b2b" };
  const count = function (c) { return cards.filter(function (x) { return x.expect === c; }).length; };
  const items = cards.map(function (c) {
    return "<div class=\"card\" style=\"border-color:" + color[c.expect] + "\">" +
      "<div class=\"n\">#" + c.n + "</div>" +
      "<img alt=\"QR " + c.n + "\" width=\"180\" height=\"180\" src=\"https://quickchart.io/qr?size=360&margin=2&text=" + encodeURIComponent(c.qr) + "\">" +
      "<div class=\"who\">" + esc_(c.title) + "</div><div class=\"sub\">" + esc_(c.sub) + "</div>" +
      "<div class=\"exp\" style=\"background:" + color[c.expect] + "\">Expect " + c.expect + "</div>" +
      (c.note ? "<div class=\"note\">" + esc_(c.note) + "</div>" : "") + "</div>";
  }).join("");
  return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>CSS stress test: 50 QR codes</title>" +
    "<style>body{font-family:Georgia,serif;margin:16px;color:#2a2520;background:#f3ecda}h1{margin:0 0 4px}" +
    ".how{background:#fbf7ea;border:2px dashed #a8822e;border-radius:8px;padding:12px 18px;max-width:900px}.how li{margin:4px 0}" +
    ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:16px}" +
    ".card{background:#fff;border:4px solid;border-radius:10px;padding:10px;text-align:center;break-inside:avoid}" +
    ".n{font:700 20px monospace}.who{font-weight:700;margin-top:6px}.sub{font-size:12px;color:#6b6153}" +
    ".exp{color:#fff;font:700 12px monospace;border-radius:4px;padding:4px;margin:6px 0 2px}.note{font-size:12px;color:#6b6153;font-style:italic}" +
    "@media print{body{background:#fff}.card{page-break-inside:avoid}}</style></head><body>" +
    "<h1>CSS stress test: " + cards.length + " QR codes</h1>" +
    "<p>Expected: <b style=\"color:" + color.GREEN + "\">" + count("GREEN") + " green</b> · <b style=\"color:" + color.ORANGE + "\">" + count("ORANGE") + " orange</b> · <b style=\"color:" + color.RED + "\">" + count("RED") + " red</b>. Show this page on a laptop or print it, and scan with a phone at exec.ucalgarycss.ca/scanner/.</p>" +
    "<div class=\"how\"><b>How to run it</b><ol>" +
    "<li>On a laptop: Exec Portal → Door → pick <b>Stress Test (delete me)</b>. Entry starts <b>closed</b>.</li>" +
    "<li>Scan #1 <i>while entry is closed</i>: should be orange \"entry is closed\". Then tap <b>Entry CLOSED</b> to open it and scan #1 again: green.</li>" +
    "<li>Work through the rest. Every card says what it should do. Note any card whose colour or message is wrong.</li>" +
    "<li>Orange: unpaid people are fixed at the help desk (Payments: mark the order paid, then rescan). Flagged people are checked in at the help desk.</li>" +
    "<li>Scan #" + (STRESS_SPECS.findIndex(function (x) { return x.name === "Dupe Scan"; }) + 1) + " twice quickly, then again after 10 seconds. Try <b>Undo</b> on one. Try typing #" + (STRESS_SPECS.findIndex(function (x) { return x.name === "Tina TypedId"; }) + 1) + "'s ticket ID.</li>" +
    "<li>Add 2-3 walk-ins at the help desk (cash and e-transfer). Then check the counter and the Activity tab (admin).</li>" +
    "<li>Watch for: slow scans, wrong colours, names that don't fit, the counter drifting, the connection notice.</li></ol></div>" +
    "<div class=\"grid\">" + items + "</div></body></html>";
}
