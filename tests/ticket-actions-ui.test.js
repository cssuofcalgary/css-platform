// Disable one ticket from either list using the real dialog code. No live records or email.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
let fails = 0;
const ok = (condition, message) => {
  console.log((condition ? "PASS " : "FAIL ") + message);
  if (!condition) fails++;
};

const firstTicket = { id: "TKT-FIRST", name: "First Attendee", email: "first@example.com", ticketType: "General", price: 5, status: "paid", checkedInAt: "", answers: {}, emailedAt: "" };
const sibling = { ...firstTicket, id: "TKT-SIBLING", name: "Sibling Attendee", email: "sibling@example.com" };
const order = { id: "OR-ONE", code: "TEST-1234", eventId: "EV-ONE", payerName: "First Attendee", payerEmail: "first@example.com", status: "paid", total: 10, received: 10, refund: { state: "none", records: [] }, tickets: [firstTicket, sibling] };

function browser() {
  const elements = {};
  let context;
  function element(id) {
    return elements[id] || (elements[id] = {
      hidden: false, disabled: false, value: "", textContent: "", open: false,
      addEventListener() {}, focus() {}, select() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      set innerHTML(html) {
        this.html = html;
        if (id === "inv-tickets") {
          context.inputs = [...html.matchAll(/<input\b([^>]*data-inv="([^"]+)"[^>]*)>/g)].map((m) => ({ dataset: { inv: m[2] }, checked: /\bchecked\b/.test(m[1]), disabled: /\bdisabled\b/.test(m[1]) }));
        }
      },
      get innerHTML() { return this.html || ""; }
    });
  }
  context = vm.createContext({
    console, URL, Set,
    $: element,
    inputs: [], requests: [], toasts: [], errors: [], orderLoads: 0, attendeeLoads: 0,
    escapeHtml: (value) => String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    money: (n) => "$" + Number(n).toFixed(2), dollars: (n) => "$" + Number(n).toFixed(2), shortTime: () => "now", ticketUrl: () => "https://example.com/ticket",
    eventsState: { loaded: true }, state: {}, showEventsList() {},
    window: { scrollTo() {} }, location: { href: "https://example.com/" }, PUBLIC_SITE_URL: "https://example.com/",
    setInterval() {}, setTimeout() {}, clearTimeout() {},
    document: {
      querySelectorAll(selector) {
        if (!selector.startsWith("#inv-tickets")) return [];
        return context.inputs.filter((i) => (!selector.includes(":checked") || i.checked) && (!selector.includes(":not(:disabled)") || !i.disabled));
      },
      querySelector() { return null; }
    },
    showToast(message) { context.toasts.push(message); },
    handleEventError(reply) { context.errors.push(reply); }, errorText: (reply) => reply.message || reply.error,
    api: async (action, details) => { context.requests.push({ action, details }); return context.nextReply; }
  });
  context.apiOnce = (action, details) => context.api(action, details);
  const run = (code) => vm.runInContext(code, context);
  for (const file of ["strings.js", "payments.js", "money.js", "attendees.js"]) {
    run(fs.readFileSync(path.join(__dirname, "../exec-portal", file), "utf8"));
  }
  run(`
    loadOrders = () => { orderLoads++; };
    loadAttendees = () => { attendeeLoads++; };
    var testOrder = ${JSON.stringify(order)};
    var submitEvent = { preventDefault() {} };
    payState.data = { orders: [testOrder], event: { id: "EV-ONE" } };
    attState.event = { id: "EV-ONE" };
    attState.data = { event: { id: "EV-ONE", archived: false }, attendees: [Object.assign({}, testOrder.tickets[0], { order: { id: testOrder.id, code: testOrder.code } })] };
  `);
  return { run, context, elements };
}

async function main() {
  const b = browser();
  b.run(`openSingleTicketDialog(testOrder, "TKT-FIRST");`);
  ok(b.elements["invalidate-dialog"].open && b.context.requests.length === 0, "opening Disable ticket asks for confirmation without writing anything");
  ok(b.elements["inv-title"].textContent.includes("TEST-1234") && /QR code will stop working/.test(b.elements["inv-intro"].textContent), "the dialog identifies the order and explains that its QR will stop working");
  ok(b.elements["inv-tickets"].innerHTML.includes("First Attendee") && !b.elements["inv-tickets"].innerHTML.includes("Sibling Attendee"), "single-ticket confirmation shows only the chosen attendee");
  ok(b.context.inputs.length === 1 && b.context.inputs[0].checked && b.context.inputs[0].dataset.inv === "TKT-FIRST", "the exact chosen ticket starts selected");
  ok(b.elements["inv-all"].hidden && b.elements["inv-save"].textContent === "Disable ticket", "single-ticket mode hides Select all and gives a clear final action");
  ok(b.elements["inv-refund"].value === "5", "the suggested refund covers only this ticket's price");
  b.context.inputs.push({ dataset: { inv: "TKT-SIBLING" }, checked: true });
  b.context.nextReply = { ok: true, invalidated: 1, qrRejected: true, refund: null };
  b.elements["inv-refund"].value = "0";
  await b.run("submitInvalidate(submitEvent)");
  const sent = b.context.requests[0];
  ok(sent.action === "invalidateTickets" && sent.details.orderId === "OR-ONE" && sent.details.ticketIds.length === 1 && sent.details.ticketIds[0] === "TKT-FIRST", "the final confirmation sends the exact ticket ID and excludes its sibling");
  ok(sent.details.refundAmount === "0", "a zero refund is preserved");
  ok(!b.elements["invalidate-dialog"].open && b.context.orderLoads === 1 && b.context.attendeeLoads === 0, "a Payments action closes the dialog and refreshes Payments");

  const api = require("./harness.js");
  api.run(`
    function withLock_(fn) { return fn(); }
    TBL.Orders = [${JSON.stringify(order)}];
    TBL.Tickets = ${JSON.stringify(order.tickets)}.map(function (t) { return Object.assign({}, t, { orderId: "OR-ONE", eventId: "EV-ONE" }); });
    TBL.Events = [{ id:"EV-ONE", name:"Test Event", date:"2099-01-01", status:"published", entryOpen:"TRUE", ticketTypes:[], questions:[] }];
    TBL.Tickets[0].secret = "a".repeat(32); TBL.Tickets[1].secret = "b".repeat(32);
    function table_() {}
    function findTicketFresh_(kind, value) { return TBL.Tickets.find(function(t) { return t[kind === "secret" ? "secret" : "id"] === value; }); }
    TBL.Refunds = [];
    invalidateTickets_({ name: "Test Exec" }, ${JSON.stringify(sent.details)});
  `);
  ok(api.run('TBL.Tickets[0].status === "refunded" && TBL.Tickets[1].status === "paid" && TBL.Orders[0].status === "paid" && TBL.Orders[0].total === 5'), "the actual API disables the chosen ticket while the sibling and remaining order stay paid");
  ok(api.run('scanCode_({name:"Test Door"}, "EV-ONE", "a".repeat(32), false).result.color === "red" && !TBL.Tickets[0].checkedInAt'), "the disabled ticket's original QR is rejected without check-in");
  ok(api.run('scanCode_({name:"Test Door"}, "EV-ONE", "b".repeat(32), false).result.color === "green"'), "the sibling's QR still admits its attendee");
  api.run('restoreTickets_({name:"Test Exec"}, {orderId:"OR-ONE",ticketIds:["TKT-FIRST"]});');
  ok(api.run('scanCode_({name:"Test Door"}, "EV-ONE", "a".repeat(32), false).result.color === "green"'), "putting the selected ticket back restores its original QR");

  b.run(`openInvalidateDialog(testOrder);`);
  ok(!b.elements["inv-all"].hidden && b.context.inputs.length === 2 && b.context.inputs.every((i) => !i.checked), "the existing whole-order dialog still starts with no selections");
  b.run(`testOrder.tickets[0].checkedInAt = "now";`);
  const toastsBefore = b.context.toasts.length;
  b.run(`openSingleTicketDialog(testOrder, "TKT-FIRST");`);
  ok(b.context.toasts.length === toastsBefore + 1, "a ticket checked in since the list loaded is refused before opening");
  b.run(`testOrder.tickets[0].checkedInAt = ""; testOrder.tickets[0].status = "cancelled";`);
  b.run(`openSingleTicketDialog(testOrder, "TKT-FIRST");`);
  ok(b.context.toasts.length === toastsBefore + 2, "an already disabled ticket cannot be disabled again");
  b.run(`testOrder.tickets[0].status = "paid";`);
  const paidMarkup = b.run("orderCard(testOrder)");
  ok(paidMarkup.includes('data-act="disable" data-ticket="TKT-FIRST"') && paidMarkup.includes('data-act="disable" data-ticket="TKT-SIBLING"'), "each live Payment ticket has its own Disable ticket action");
  b.run(`testOrder.tickets[0].checkedInAt = "now"; testOrder.tickets[1].status = "refunded";`);
  ok(!b.run("orderCard(testOrder)").includes('data-act="disable"'), "Payments hides disable actions for checked-in or stopped tickets");
  b.run(`testOrder.tickets[0].checkedInAt = ""; testOrder.tickets[1].status = "paid";`);
  ok(b.run("attendeeCard(attState.data.attendees[0])").includes('data-att-disable="TKT-FIRST"'), "the Attendees list has an individual Disable ticket action");
  b.run(`attState.data.event.archived = true;`);
  ok(!b.run("attendeeCard(attState.data.attendees[0])").includes('data-att-disable'), "archived attendees have no disable action");
  b.run(`attState.data.event.archived = false; attState.data.attendees[0].checkedInAt = "now";`);
  ok(!b.run("attendeeCard(attState.data.attendees[0])").includes('data-att-disable'), "checked-in attendees have no disable action");

  const a = browser();
  a.run(`var attButton = { dataset: { attDisable: "TKT-FIRST" }, disabled: false }; var attClick = { target: { closest: () => attButton } };`);
  a.context.nextReply = { ok: false, error: "NETWORK", message: "Cannot load order" };
  await a.run("onAttendeeClick(attClick)");
  ok(a.context.requests.length === 1 && a.context.requests[0].action === "listOrders" && a.context.errors.length === 1 && !a.elements["invalidate-dialog"], "a failed attendee order read opens no dialog and makes no writes");
  a.context.nextReply = { ok: true, orders: [{ ...order, id: "WRONG-ORDER" }] };
  await a.run("onAttendeeClick(attClick)");
  ok(a.context.requests.every((r) => r.action === "listOrders") && a.context.toasts.length === 1 && !a.elements["invalidate-dialog"], "a search result with a different order ID cannot disable anything");
  a.context.nextReply = { ok: true, orders: [{ ...order, tickets: [sibling] }] };
  await a.run("onAttendeeClick(attClick)");
  ok(!a.elements["invalidate-dialog"], "a missing exact ticket is refused without a dialog or write");
  a.context.nextReply = { ok: true, orders: [order] };
  await a.run("onAttendeeClick(attClick)");
  ok(a.context.requests.at(-1).details.eventId === "EV-ONE" && a.context.requests.at(-1).details.filter === "all" && a.context.requests.at(-1).details.q === "TEST-1234", "Attendees reads the complete order by its event and payment code");
  ok(a.elements["invalidate-dialog"].open && a.context.requests.every((r) => r.action === "listOrders"), "the attendee action waits at the same confirmation dialog before any write");
  a.context.nextReply = { ok: true, invalidated: 1, qrRejected: true, refund: { owed: 5 } };
  await a.run("submitInvalidate(submitEvent)");
  ok(a.context.attendeeLoads === 1 && a.context.orderLoads === 0, "a successful attendee action refreshes Attendees instead of Payments");
  ok(a.context.requests.at(-1).details.ticketIds.length === 1 && a.context.requests.at(-1).details.ticketIds[0] === "TKT-FIRST", "the attendee confirmation also submits only the clicked ticket");

  const failure = browser();
  failure.run(`openSingleTicketDialog(testOrder, "TKT-FIRST");`);
  failure.context.nextReply = { ok: false, error: "BAD_REQUEST", message: "Already checked in" };
  await failure.run("submitInvalidate(submitEvent)");
  ok(failure.elements["invalidate-dialog"].open && !failure.elements["inv-save"].disabled && failure.elements["inv-error"].textContent === "Already checked in", "a server refusal keeps the dialog open, shows the reason, and permits correction");
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exitCode = fails ? 1 : 0;
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
