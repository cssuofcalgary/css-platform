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
ok(attempt(`route_({action:'login',password:'settings-test',name:'Emergency Admin'})`).error === "WRONG_PASSWORD", "the settings password cannot sign in or bypass a locked roster");
ok(attempt(`route_({action:'unlockSettings',password:'settings-test'})`).error === "NOT_LOGGED_IN", "settings cannot unlock before signing in");
ok(attempt(`personalLogin_('wrong','Kevin B')`).error === "WRONG_PASSWORD", "first-time setup requires the club password");
const setup = run(`personalLogin_('club-test','kevin b')`);
ok(setup.needsPasswordSetup && setup.setupToken && !setup.token && setup.name === "Kevin B", "the club password opens password setup, without granting a portal session");
ok(attempt(`requireSession_('${setup.setupToken}')`).error === "NOT_LOGGED_IN", "the setup token cannot access the portal");
ok(attempt(`finishExecSetup_('${setup.setupToken}','')`).error === "BAD_REQUEST", "an empty personal password is refused");
const configured = run(`finishExecSetup_('${setup.setupToken}','private-pass-1')`);
ok(configured.ok && configured.role === "exec" && configured.token, "saving the new password signs the exec in");
ok(run(`requireSession_('${configured.token}').name`) === "Kevin B", "a personal session can access signed-in actions");
ok(attempt(`route_({action:'saveSettings',token:'${configured.token}',settings:{peopleLocked:false}})`).error === "ADMIN_ONLY", "a signed-in listed exec cannot change the list lock");
ok(run(`/^\\$bcrypt-sha256\\$v=2,t=2b,r=12\\$/.test(taskTeamByName_('Kevin B').passwordHash)`), "the sheet stores a versioned bcrypt-sha256 hash at cost 12");
ok(run(`JSON.stringify(taskTeam_()).indexOf('passwordHash') < 0 && JSON.stringify(__logs).indexOf('private-pass-1') < 0`), "People replies and Activity never expose passwords or hashes");
ok(run(`taskTeam_().find(p => p.name === 'Kevin B').passwordSet`) === true, "admins see only whether a password has been set");
ok(attempt(`finishExecSetup_('${setup.setupToken}','other-pass')`).error === "PASSWORD_SETUP_EXPIRED", "a used setup token cannot change the password again");
ok(attempt(`personalLogin_('club-test','Kevin B')`).error === "WRONG_PASSWORD", "the club password cannot bypass an existing personal password");
ok(attempt(`personalLogin_('wrong-pass','Kevin B')`).error === "WRONG_PASSWORD", "a wrong personal password is refused");
const secondSession = run(`personalLogin_('private-pass-1','KEVIN B')`);
ok(secondSession.token && secondSession.name === "Kevin B", "subsequent sign-ins use the personal password and canonical name");
ok(attempt(`route_({action:'unlockSettings',token:'${secondSession.token}',password:'wrong'})`).error === "WRONG_PASSWORD", "a wrong settings password does not unlock settings");
ok(run(`requireSession_('${secondSession.token}').role`) === "exec", "a failed unlock leaves the normal sign-in intact");
const unlocked = run(`route_({action:'unlockSettings',token:'${secondSession.token}',password:'settings-test',name:'Someone Else'})`);
ok(unlocked.role === "admin" && unlocked.name === "Kevin B" && run(`requireAdmin_('${unlocked.token}').personId`) === run(`taskTeamByName_('Kevin B').id`), "unlocking Settings preserves the signed-in person's identity and account version");
const id = run(`taskTeamByName_('Kevin B').id`);
run(`CacheService.getScriptCache().put(loginFailKey_('Kevin B'), '30', 600)`);
route("resetPersonPassword", { id });
ok(run(`!CacheService.getScriptCache().get(loginFailKey_('Kevin B'))`), "reset clears the failed-attempt pause so password recovery works immediately");
ok(attempt(`requireSession_('${configured.token}')`).error === "NOT_LOGGED_IN" && attempt(`requireSession_('${secondSession.token}')`).error === "NOT_LOGGED_IN", "an admin reset immediately invalidates every personal session");
ok(attempt(`requireAdmin_('${unlocked.token}')`).error === "NOT_LOGGED_IN", "reset also invalidates that person's unlocked Settings session");
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

// Personal passwords have no minimum or maximum character count. No long-password truncation.
ok(run(`verifyExecPassword_('password', '$bcrypt-sha256$v=2,t=2b,r=12$n79VH.0Q2TMWmt3Oqt9uku$Kq4Noyk3094Y2QlB8NdRT8SvGiI4ft2')`), "password hashing matches the published Passlib v2 test vector");
const shortSetup = run(`personalLogin_('club-test','Short Password Test')`);
ok(run(`finishExecSetup_('${shortSetup.setupToken}','x').ok && personalLogin_('x','Short Password Test').ok`), "a one-character password can be set and used to sign in");
const longSetup = run(`personalLogin_('club-test','Long Password Test')`);
const longPassword = '界'.repeat(100) + '😀'.repeat(50) + ' ending';
ok(run(`finishExecSetup_('${longSetup.setupToken}',${JSON.stringify(longPassword)}).ok && personalLogin_(${JSON.stringify(longPassword)},'Long Password Test').ok`), "long Unicode passwords can be set and used to sign in");
ok(attempt(`personalLogin_(${JSON.stringify(longPassword + ' changed')},'Long Password Test')`).error === "WRONG_PASSWORD", "characters beyond bcrypt's old 72-byte boundary still count");
ok(run(`verifyExecPassword_('old-test-password', execPasswordLibrary_().hashSync('old-test-password', 12))`), "passwords created before this update still work");
for (const password of ["club-test", "settings-test"]) {
  const name = "Matching " + password;
  const proof = run(`personalLogin_('club-test',${JSON.stringify(name)})`);
  const saved = run(`finishExecSetup_('${proof.setupToken}',${JSON.stringify(password)})`);
  ok(saved.role === "exec" && run(`personalLogin_(${JSON.stringify(password)},${JSON.stringify(name)}).role`) === "exec", "a personal password matching a shared password is accepted and only signs in as an exec");
}
const settingsAccount = run(`taskTeamByName_('Matching settings-test')`);
const settingsLogin = run(`personalLogin_('settings-test','Matching settings-test')`);
const settingsUnlock = run(`route_({action:'unlockSettings',token:'${settingsLogin.token}',password:'settings-test'})`);
const afterSignOut = run(`signOutAll_(requireAdmin_('${settingsUnlock.token}'))`);
ok(run(`requireAdmin_('${afterSignOut.token}').personId`) === settingsAccount.id, "signing everyone out keeps the admin's replacement session linked to their account");
const afterPasswordChange = run(`saveSettings_(requireAdmin_('${afterSignOut.token}'),'${afterSignOut.token}',{adminPassword:'replacement-settings-test'})`);
ok(run(`requireAdmin_('${afterPasswordChange.token}').personId`) === settingsAccount.id, "changing a shared password also preserves the admin account link");
run(`resetPersonPassword_({name:'TEST Admin'},'${settingsAccount.id}')`);
ok(attempt(`requireAdmin_('${afterPasswordChange.token}')`).error === "NOT_LOGGED_IN", "a later personal reset revokes replacement admin sessions too");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
