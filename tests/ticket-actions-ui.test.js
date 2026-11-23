// Disable/enable keeps registrations separate from cancellation and refunds. No live records or email.
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
    inputs: [], requests: [], toasts: [], errors: [], confirmations: [], confirmAnswers: [], orderLoads: 0, attendeeLoads: 0,
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
  context.askConfirm = async (message, label) => { context.confirmations.push({ message, label }); return context.confirmAnswers.shift() || false; };
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
  let resolveConfirm;
  b.context.askConfirm = (message, label) => { b.context.confirmations.push({ message, label }); return new Promise((resolve) => { resolveConfirm = resolve; }); };
  const pending = b.run('openSingleTicketDialog(testOrder, "TKT-FIRST")');
  ok(b.context.confirmations.length === 1 && b.context.requests.length === 0, 'Disable waits for confirmation before any write');
  const question = b.context.confirmations[0];
  ok(question.label === 'Disable ticket' && question.message.includes('First Attendee') && question.message.includes('TEST-1234'), 'confirmation identifies the exact person and registration');
  ok(question.message.includes('stays in the registration list') && question.message.includes('Payment and refunds stay unchanged'), 'Disable clearly keeps the record and its money');
  ok(!b.elements['invalidate-dialog']?.open && !b.elements['inv-refund']?.value, 'Disable never opens the cancellation or refund form');
  await b.run('openSingleTicketDialog(testOrder, "TKT-FIRST")');
  ok(b.context.confirmations.length === 1, 'double-clicking does not start another confirmation');
  b.context.nextReply = { ok: true, enabled: false, changed: 1 };
  resolveConfirm(true);
  await pending;
  const sent = b.context.requests[0];
  ok(sent.action === 'setTicketEnabled' && sent.details.enabled === false && sent.details.orderId === 'OR-ONE', 'Disable uses its own API action instead of cancelling');
  ok(sent.details.ticketIds.length === 1 && sent.details.ticketIds[0] === 'TKT-FIRST', 'only the selected ticket is disabled');
  ok(!('refundAmount' in sent.details) && !('amount' in sent.details), 'Disable never records a payment or refund amount');
  ok(b.context.orderLoads === 1 && b.context.attendeeLoads === 0, 'Payments refreshes after Disable');

  const cancelled = browser();
  await cancelled.run('openSingleTicketDialog(testOrder, "TKT-FIRST")');
  ok(cancelled.context.requests.length === 0, 'declining confirmation writes nothing');

  b.run('testOrder.tickets[0].status="disabled"; testOrder.tickets[0].disabledFrom="paid"; attState.data.attendees[0].status="disabled";');
  const paymentMarkup = b.run('orderCard(testOrder)');
  const attendeeMarkup = b.run('attendeeCard(attState.data.attendees[0])');
  ok(paymentMarkup.includes('Disabled') && paymentMarkup.includes('data-act="enable" data-ticket="TKT-FIRST"'), 'a disabled Payment ticket stays visible with Enable ticket');
  ok(attendeeMarkup.includes('Disabled') && attendeeMarkup.includes('data-att-enable="TKT-FIRST"'), 'a disabled attendee stays visible with Enable ticket');
  ok(!attendeeMarkup.includes('data-att-disable'), 'a disabled ticket cannot be disabled again');
  b.context.askConfirm = async () => true;
  b.context.nextReply = { ok: true, enabled: true, changed: 1 };
  await b.run('setSingleTicketEnabled(testOrder, "TKT-FIRST", true)');
  ok(b.context.requests.at(-1).action === 'setTicketEnabled' && b.context.requests.at(-1).details.enabled === true, 'Enable uses the same separate status API');

  const full = browser();
  full.run('testOrder.tickets[0].status="disabled";');
  full.context.confirmAnswers.push(true, true);
  full.context.apiOnce = async (action, details) => { full.context.requests.push({action,details}); return full.context.requests.length === 1 ? {ok:false,error:'OVER_CAPACITY',message:'Event full'} : {ok:true,enabled:true}; };
  await full.run('setSingleTicketEnabled(testOrder, "TKT-FIRST", true)');
  ok(full.context.requests.length === 2 && !full.context.requests[0].details.force && full.context.requests[1].details.force, 'enabling beyond capacity requires a second explicit confirmation');
  ok(full.context.confirmations.length === 2, 'the capacity warning is presented before forcing Enable');

  b.run('openInvalidateDialog(testOrder)');
  ok(b.elements['invalidate-dialog'].open && b.elements['inv-title'].textContent.startsWith('Cancel tickets'), 'Cancel remains a separate named dialog');
  ok(b.context.inputs.length === 2 && b.context.inputs.every((i) => !i.checked), 'cancellation can include disabled tickets and starts unselected');
  b.context.inputs[0].checked = true;
  b.run('updateInvalidate()');
  ok(b.elements['inv-refund'].value === '5', 'cancelling a disabled paid ticket still offers its refund amount');
  b.elements['inv-refund'].value = '0';
  b.context.nextReply = {ok:true,invalidated:1,qrRejected:true};
  await b.run('submitInvalidate(submitEvent)');
  ok(b.context.requests.at(-1).action === 'invalidateTickets' && b.context.requests.at(-1).details.refundAmount === '0', 'Cancel continues through the refund-aware cancellation API');

  const a = browser();
  a.run('var attButton={dataset:{attDisable:"TKT-FIRST"},disabled:false}; var attClick={target:{closest:()=>attButton}};');
  a.context.nextReply = {ok:false,error:'NETWORK',message:'Cannot load order'};
  await a.run('onAttendeeClick(attClick)');
  ok(a.context.requests.length === 1 && a.context.requests[0].action === 'listOrders' && a.context.errors.length === 1 && a.context.confirmations.length === 0, 'failed order read cannot reach Disable confirmation or write');
  a.context.nextReply = {ok:true,orders:[{...order,id:'WRONG-ORDER'}]};
  await a.run('onAttendeeClick(attClick)');
  ok(a.context.requests.every((r) => r.action === 'listOrders') && a.context.toasts.length === 1, 'a different order ID can never be disabled');
  let resolveAttendeeConfirm;
  a.context.askConfirm = (message,label) => { a.context.confirmations.push({message,label}); return new Promise((resolve)=>{resolveAttendeeConfirm=resolve;}); };
  a.context.nextReply = {ok:true,orders:[order]};
  const attendeePending = a.run('onAttendeeClick(attClick)');
  await new Promise(setImmediate);
  ok(a.context.requests.at(-1).details.q === 'TEST-1234' && a.context.requests.every((r)=>r.action==='listOrders'), 'attendee Disable loads its exact order and waits for confirmation');
  a.context.nextReply = {ok:true,enabled:false};
  resolveAttendeeConfirm(true); await attendeePending;
  ok(a.context.attendeeLoads === 1 && a.context.orderLoads === 0 && a.context.requests.at(-1).details.ticketIds[0] === 'TKT-FIRST', 'attendee Disable writes only that ticket and refreshes Attendees');
  a.run('attState.data.event.archived=true');
  ok(!a.run('attendeeCard(attState.data.attendees[0])').includes('data-att-disable'), 'archived attendees have no disable action');

  const notes = browser();
  notes.run('testOrder.tickets[0].note="<script>hi</script>\\nSecond line"; attState.data.attendees[0].note=testOrder.tickets[0].note;');
  const noteMarkup = notes.run('orderCard(testOrder)');
  ok(noteMarkup.includes('&lt;script&gt;hi&lt;/script&gt;<br>Second line') && !noteMarkup.includes('<script>'), 'attendee notes preserve line breaks and escape HTML in Payments');
  ok(notes.run('attendeeCard(attState.data.attendees[0])').includes('&lt;script&gt;'), 'Attendees also escapes note HTML');
  const csv = notes.run('attendeesCsv({event:{questions:[]},attendees:[Object.assign({},attState.data.attendees[0],{order:{code:"TEST",notes:"Staff note"}})]})');
  ok(csv.includes('Notes,Attendee note') && csv.includes('Staff note') && csv.includes('Second line'), 'CSV keeps staff notes and attendee comments in separate columns');

  const free = browser();
  free.run('testOrder.status="awaiting"; testOrder.total=0; var actionResult={textContent:""}; var payButton={dataset:{act:"pay"},disabled:false,closest:()=>({dataset:{order:"OR-ONE"},querySelector:()=>actionResult})}; var payClick={target:{closest:(s)=>s.includes("button[data-act]")?payButton:null}};');
  free.context.nextReply = {ok:true,confirmed:1,emailsSent:0,emailsWaiting:0};
  await free.run('onOrdersClick(payClick)');
  ok(free.context.requests.length === 1 && free.context.requests[0].action === 'markOrderPaid' && !('amount' in free.context.requests[0].details), 'Mark paid (Free) directly approves zero without asking for an amount');
  ok(!free.elements['pay-dialog']?.open && free.context.confirmations.length === 0, 'free approval opens no payment dialog or ordinary confirmation');
  const nonzero = browser();
  nonzero.run('testOrder.status="awaiting"; var moneyDialogCalls=0; openPayDialog=()=>{moneyDialogCalls++}; var payButton={dataset:{act:"pay"},disabled:false,closest:()=>({dataset:{order:"OR-ONE"},querySelector:()=>({})})}; var payClick={target:{closest:(s)=>s.includes("button[data-act]")?payButton:null}};');
  await nonzero.run('onOrdersClick(payClick)');
  ok(nonzero.run('moneyDialogCalls') === 1 && nonzero.context.requests.length === 0, 'a nonzero order retains the payment amount dialog');
  const freeFailure=browser();
  freeFailure.run('var freeButton={disabled:false}; var freeResult={textContent:""};');
  freeFailure.context.nextReply={ok:false,error:'TEMPORARY',message:'Try again'};
  await freeFailure.run('markFreeOrderPaid({id:"FREE",total:0},freeButton,freeResult,"https://example.com/")');
  ok(!freeFailure.run('freeButton.disabled') && freeFailure.context.errors.length === 1, 'a failed free approval preserves the record and allows retry');
  const freeFull=browser();
  freeFull.run('var freeButton={disabled:false}; var freeResult={textContent:""};');
  freeFull.context.confirmAnswers.push(true);
  freeFull.context.apiOnce=async(action,details)=>{freeFull.context.requests.push({action,details}); return freeFull.context.requests.length===1?{ok:false,error:'OVER_CAPACITY',message:'Full'}:{ok:true,confirmed:1,emailsSent:0,emailsWaiting:0};};
  await freeFull.run('markFreeOrderPaid({id:"FREE",total:0},freeButton,freeResult,"https://example.com/")');
  ok(freeFull.context.confirmations.length===1 && freeFull.context.requests[1].details.force===true && !freeFull.elements['pay-dialog']?.open, 'only a real capacity problem adds confirmation to free approval');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exitCode = fails ? 1 : 0;
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
