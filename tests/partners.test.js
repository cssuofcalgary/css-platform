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

r = J(`deletePartner_(${JSON.stringify(S)}, "${id}")`);
ok(r.v && r.v.ok && J(`listPartners_()`).v.partners.every((p) => p.id !== id), "admin delete removes it");
run(`TBL.Partners = [];`);
ok(J(`listPartners_()`).v.partners.length === 0, "an emptied list does not bring the starter list back");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
