// Pasted rosters, a locked list, first-time passwords, admin resets and session revocation. Offline only.
const { run } = require("./harness.js");
let fails = 0;
const ok = (value, message) => { console.log((value ? "PASS " : "FAIL ") + message); if (!value) fails++; };
const attempt = (code) => { try { return { value: run(code) }; } catch (e) { return { error: e.code, message: e.message }; } };
run(`
var __logs = [], __held = false;
function log_(who, action, target, details) { __logs.push({ who, action, target, details }); }
function withLock_(fn) { if (__held) throw new Error("nested lock"); __held = true; try { return fn(); } finally { __held = false; } }
function getConfig_() { return { password: "club-test", adminPassword: "settings-test", membershipFee: 12 }; }
function warmCaches_() {}
function table_() { return {}; }
function headerFor_() { return []; }
function deleteTabRows_(tab, ids) { TBL.Team = TBL.Team.filter((p) => !ids[p.id]); }
var __adminToken = startSession_("TEST Admin", "admin"), __execToken = startSession_("TEST Exec", "exec");
var __admin = requireAdmin_(__adminToken);
`);
const route = (action, details = {}, admin = true) => run(`route_(Object.assign(${JSON.stringify({ action, ...details })}, { token: ${admin ? "__adminToken" : "__execToken"} }))`);
for (const action of ["previewPeopleImport", "importPeople", "resetPersonPassword"]) {
  ok(attempt(`route_({ action: "${action}" })`).error === "NOT_LOGGED_IN", `${action}: signed-out requests denied`);
  ok(attempt(`route_({ action: "${action}", token: __execToken })`).error === "ADMIN_ONLY", `${action}: normal execs denied`);
}
let preview = route("previewPeopleImport", { text: "Name,Department\nKevin B,events\nMarcus\tInternal\nkevin   b,Finance" });
ok(preview.added === 2 && preview.skipped === 1 && run("taskTeam_().length") === 0, "preview checks pasted CSV / spreadsheet tabs without adding anyone");
ok(preview.rows[0].department === "Events" && preview.rows[1].name === "Marcus", "departments ignore capitalization and names retain their spelling");
let imported = route("importPeople", { text: "Kevin B, Events\nMarcus,Internal\nkevin b,Finance" });
ok(imported.added === 2 && imported.skipped === 1, "bulk import adds each name once");
ok(route("importPeople", { text: "KEVIN B,Finance\nMarcus" }).added === 0 && run("taskTeam_().length") === 2, "repeated imports never duplicate or replace people");
ok(run("taskTeamByName_('Kevin B').department") === "Events", "existing departments survive a repeated import");
ok(attempt(`importPeople_(__admin, "New Name,Events\\nBad Name,Accounting")`).error === "BAD_REQUEST" && run("!taskTeamByName_('New Name')"), "one invalid department prevents all rows being added");
ok(attempt(`previewPeopleImport_("${"X".repeat(61)}")`).error === "BAD_REQUEST", "long names are rejected rather than silently merged");
ok(attempt(`previewPeopleImport_(Array(202).join('Name\\n'))`).error === "BAD_REQUEST", "an oversized pasted roster is refused");
ok(attempt(`previewPeopleImport_("Name,Dept,Other")`).error === "BAD_REQUEST", "extra columns are refused");
ok(run(`previewPeopleImport_('"Last, First",Events').rows[0].name`) === "Last, First", "quoted names may contain commas");
ok(run(`previewPeopleImport_('__proto__\\n__proto__').added`) === 1, "unusual names still deduplicate safely");

route("saveSettings", { settings: { peopleLocked: true } });
ok(route("getSettings").settings.peopleLocked === true, "the list lock saves and is returned in Settings");
ok(!!attempt(`route_({action:'saveSettings',token:__execToken,settings:{peopleLocked:false}})`).error && run('peopleLocked_()'), "an unlisted old exec session cannot unlock the list");
ok(attempt(`saveSettings_(__admin, __adminToken, {peopleLocked:'false'})`).error === "BAD_REQUEST", "a string cannot accidentally unlock the list");
ok(attempt(`personalLogin_('club-test','Unlisted')`).error === "PERSON_NOT_LISTED", "a locked list blocks unlisted first-time sign-in");
run(`teamAddOnSignIn_('Unlisted'); taskAddOwner_({name:'TEST Exec'}, 'Unlisted Task Owner', 'Events');`);
ok(run("!taskTeamByName_('Unlisted') && !taskTeamByName_('Unlisted Task Owner')"), "automatic sign-in and task-owner additions also respect the lock");
ok(route("importPeople", { text: "New Listed,Finance" }).added === 1, "admins can deliberately bulk-add people while locked");
ok(run(`personalLogin_('settings-test','Emergency Admin').role`) === "admin", "the settings password remains an admin recovery sign-in");
ok(attempt(`personalLogin_('wrong','Kevin B')`).error === "WRONG_PASSWORD", "first-time setup requires the club password");
const setup = run(`personalLogin_('club-test','kevin b')`);
ok(setup.needsPasswordSetup && setup.setupToken && !setup.token && setup.name === "Kevin B", "the club password opens password setup, without granting a portal session");
ok(attempt(`requireSession_('${setup.setupToken}')`).error === "NOT_LOGGED_IN", "the setup token cannot access the portal");
ok(attempt(`finishExecSetup_('${setup.setupToken}','short')`).error === "BAD_REQUEST", "short personal passwords are refused");
ok(attempt(`finishExecSetup_('${setup.setupToken}','${"界".repeat(25)}')`).error === "BAD_REQUEST", "passwords that exceed bcrypt's UTF-8 limit are refused");
const configured = run(`finishExecSetup_('${setup.setupToken}','private-pass-1')`);
ok(configured.ok && configured.role === "exec" && configured.token, "saving the new password signs the exec in");
ok(run(`requireSession_('${configured.token}').name`) === "Kevin B", "a personal session can access signed-in actions");
ok(attempt(`route_({action:'saveSettings',token:'${configured.token}',settings:{peopleLocked:false}})`).error === "ADMIN_ONLY", "a signed-in listed exec cannot change the list lock");
ok(run(`/^\\$2[aby]\\$12\\$/.test(taskTeamByName_('Kevin B').passwordHash)`), "the sheet stores a bcrypt hash at cost 12");
ok(run(`JSON.stringify(taskTeam_()).indexOf('passwordHash') < 0 && JSON.stringify(__logs).indexOf('private-pass-1') < 0`), "People replies and Activity never expose passwords or hashes");
ok(run(`taskTeam_().find(p => p.name === 'Kevin B').passwordSet`) === true, "admins see only whether a password has been set");
ok(attempt(`finishExecSetup_('${setup.setupToken}','other-pass')`).error === "PASSWORD_SETUP_EXPIRED", "a used setup token cannot change the password again");
ok(attempt(`personalLogin_('club-test','Kevin B')`).error === "WRONG_PASSWORD", "the club password cannot bypass an existing personal password");
ok(attempt(`personalLogin_('wrong-pass','Kevin B')`).error === "WRONG_PASSWORD", "a wrong personal password is refused");
const secondSession = run(`personalLogin_('private-pass-1','KEVIN B')`);
ok(secondSession.token && secondSession.name === "Kevin B", "subsequent sign-ins use the personal password and canonical name");
const id = run(`taskTeamByName_('Kevin B').id`);
run(`CacheService.getScriptCache().put(loginFailKey_('Kevin B'), '30', 600)`);
route("resetPersonPassword", { id });
ok(run(`!CacheService.getScriptCache().get(loginFailKey_('Kevin B'))`), "reset clears the failed-attempt pause so password recovery works immediately");
ok(attempt(`requireSession_('${configured.token}')`).error === "NOT_LOGGED_IN" && attempt(`requireSession_('${secondSession.token}')`).error === "NOT_LOGGED_IN", "an admin reset immediately invalidates every personal session");
ok(attempt(`personalLogin_('private-pass-1','Kevin B')`).error === "WRONG_PASSWORD", "the previous password stops working after a reset");
const resetSetup = run(`personalLogin_('club-test','Kevin B')`);
ok(resetSetup.needsPasswordSetup && !resetSetup.token, "after reset, the club password opens setup again");
route("resetPersonPassword", { id });
ok(attempt(`finishExecSetup_('${resetSetup.setupToken}','private-pass-2')`).error === "PASSWORD_SETUP_EXPIRED", "reset also invalidates outstanding setup tokens");
const newSetup = run(`personalLogin_('club-test','Kevin B')`);
const newSession = run(`finishExecSetup_('${newSetup.setupToken}','private-pass-2')`);
ok(newSession.token && run(`personalLogin_('private-pass-2','Kevin B').ok`), "the exec can choose a replacement password");
run(`updateRow_('Team','${id}',{active:false})`);
ok(attempt(`requireSession_('${newSession.token}')`).error === "NOT_LOGGED_IN" && attempt(`personalLogin_('private-pass-2','Kevin B')`).error === "WRONG_PASSWORD", "deactivation blocks existing sessions and new sign-ins");
run(`updateRow_('Team','${id}',{active:true})`);
route("saveSettings", { settings: { peopleLocked: false } });
const newPersonSetup = run(`personalLogin_('club-test','Brand New Person')`);
route("saveSettings", { settings: { peopleLocked: true } });
ok(attempt(`finishExecSetup_('${newPersonSetup.setupToken}','private-pass-3')`).error === "PERSON_NOT_LISTED" && run(`!taskTeamByName_('Brand New Person')`), "locking the list during setup still blocks registration");
route("saveSettings", { settings: { peopleLocked: false } });
const newPerson = run(`finishExecSetup_('${newPersonSetup.setupToken}','private-pass-3')`);
ok(newPerson.token && run("taskTeam_().filter(p => p.name === 'Brand New Person').length") === 1, "an unlocked list permits invited registration without duplicate people");
const newPersonId = run("taskTeamByName_('Brand New Person').id");
route("removePerson", { id: newPersonId });
ok(attempt(`requireSession_('${newPerson.token}')`).error === "NOT_LOGGED_IN", "removing a person also invalidates their personal session");
for (let i = 0; i < 30; i++) attempt(`personalLogin_('bad','Locked Test')`);
ok(attempt(`personalLogin_('club-test','Locked Test')`).error === "TOO_MANY_TRIES", "too many wrong attempts temporarily block that name");
ok(run(`personalLogin_('private-pass-2','Kevin B').ok`), "another person's failed attempts do not block a working account");
ok(run("__held") === false, "all locks are released");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
