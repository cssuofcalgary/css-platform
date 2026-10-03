const { sent, run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const J = (code) => { try { return { v: run(code) }; } catch (e) { return { err: e.code || e.message, msg: e.message }; } };
const S = { name: "Sponsorship exec" };

run(`
TBL.Partners = []; TBL.Orders = []; TBL.Tickets = [];
function table_(name) { return { name: name }; }
function headerFor_() { return []; }
function bumpTableVersion_() {}
function deleteTabRows_(tab, ids) { TBL[tab.sheet.name] = TBL[tab.sheet.name].filter(function (r) { return !ids[String(r.id)]; }); }
TBL.__members = [{ memberId: "CSS0011234", name: "Mem Ber", email: "m@x.ca", ucid: "1", paid: true, row: 2 }, { memberId: "CSS0022222", name: "Unpaid U", email: "u@x.ca", ucid: "2", paid: false, row: 3 }];
`);

let r = J(`listPartners_()`);
ok(r.v && r.v.partners.length === 7, "starter list of 7 partners is put in on first read");
ok(r.v.partners[0].name.indexOf("Sweet Together") !== -1 && r.v.partners[0].offer === "15% OFF" && /328 Centre St S/.test(r.v.partners[0].address), "first partner copied correctly");
ok(r.v.partners.every((p) => p.active), "all start switched on");
ok(J(`listPartners_()`).v.partners.length === 7, "reading again does not add them twice");

r = J(`savePartner_(${JSON.stringify(S)}, { name: "New Cafe", offer: "Free drink", address: "1 Main St", active: true })`);
ok(r.v && r.v.ok && J(`listPartners_()`).v.partners.length === 8, "add a partner");
const id = r.v.partner.id;
r = J(`savePartner_(${JSON.stringify(S)}, { id: "${id}", name: "New Cafe", offer: "Free drink", address: "1 Main St", active: false })`);
ok(r.v && r.v.partner.active === false, "switch a partner off");
ok(J(`savePartner_(${JSON.stringify(S)}, { name: "", offer: "x" })`).err === "BAD_REQUEST", "name required");
ok(J(`savePartner_(${JSON.stringify(S)}, { name: "x", offer: "" })`).err === "BAD_REQUEST", "offer required");
r = J(`savePartner_(${JSON.stringify(S)}, { name: "=cmd|evil", offer: "+1 free", address: "@home", active: true })`);
ok(r.v && !/^[=+\-@]/.test(r.v.partner.name + r.v.partner.offer + r.v.partner.address), "formula characters are stripped: " + JSON.stringify(r.v && r.v.partner));

// members
const k = run(`linkKey_("pass", "CSS0011234")`);
r = J(`memberPartners_({ memberId: "CSS0011234", k: "${k}" })`);
ok(r.v && r.v.ok && r.v.partners.length === 8 && r.v.partners.every((p) => p.name !== "New Cafe"), "a member with a valid pass link sees the ACTIVE partners only (" + (r.v && r.v.partners.length) + ")");
ok(J(`memberPartners_({ memberId: "CSS0011234", k: "wrong" })`).err === "NOT_FOUND", "wrong key: not found");
ok(J(`memberPartners_({ memberId: "CSS0011234" })`).err === "NOT_FOUND", "no key: not found");
const k2 = run(`linkKey_("pass", "CSS0022222")`);
ok(J(`memberPartners_({ memberId: "CSS0022222", k: "${k2}" })`).err === "NOT_FOUND", "unpaid member: not found");

// ---- redemptions
run("TBL.Redemptions = [];");
const kk = run('linkKey_("pass", "CSS0011234")');
const first = run('listPartners_().partners[0].name');
r = J('memberRedeem_({ memberId: "CSS0011234", k: "' + kk + '", partner: ' + JSON.stringify(first) + ', rid: "abc-12345678" })');
ok(r.v && r.v.ok && r.v.already === false && run('TBL.Redemptions.length') === 1, 'a redemption is logged');
const row = run('TBL.Redemptions[0]');
ok(row.memberId === 'CSS0011234' && row.memberName === 'Mem Ber' && row.partnerName === first && row.offer === '15% OFF', 'the log row has member, partner and offer');
r = J('memberRedeem_({ memberId: "CSS0011234", k: "' + kk + '", partner: ' + JSON.stringify(first) + ', rid: "abc-12345678" })');
ok(r.v && r.v.already === true && run('TBL.Redemptions.length') === 1, 'sending the same redemption twice (a retry) counts once');
const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
J('memberRedeem_({ memberId: "CSS0011234", k: "' + kk + '", partner: ' + JSON.stringify(first) + ', rid: "def-12345678", at: "' + old + '" })');
ok(run('TBL.Redemptions[1].time') === old, 'a plausible phone time (saved while offline) is kept');
J('memberRedeem_({ memberId: "CSS0011234", k: "' + kk + '", partner: ' + JSON.stringify(first) + ', rid: "ghi-12345678", at: "2001-01-01T00:00:00Z" })');
ok(Date.now() - new Date(run('TBL.Redemptions[2].time')).getTime() < 60000, 'an absurd phone time is replaced by the real time');
ok(J('memberRedeem_({ memberId: "CSS0011234", k: "bad", partner: ' + JSON.stringify(first) + ' })').err === 'NOT_FOUND', 'redeeming needs a valid pass key');
ok(J('memberRedeem_({ memberId: "CSS0022222", k: "' + k2 + '", partner: ' + JSON.stringify(first) + ' })').err === 'NOT_FOUND', 'an unpaid member cannot redeem');
ok(J('memberRedeem_({ memberId: "CSS0011234", k: "' + kk + '", partner: "Not A Partner" })').err === 'BAD_REQUEST', 'unknown partner refused');
const lr = J('listRedemptions_({ limit: 2 })').v;
ok(lr.total === 3 && lr.redemptions.length === 2 && lr.byPartner[first] === 3, 'exec list: newest first, page size, counts per partner');
ok(J('listRedemptions_({ full: true })').v.redemptions.length === 3, 'full list for the CSV');

// Pagination, member isolation and removal through the protected API route.
run(`TBL.Redemptions = Array.from({ length: 23 }, function (_, i) {
  return { id: "RDtest" + String(i).padStart(2, "0"), time: new Date(2026, 0, i + 1).toISOString(),
    memberId: i % 2 ? "CSS0022222" : "CSS0011234", memberName: "TEST Member", partnerName: "TEST Cafe", offer: "10%" };
});
var redemptionAudit = [];
function log_(who, action, target, details) { redemptionAudit.push({ who: who, action: action, target: target, details: details }); }
CacheService.getScriptCache().put("session_test-exec", JSON.stringify({name:"TEST Exec",role:"exec",epoch:currentEpoch_()}));
CacheService.getScriptCache().put("session_test-admin", JSON.stringify({name:"TEST Settings",role:"admin",epoch:currentEpoch_()}));`);
const page1 = J('listRedemptions_({ limit: 10 })').v;
const page2 = J('listRedemptions_({ limit: 10, offset: 10 })').v;
const page3 = J('listRedemptions_({ limit: 10, offset: 20 })').v;
ok(page1.redemptions.length === 10 && page2.redemptions.length === 10 && page3.redemptions.length === 3 &&
  new Set([...page1.redemptions, ...page2.redemptions, ...page3.redemptions].map(x => x.id)).size === 23,
  '10 per page, no missing or repeated redemption IDs');
const memberRows = J('listRedemptions_({ memberId: "css0011234", limit: 10 })').v;
ok(memberRows.total === 12 && memberRows.redemptions.every(x => x.memberId === 'CSS0011234'), 'member history only includes that member');
ok(J('route_({action:"deleteRedemption",redemptionId:"RDtest22"})').err === 'NOT_LOGGED_IN', 'removal needs sign-in');
ok(J('route_({action:"deleteRedemption",token:"test-exec",redemptionId:"RDtest22"})').err === 'ADMIN_ONLY', 'normal exec cannot remove a redemption');
ok(run('TBL.Redemptions.length') === 23, 'refused removals leave records untouched');
r = J('route_({action:"deleteRedemption",token:"test-admin",redemptionId:"RDtest22"})');
ok(r.v && r.v.ok && run('TBL.Redemptions.length') === 22, 'settings access removes only the selected redemption');
ok(J('listRedemptions_({ full:true })').v.byPartner['TEST Cafe'] === 22 &&
  J('listRedemptions_({memberId:"CSS0011234"})').v.total === 11, 'counts, member history and export omit removed redemption');
ok(run('redemptionAudit.some(x=>x.action === "partner.redemption.delete" && x.target === "RDtest22" && x.details.partnerName === "TEST Cafe")'), 'Activity keeps removed record details');
ok(J('route_({action:"deleteRedemption",token:"test-admin",redemptionId:"RDmissing"})').err === 'NOT_FOUND' && run('TBL.Redemptions.length') === 22, 'missing record removal leaves other records untouched');

r = J(`deletePartner_(${JSON.stringify(S)}, "${id}")`);
ok(r.v && r.v.ok && J(`listPartners_()`).v.partners.every((p) => p.id !== id), "admin delete removes it");
run(`TBL.Partners = [];`);
ok(J(`listPartners_()`).v.partners.length === 0, "an emptied list does not bring the starter list back");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
