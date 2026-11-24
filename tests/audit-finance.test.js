// Audit regressions: actual receipts, cumulative refunds, safe restores, verified members and bounded email claims.
const { run } = require('./harness.js');
let fails = 0;
const ok = (condition, label) => { console.log((condition ? 'PASS ' : 'FAIL ') + label); if (!condition) fails++; };
const attempt = code => { try { return { value: run(code) }; } catch (e) { return { error: e.code, message: e.message }; } };
run(`
var S = {name:'TEST Finance',role:'exec'};
function table_() {}
function throttle_() {}
function withLock_(fn) { return fn(); }
var sentTickets=[];
function sendTicketEmail_(event,ticket) { sentTickets.push(ticket.id); return true; }
function event(extra) { return Object.assign({id:'EV',slug:'test',name:'TEST Audit',date:'2099-01-01',startTime:'18:00',endTime:'21:00',capacity:'',capacityRule:'paid',status:'published',entryOpen:'FALSE',waitlist:'FALSE',ticketTypes:[{id:'TG',name:'General',price:10},{id:'TM',name:'Member',price:0,needsMembership:true}],questions:[],archivedAt:'',summary:{}},extra||{}); }
function reset(extra) { TBL.Events=[event(extra)]; TBL.Orders=[]; TBL.Tickets=[]; TBL.Refunds=[]; TBL.Requests=[]; sentTickets=[]; }
function ord(id,status,total,received) { insertRow_('Orders',{id:id,code:'TEST-'+id,eventId:'EV',payerName:'TEST '+id,payerEmail:id.toLowerCase()+'@css.test',status:status,total:total,received:received==null?'':String(received),createdAt:'2026-10-01T00:00:00Z',notes:''}); }
function tk(id,orderId,status,price,extra) { insertRow_('Tickets',Object.assign({id:id,orderId:orderId,eventId:'EV',name:'TEST '+id,email:id.toLowerCase()+'@css.test',ucid:'',memberId:'',status:status,price:price,ticketType:'General',secret:(id+'0'.repeat(32)).slice(0,32),checkedInAt:'',emailedAt:'',answers:{},flag:''},extra||{})); }
function order(id) { return TBL.Orders.find(o=>o.id===id); }
function ticket(id) { return TBL.Tickets.find(t=>t.id===id); }
function rf(id,ticketIds,owed,status,returned) { insertRow_('Refunds',{id:id,orderId:'O',eventId:'EV',ticketIds:ticketIds,owed:owed,status:status,returns:returned?[{amount:returned,method:'cash',date:'2026-10-01'}]:[],reason:''}); }
function snapshot() { return JSON.stringify([TBL.Orders,TBL.Tickets,TBL.Refunds,TBL.Requests]); }
`);
run(`reset();ord('O','paid',20,20);tk('A','O','paid',10);tk('B','O','paid',10);var first=invalidateTickets_(S,{orderId:'O',ticketIds:['A']});recordRefund_(S,{refundId:first.refund.id,amount:10,method:'cash'});invalidateTickets_(S,{orderId:'O',ticketIds:['B']});var restored=restoreOrder_(S,'O',false);`);
ok(run(`restored.restored===1 && restored.status==='paid' && ticket('A').status==='refunded' && ticket('B').status==='paid' && order('O').total===10 && order('O').received==='20'`), 'restoring a later full refund leaves previously returned tickets refunded and recalculates the live total');
ok(run(`TBL.Refunds[0].status==='returned' && TBL.Refunds[1].status==='waived' && availableReceivedCents_(order('O'))===1000`), 'restoration cancels only the untouched ticket refund and preserves the money already returned');
run(`reset();ord('O','paid',20,20);tk('A','O','refunded',10);tk('B','O','refunded',10);rf('R',['A','B'],20,'returned',20);`);
ok(attempt(`restoreOrder_(S,'O',false)`).error === 'BAD_REQUEST', 'paid orders are not eligible for whole-order restore');
run(`order('O').status='refunded';`);
ok(attempt(`restoreOrder_(S,'O',false)`).error === 'BAD_REQUEST' && run(`ticket('A').status==='refunded'`), 'a fully returned refund cannot resurrect paid tickets');
run(`reset();ord('O','awaiting',20,10);tk('A','O','awaiting',20);markOrderPaid_(S,'O',false,'');`);
ok(run(`order('O').received==='20' && order('O').status==='paid'`), 'manual Mark paid records that the remaining balance arrived');
ok(attempt(`invalidateTickets_(S,{orderId:'O',ticketIds:['A'],refundAmount:20})`).value?.refund.owed === 20, 'the completed payment can later be refunded in full');
run(`reset();ord('O','awaiting',20,25);tk('A','O','awaiting',20);markOrderPaid_(S,'O',false,'');`);
ok(run(`order('O').received==='25'`), 'manual Mark paid preserves a recorded overpayment');
run(`reset();ord('O','awaiting',20,0);tk('A','O','awaiting',20);applyTransfer_(S,{orderIds:['O'],amount:15,short:'accept'});`);
ok(run(`order('O').status==='paid' && order('O').received==='15'`), 'accepting a short transfer preserves the actual amount instead of inventing the missing money');
run(`reset();ord('O','paid',20,20);tk('A','O','paid',10);tk('B','O','paid',10);invalidateTickets_(S,{orderId:'O',ticketIds:['A'],refundAmount:12});var before=snapshot();`);
ok(attempt(`invalidateTickets_(S,{orderId:'O',ticketIds:['B'],refundAmount:12})`).error === 'BAD_REQUEST' && run(`snapshot()===before`), 'cumulative refund cap rejects a second refund that spends already reserved money without changing data');
run(`reset();ord('O','paid',10,10);tk('A','O','paid',10);rf('OLD',[],4,'waived',4);var before=snapshot();`);
ok(attempt(`invalidateTickets_(S,{orderId:'O',ticketIds:['A'],refundAmount:7})`).error === 'BAD_REQUEST' && run(`snapshot()===before`), 'money already returned still counts after the remainder of that refund was cancelled');
run(`reset();ord('O','paid',10,20);tk('A','O','refunded',10);tk('B','O','paid',10);rf('PARTIAL',['A'],10,'waived',5);var before=snapshot();`);
ok(attempt(`restoreTickets_(S,{orderId:'O',ticketIds:['A']})`).error === 'BAD_REQUEST' && run(`snapshot()===before`), 'cancelling the remainder of a partially returned refund never makes its ticket restorable');
run(`reset();ord('O','awaiting',20);tk('A','O','awaiting',10);tk('B','O','awaiting',10);invalidateTickets_(S,{orderId:'O',ticketIds:['B']});markOrderPaid_(S,'O',false,'');restoreTickets_(S,{orderId:'O',ticketIds:['B']});`);
ok(run(`order('O').status==='awaiting' && order('O').total===20 && order('O').received==='10' && ticket('A').status==='paid' && ticket('B').status==='awaiting'`), 'restoring an unpaid sibling on a paid order keeps the old receipt and requires the extra payment');
run(`reset({capacity:4});ord('O','refunded',10,10);tk('A','O','refunded',10);rf('R',['A'],10,'owed');for(var i=0;i<4;i++){ord('X'+i,'paid',10,10);tk('X'+i,'X'+i,'paid',10);}var before=snapshot();`);
ok(attempt(`restoreOrder_(S,'O',false)`).error === 'OVER_CAPACITY' && run(`snapshot()===before`), 'undoing a refund cannot use the 125% waiting allowance to oversell paid capacity');
ok(attempt(`restoreOrder_(S,'O',true)`).value?.status === 'paid', 'Finance can explicitly override a restore capacity warning');
run(`reset();ord('O','cancelled',10);tk('A','O','cancelled',10,{ucid:'30112233'});ord('X','paid',10,10);tk('X','X','paid',10,{ucid:'30112233'});var before=snapshot();`);
ok(attempt(`restoreOrder_(S,'O',true)`).error === 'ALREADY_REGISTERED' && run(`snapshot()===before`), 'capacity override never overrides a duplicate attendee registration');
run(`reset({capacity:4});ord('O','paid',10,20);tk('A','O','paid',10);tk('B','O','refunded',10);rf('R',['B'],10,'owed');for(var i=0;i<3;i++){ord('X'+i,'paid',10,10);tk('X'+i,'X'+i,'paid',10);}var before=snapshot();`);
ok(attempt(`restoreTickets_(S,{orderId:'O',ticketIds:['B']})`).error === 'OVER_CAPACITY' && run(`snapshot()===before`), 'restoring individual refunded tickets also enforces the paid capacity limit');
run(`reset();ord('O','cancelled',10);tk('A','O','cancelled',10);var before=snapshot();`);
ok(attempt(`applyTransfer_(S,{orderIds:['O'],amount:15,late:'restore'})`).error === 'BAD_REQUEST' && run(`snapshot()===before`), 'late overpayment without an explicit choice leaves the cancelled order and tickets unchanged');
ok(attempt(`applyTransfer_(S,{orderIds:['O'],amount:5,late:'restore'})`).error === 'BAD_REQUEST' && run(`snapshot()===before`), 'late short payment without an explicit choice also makes no restore');
run(`reset({capacity:4});ord('O','cancelled',10);tk('A','O','cancelled',10);for(var i=0;i<4;i++){ord('X'+i,'paid',10,10);tk('X'+i,'X'+i,'paid',10);}var before=snapshot();`);
ok(attempt(`applyTransfer_(S,{orderIds:['O'],amount:10,late:'restore'})`).error === 'OVER_CAPACITY' && run(`snapshot()===before`), 'a late transfer rejected for paid capacity changes no cancelled records');
run(`reset();ord('O','cancelled',10);tk('A','O','cancelled',10);var paid=applyTransfer_(S,{orderIds:['O'],amount:10,late:'restore',requestId:'audit-late-1'});var before=snapshot();var repeated=applyTransfer_(S,{orderIds:['O'],amount:10,late:'restore',requestId:'audit-late-1'});`);
ok(run(`order('O').status==='paid' && order('O').received==='10' && ticket('A').status==='paid' && snapshot()===before && paid.confirmed===repeated.confirmed`), 'a successful late restore and payment is durable and repeating the same press adds no payment or ticket');
run(`reset({capacity:4});ord('O','cancelled',10);tk('A','O','cancelled',10);var originalUpdate=updateRow_;var failOrder=true;updateRow_=function(table,id,change){if(table==='Orders' && id==='O' && failOrder){failOrder=false;throw new Error('TEST interrupted late payment');}return originalUpdate(table,id,change);};`);
ok(/interrupted/.test(attempt(`applyTransfer_(S,{orderIds:['O'],amount:10,late:'restore',requestId:'audit-interrupted-late'})`).message || ''), 'an interrupted late restore retains a durable plan for retry');
run(`updateRow_=originalUpdate;for(var i=0;i<4;i++){ord('X'+i,'paid',10,10);tk('X'+i,'X'+i,'paid',10);}var before=snapshot();`);
ok(attempt(`applyTransfer_(S,{orderIds:['O'],amount:10,late:'restore',requestId:'audit-interrupted-late'})`).error === 'OVER_CAPACITY' && run(`snapshot()===before`), 'retrying an interrupted late payment rechecks capacity before finishing any remaining writes');
run(`TBL.Tickets=TBL.Tickets.filter(t=>t.orderId==='O');TBL.Orders=TBL.Orders.filter(o=>o.id==='O');var retry=applyTransfer_(S,{orderIds:['O'],amount:10,late:'restore',requestId:'audit-interrupted-late'});`);
ok(run(`retry.ok && order('O').received==='10' && ticket('A').status==='paid'`), 'once room is available, the original late-payment retry finishes with the receipt counted once');
run(`reset();ord('O','awaiting',20,5);tk('A','O','awaiting',20);ord('P','paid',20,15);tk('P','P','paid',20);var summary=eventSummary_('EV',{});var listing=listOrders_('EV',{filter:'all'});`);
ok(run(`summary.money.received===20 && summary.money.awaiting===15 && listing.money.received===20 && listing.money.awaiting===15`), 'Payments and event summaries include part-payments and actual accepted short payments');
run(`reset();TBL.__members=[{memberId:'CSS001',name:'TEST Member',email:'member@css.test',ucid:'30112233',paid:true}];var plan=prepareRegistration_([{name:'TEST Borrower',email:'borrower@css.test',ucid:'30999999',ticketTypeId:'TM',answers:{}}],event(),TBL.__members,TBL.__members[0]);`);
ok(run(`plan.everyone[0].name==='TEST Member' && plan.everyone[0].email==='member@css.test' && plan.everyone[0].ucid==='30112233' && plan.everyone[0].flag===''`), 'verified member pricing always uses the member on file rather than a submitted friend identity');
ok(run(`namesRelated_('---','TEST Member')===false && namesRelated_('TEST Member','...')===false && namesRelated_('Test Member','Member Test')===true`), 'punctuation-only names never satisfy membership name matching');
run(`reset();ord('O','paid',10,10);tk('A','O','paid',10);var before=snapshot();`);
ok(attempt(`updateTicket_(S,'A',{email:''},'')`).error === 'BAD_REQUEST' && run(`snapshot()===before`), 'clearing a paid ticket email is rejected without changing the ticket or triggering mail');
run(`reset();ord('O','paid',30,30);for(var i=0;i<3;i++)tk('T'+i,'O','paid',10);MailApp.getRemainingDailyQuota=()=>1;var result=sendPendingTicketEmails_('O');`);
ok(run(`result.sent===1 && result.waiting===2 && sentTickets.length===1 && TBL.Tickets.filter(t=>freshClaim_(t)).length===0`), 'ticket email claims stop at the remaining Gmail allowance and leave the others waiting');
run(`reset();ord('O','paid',20,20);tk('A','O','paid',10,{emailedAt:'claim:'+new Date().toISOString()});tk('B','O','paid',10);MailApp.getRemainingDailyQuota=()=>1;var result=sendPendingTicketEmails_('O');`);
ok(run(`result.sent===0 && sentTickets.length===0 && ticket('B').emailedAt===''`), 'an email already claimed by another run reserves that remaining allowance');
run(`reset();ord('O','paid',10,10);tk('A','O','paid',10,{email:''});MailApp.getRemainingDailyQuota=()=>0;var result=sendPendingTicketEmails_('O');`);
ok(run(`result.sent===0 && result.waiting===0 && result.notEmailed===1 && ticket('A').emailedAt==='no email address'`), 'a walk-in without an email is marked handled instead of repeatedly attempting a blank recipient');
console.log(fails ? fails+' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
