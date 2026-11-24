// Operations/security regressions from the November audit. Fake Google only; no live writes or emails.
const { run, ctx } = require("./harness.js");
let failures = 0;
const ok = (condition, message) => { console.log((condition ? "PASS " : "FAIL ") + message); if (!condition) failures++; };
const attempt = (code) => { try { return { value: run(code) }; } catch (error) { return { error: error.code, message: error.message }; } };
run(`
function table_() { return {}; }
function withLock_(fn) { return fn(); }
function withIntakeAndScriptLock_(fn) { return fn(); }
function warmCaches_() {}
function getConfig_() { return {password:'test-club',adminPassword:'test-settings',membershipSheetId:'members',membershipFee:12}; }
var originalInsertRow = insertRow_;
function auditEvent() { return {id:'EV',name:'TEST Overnight',slug:'test-overnight',date:'2099-01-01',startTime:'21:00',endTime:'01:00',status:'published',entryOpen:'TRUE',capacity:'',ticketTypes:[{id:'GEN',name:'General',price:10}],questions:[],summary:{}}; }
TBL.Events=[auditEvent()]; TBL.Orders=[]; TBL.Tickets=[]; TBL.Team=[];
`);

ok(run(`new Date(eventEndsAt_({date:'2026-11-24',startTime:'21:00',endTime:'01:00'})).toISOString()`) === '2026-11-25T01:00:00.000Z', 'an event ending after midnight ends on the next calendar date');
ok(run(`new Date(eventEndsAt_({date:'2026-12-31',startTime:'21:00',endTime:'01:00'})).toISOString()`) === '2027-01-01T01:00:00.000Z', 'overnight events cross year boundaries');
ok(run(`new Date(eventEndsAt_({date:'2026-11-24',startTime:'18:00',endTime:'21:00'})).toISOString()`) === '2026-11-24T21:00:00.000Z', 'normal end times keep the event date');
ok(run(`new Date(eventEndsAt_({date:'2026-11-24',startTime:'18:00'})).toISOString()`) === '2026-11-24T18:00:00.000Z', 'missing end times still fall back to the start');
run(`var realNow=Date.now;TBL.Events[0].date='2026-11-24';Date.now=()=>Date.parse('2026-11-25T03:00:00Z');`);
ok(run(`closeFinishedEntries_()===0 && TBL.Events[0].entryOpen==='TRUE'`), 'the hourly close leaves overnight entry open until four hours after the real end');
run(`Date.now=()=>Date.parse('2026-11-25T05:00:00Z');`);
ok(run(`closeFinishedEntries_()===1 && TBL.Events[0].entryOpen==='FALSE'`), 'the hourly close still shuts overnight entry once its grace period ends');
run('Date.now=realNow;TBL.Events[0]=auditEvent();');
for (const value of ['', '2026-02-30', 'not a date']) {
  ok(attempt(`archiveYear_(${JSON.stringify(value)})`).error === 'BAD_REQUEST', 'invalid archive date is refused: ' + JSON.stringify(value));
}
ok(run(`archiveYear_('2026-09-01')`) === '2026-27' && run(`archiveYear_('2026-08-31')`) === '2025-26', 'valid archive dates still choose the school year');
run(`TBL.Events[0].date=''; var archiveWrites=0; var beforeArchiveUpdate=updateRow_; updateRow_=function(){archiveWrites++; return beforeArchiveUpdate.apply(null,arguments);};`);
ok(attempt(`archiveEvent_({name:'TEST Admin'},'EV',true)`).error === 'BAD_REQUEST' && run('archiveWrites') === 0, 'an undated manual archive fails before changing the event or creating sheets');
run(`updateRow_=beforeArchiveUpdate; TBL.Events[0]=auditEvent();
var maxRows=1005, insertedRows=0, deletedRows=0;
var sheet={getLastRow:()=>1005,getMaxRows:()=>maxRows,getRange:()=>({getValues:()=>Array.from({length:1005},(_,i)=>[i?'R'+i:'id'])}),
 insertRowsAfter:(at,count)=>{if(at!==maxRows)throw Error('wrong insertion');maxRows+=count;insertedRows+=count;},
 deleteRows:(start,count)=>{if(maxRows-count<2)throw Error('Cannot delete all non-frozen rows');maxRows-=count;deletedRows+=count;}};
var ids={}; for(var i=1;i<1005;i++)ids['R'+i]=true;
deleteTabRows_({sheet,header:['id']},ids);
`);
ok(run('insertedRows===1 && deletedRows===1004 && maxRows===2'), 'archiving every row of a large tab keeps one writable row below the header');

run(`var backupCalls=[],backupErrors=false,backupResult;
function backupFolder_(){return {};}
function dataSpreadsheet_(){return {getId:()=> 'data'};}
function archiveIds_(){return {'2024-25':'archive-old','2025-26':'archive-new'};}
function copyAndPrune_(id,folder,prefix,day){backupCalls.push({id,prefix});if(backupErrors&&id==='archive-old')throw Error('test unavailable');return {name:prefix+day,kept:4};}
backupResult=backupNow_();
`);
ok(run(`backupCalls.map(x=>x.id).join(',')`) === 'data,members,archive-old,archive-new', 'the existing weekly backup also copies every yearly archive');
ok(run(`backupCalls[2].prefix!==backupCalls[3].prefix && backupResult.name.includes('2024-25')`), 'archive years use distinct retention prefixes');
run('backupCalls=[]; backupErrors=true;');
ok(!!attempt('backupNow_()').message && run(`backupCalls.length===4 && JSON.parse(PropertiesService.getScriptProperties().getProperty('LAST_BACKUP')).ok===false`), 'an archive backup failure is reported while other backup copies are still attempted');

run(`var boolEvent=eventFromRow_({...auditEvent(),entryOpen:true,waitlist:true,mailRegistration:true,mailTickets:false,mailReminders:true});`);
ok(run('boolEvent.entryOpen && boolEvent.waitlist && boolEvent.mailRegistration && !boolEvent.mailTickets && boolEvent.mailReminders'), 'native spreadsheet booleans are read correctly for door, waitlist and email choices');
ok(run(`eventFromRow_({...auditEvent(),mailTickets:''}).mailTickets`), 'never-chosen ticket email settings retain their default');

run(`var scanner={name:'TEST Volunteer',role:'door',sid:'scanner-one'}; var otherScanner={name:'TEST Volunteer',role:'door',sid:'scanner-two'};
SCAN_NOTE_='Private membership lookup details';
noteScanLog_(scanner,'EV','https://member.ucalgarycss.ca/CSS0012345?k=secret-pass',false,{color:'orange',message:'Private help-desk note',person:{name:'TEST Member',id:'T1'}});
noteScanLog_(otherScanner,'EV','TKTABC123',false,{color:'red',message:'Another private note'});
var volunteerLog=scanLog_('EV',scanner).log, deskLog=scanLog_('EV',{role:'exec'}).log;
`);
ok(run(`volunteerLog.length===1 && volunteerLog[0].message==='Go to the help desk.' && !('note' in volunteerLog[0])`), 'volunteers see only their own scans, with desk reasons and lookup notes removed');
ok(run(`deskLog.length===2 && deskLog[1].note==='Private membership lookup details' && deskLog[1].message==='Private help-desk note'`), 'the help desk keeps full diagnostic reasons');
ok(run(`!JSON.stringify(deskLog).includes('secret-pass') && scanLogRaw_('https://events.example/test   spaces',null)==='https://events.example/test spaces'`), 'scan diagnostics preserve lowercase s and whitespace while hiding member pass keys');
run(`TBL.Events[0].entryOpen='FALSE'; TBL.Events.push({...auditEvent(),id:'OTHER'});`);
ok(attempt(`scanLog_('EV',scanner)`).error === 'DOOR_CLOSED', 'an open different event cannot unlock a closed event scan log');

run(`TBL.Events=[auditEvent()]; TBL.Orders=[]; TBL.Tickets=[];
insertRow_=function(table,row){if(table==='Tickets')throw Error('test ticket write failed');return originalInsertRow(table,row);};`);
ok(!!attempt(`walkIn_({name:'TEST Desk'},'EV',{name:'TEST Walk-in',ticketTypeId:'GEN',method:'cash'})`).message && run(`TBL.Orders.length===1 && TBL.Orders[0].status==='cancelled' && TBL.Orders[0].total===0 && TBL.Tickets.length===0`), 'a failed walk-in ticket write leaves no paid orphan or counted revenue');
run(`TBL.Orders=[]; TBL.Tickets=[]; insertRow_=function(table,row){originalInsertRow(table,row);if(table==='Tickets')throw Error('test lost response');};`);
ok(attempt(`walkIn_({name:'TEST Desk'},'EV',{name:'TEST Walk-in',ticketTypeId:'GEN',method:'cash'})`).value?.ok && run(`TBL.Orders.length===1 && TBL.Orders[0].status==='paid' && TBL.Tickets.length===1`), 'a ticket write that succeeded before a timeout keeps its paid order and ticket');
run('insertRow_=originalInsertRow;');

run(`PropertiesService.getScriptProperties().deleteProperty('PEOPLE_LOCKED');`);
for(let index=0;index<30;index++) attempt(`personalLogin_('wrong', 'TEST Random ${index}')`);
ok(attempt(`personalLogin_('wrong','TEST Yet Another')`).error === 'TOO_MANY_TRIES', 'rotating unlisted names cannot reset the club-password guessing limit');
run(`CacheService.getScriptCache().remove('failed_shared_club'); PropertiesService.getScriptProperties().setProperty('PEOPLE_LOCKED','true');`);
ok(attempt(`personalLogin_('wrong','TEST Unlisted')`).error === 'PERSON_NOT_LISTED' && attempt(`personalLogin_('test-club','TEST Unlisted')`).error === 'PERSON_NOT_LISTED', 'a locked list rejects unknown names without disclosing whether a club password matched');
run(`PropertiesService.getScriptProperties().deleteProperty('PEOPLE_LOCKED'); var setupProof=personalLogin_('test-club','TEST Pending Setup').setupToken; signOutAll_({name:'TEST Admin',role:'admin'});`);
ok(attempt(`finishExecSetup_(setupProof,'test-personal')`).error === 'PASSWORD_SETUP_EXPIRED' && run('TBL.Team.length===0'), 'sign everyone out also revokes unfinished password setup before creating an account');
run(`PropertiesService.getScriptProperties().setProperty('SCANNER_PASSWORD','test-door');`);
for(let index=0;index<30;index++) attempt(`loginDoor_('wrong','TEST Door ${index}')`);
ok(attempt(`loginDoor_('wrong','TEST New Door')`).error === 'TOO_MANY_TRIES', 'rotating volunteer names cannot reset the shared door-password guessing limit');
run(`CacheService.getScriptCache().remove('failed_shared_door');
var doorSessionToken=startSession_('TEST Volunteer','door'),execSessionToken=startSession_('TEST Exec','exec');
saveSettings_({name:'TEST Admin',role:'admin'},'',{doorPassword:'test-new-door'});
ROUTE_ACTION_='ping';`);
ok(attempt('requireSession_(doorSessionToken)').error === 'NOT_LOGGED_IN' && attempt('requireSession_(execSessionToken)').value?.role === 'exec', 'changing the door password revokes door sessions while keeping execs signed in');
run(`var freshDoorToken=startSession_('TEST Volunteer','door');saveSettings_({name:'TEST Admin',role:'admin'},'',{clearDoorPassword:true});`);
ok(attempt('requireSession_(freshDoorToken)').error === 'NOT_LOGGED_IN', 'removing a door password also revokes existing door sessions');

run(`TBL.Events=[
  {...auditEvent(),id:'EV1',name:'TEST First',entryOpen:'TRUE',status:'published'},
  {...auditEvent(),id:'EV2',name:'TEST Second',entryOpen:'FALSE',status:'closed'},
  {...auditEvent(),id:'EV3',name:'TEST Draft',entryOpen:'FALSE',status:'draft'},
  {...auditEvent(),id:'EV4',name:'TEST Archived',entryOpen:'FALSE',status:'archived',archivedAt:'2026-10-01T00:00:00Z'}
];`);
const switchedEntry = run(`setEntryOpen_({name:'TEST Desk',role:'exec'},'EV2',true)`);
ok(switchedEntry.ok && switchedEntry.entryOpen === true && switchedEntry.closedEvents.length === 1 && switchedEntry.closedEvents[0].id === 'EV1',
  'opening entry on a second event closes the previously open event under the same lock and reports it');
ok(run(`!isOn_(TBL.Events[0].entryOpen) && isOn_(TBL.Events[1].entryOpen)`),
  'only the newly opened event remains open, including closed-registration events such as Practice');
ok(attempt(`setEntryOpen_({name:'TEST Desk',role:'exec'},'EV3',true)`).error === 'BAD_REQUEST' && run(`isOn_(TBL.Events[1].entryOpen)`),
  'refusing to open entry on a draft leaves the currently open event untouched');
ok(attempt(`setEntryOpen_({name:'TEST Desk',role:'exec'},'EV4',true)`).error === 'ARCHIVED' && run(`isOn_(TBL.Events[1].entryOpen)`),
  'refusing to open entry on an archived event leaves the currently open event untouched');

console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
