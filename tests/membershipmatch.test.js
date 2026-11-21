// Membership reads use the real row parser and cache code with a fake sheet. No live data or email.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const values = [["Full Name", "UCID", "Email", "Member ID", "Paid Status"],
  ["Test Member", "30123456", "member@example.com", "CSS0011234", "Awaiting Cash"]];
const cache = {};
let reads = 0;
let unavailable = false;
const scriptCache = {
  get: (key) => cache[key] ?? null,
  getAll: (keys) => Object.fromEntries(keys.filter((key) => cache[key] !== undefined).map((key) => [key, cache[key]])),
  putAll: (data) => Object.assign(cache, data),
  removeAll: (keys) => keys.forEach((key) => { delete cache[key]; })
};
const ctx = vm.createContext({
  console,
  MEMBER_CACHE_SECONDS: 300,
  CacheService: { getScriptCache: () => scriptCache },
  getConfig_: () => ({ membershipSheetId: "fake", membershipTab: "Members" }),
  retry_: (fn) => fn(),
  SpreadsheetApp: { openById: () => {
    reads++;
    if (unavailable) throw new Error("Fake sheet unavailable");
    return { getSheetByName: () => ({ getDataRange: () => ({ getValues: () => values }) }) };
  } }
});
["Members.js", "Store.js"].forEach((file) => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "api", file), "utf8"), ctx));
const run = (code) => vm.runInContext(code, ctx);

assert.strictEqual(run("loadMembers_()[0].paid"), false);
values[1][4] = "PAID";
assert.strictEqual(run("loadMembers_()[0].paid"), false);
assert.strictEqual(reads, 1);
assert.strictEqual(run("loadMembers_(true)[0].paid"), true);
assert.strictEqual(reads, 2);
assert.strictEqual(run("loadMembers_()[0].paid"), true);
assert.strictEqual(reads, 2);
console.log("PASS A deliberate recheck reads the current payment and refreshes the normal cache");

unavailable = true;
delete cache.members_count;
assert.strictEqual(run("loadMembers_()[0].paid"), true);
assert.throws(() => run("loadMembers_(true)"), /Fake sheet unavailable/);
console.log("PASS An ordinary read can use its backup; a deliberate recheck reports failure instead of using stale payment data");

unavailable = false;
values[1][4] = "Awaiting E-transfer";
run("loadMembers_(true)");
assert.strictEqual(run("cacheGetJson_(CacheService.getScriptCache(), 'members_old')[0].paid"), false);
// Simulate a confirmed membership write, whose final step is forgetMembers_().
values[1][4] = "PAID";
run("forgetMembers_()");
assert.strictEqual(cache.members_count, undefined);
assert.strictEqual(cache.members_old_count, undefined);
unavailable = true;
assert.throws(() => run("loadMembers_()"), /Fake sheet unavailable/);
unavailable = false;
assert.strictEqual(run("loadMembers_()[0].paid"), true);
console.log("PASS A membership correction discards both cached copies so an old unpaid record cannot return after a read failure");

[true, "TRUE", "YES", "Y", "PAID", " paid ", 1, "\u2713"].forEach((status) => {
  ctx.statusUnderTest = status;
  assert.strictEqual(run("isYes_(statusUnderTest)"), true);
});
[false, "FALSE", "NO", "UNPAID", "Awaiting Cash", "Awaiting E-transfer", ""].forEach((status) => {
  ctx.statusUnderTest = status;
  assert.strictEqual(run("isYes_(statusUnderTest)"), false);
});
console.log("PASS Paid and unpaid sheet statuses remain distinct");
console.log("ALL PASSED");
