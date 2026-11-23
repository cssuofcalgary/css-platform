// Organizer announcements and private attendee comments use different fields. Fake Sheets/mail only.
const assert = require("node:assert/strict");
const { run } = require("./harness.js");
let checks = 0;
function test(name, fn) { fn(); checks++; console.log("PASS " + name); }
run(String.raw`
function withLock_(fn) { return fn(); }
function withIntakeLock_(fn) { return fn(); }
function withIntakeAndScriptLock_(fn) { return fn(); }
function table_() {}
function insertRows_(name, rows) { rows.forEach(function(r) { insertRow_(name,r); }); }
function throttle_() {}
function emailsAfterSave_() { return {sent:0,waiting:0}; }
TBL.Events=[]; TBL.Orders=[]; TBL.Tickets=[]; TBL.Waitlist=[]; TBL.Refunds=[]; TBL.Feedback=[];
var exec = {name:'TEST Exec',role:'exec'};
var event = saveEvent_(exec, {name:'TEST Notes Night',date:'2099-05-05',startTime:'18:00',capacity:30,location:'MSC',announcement:'Bring your UCard.\nDoors open at 6.',ticketTypes:[{id:'G',name:'General',price:0}],questions:[],publish:true}).event;
`);
test("announcement has its own persisted event column", () => assert.equal(run("TBL.Events[0].announcement"), "Bring your UCard.\nDoors open at 6."));
test("public event exposes the current announcement", () => assert.equal(run("publicEvent_(event.slug).event.announcement"), "Bring your UCard.\nDoors open at 6."));
run(`saveEvent_(exec,Object.assign({},event,{announcement:'Hidden draft announcement',saveDraft:true}));`);
test("draft announcement stays private until publication", () => assert.equal(run("publicEvent_(event.slug).event.announcement"), "Bring your UCard.\nDoors open at 6."));
run(`saveEvent_(exec,Object.assign({},event,{announcement:'New public note',publish:true}));`);
test("publishing replaces the announcement", () => assert.equal(run("publicEvent_(event.slug).event.announcement"), "New public note"));
run(`saveEvent_(exec,Object.assign({},event,{announcement:'',publish:true}));`);
test("organizer can clear an announcement", () => assert.equal(run("publicEvent_(event.slug).event.announcement"), ""));
test("announcements are limited to 2000 characters", () => assert.equal(run("cleanEventInput_(Object.assign({},event,{announcement:'a'.repeat(2100)})).announcement.length"), 2000));
test("notes keep line breaks and discard spreadsheet formula prefixes", () => assert.equal(run("registrationNote_(' =SUM(A1)\\r\\nSecond line',1000)"), "SUM(A1)\nSecond line"));
test("notes discard invisible control characters", () => assert.equal(run("registrationNote_('A\\u0000B',1000)"), "AB"));
run(String.raw`
var reply = register_({slug:event.slug,requestId:'notes-registration-0001',people:[
 {name:'TEST Alex',email:'alex@example.com',ucid:'30123456',ticketTypeId:'G',note:'I will arrive late.\nAround 7.'},
 {name:'TEST Jamie',email:'jamie@example.com',ucid:'30123457',ticketTypeId:'G',note:'Please keep us together.'}
]});
`);
test("each attendee gets their own saved comment", () => assert.equal(run("TBL.Tickets[0].note"), "I will arrive late.\nAround 7."));
test("a friend's note is separate from the payer's", () => assert.equal(run("TBL.Tickets[1].note"), "Please keep us together."));
test("attendee comments never overwrite staff order notes", () => assert.equal(run("TBL.Orders[0].notes"), ""));
test("comment remains private from the public event view", () => assert.equal(run("JSON.stringify(publicEvent_(event.slug)).includes('I will arrive late')"), false));
test("staff attendee list exposes the comment", () => assert.equal(run("eventSummary_(event.id,{full:true}).attendees.find(t=>t.name==='TEST Alex').note"), "I will arrive late.\nAround 7."));
test("staff Payments list exposes the comment", () => assert.equal(run("listOrders_(event.id,{filter:'all'}).orders[0].tickets[1].note"), "Please keep us together."));
test("blank comment is optional", () => assert.equal(run("cleanPerson_({name:'TEST Other',email:'other@example.com',ucid:'30123458',ticketTypeId:'G'},event,0).note"), ""));
test("attendee comments are limited to 1000 characters", () => assert.equal(run("cleanPerson_({name:'TEST Other',email:'other@example.com',ucid:'30123458',ticketTypeId:'G',note:'b'.repeat(1100)},event,0).note.length"), 1000));
run(`
TBL.Events[0].capacity=1; TBL.Events[0].waitlist='TRUE';
joinWaitlist_({slug:event.slug,person:{name:'TEST Waiting',email:'wait@example.com',ucid:'30123459',ticketTypeId:'G',note:'Waitlist comment'}});
var waitId=TBL.Waitlist[0].id;
`);
test("waitlist keeps and exposes the attendee note", () => assert.equal(run("listWaitlist_(event.id).entries[0].note"), "Waitlist comment"));
run(`offerWaitlistSpot_(exec,waitId,true,'');`);
test("offering a waitlist spot copies the comment onto the ticket", () => assert.equal(run("TBL.Tickets.find(t=>t.name==='TEST Waiting').note"), "Waitlist comment"));
console.log(checks + " checks passed");
