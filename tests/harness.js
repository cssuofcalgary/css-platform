// In-memory test of the API logic: loads every api/*.js into one vm context with Apps Script stubs.
const fs = require("fs"), vm = require("vm"), path = require("path"), crypto = require("crypto");
const dir = path.join(__dirname, "..", "api");
const src = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n;\n");

const sent = [];
const store = {};          // props
const cache = {};
const ctx = {
  console,
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, fmt) => { const x = new Date(d); const p = (n) => String(n).padStart(2, "0");
      return fmt.replace("yyyy", x.getUTCFullYear()).replace("MM", p(x.getUTCMonth() + 1)).replace("dd", p(x.getUTCDate())).replace("HH", p(x.getUTCHours())).replace("mm", p(x.getUTCMinutes())).replace("'T'", "T").replace("h:mm a", "x").replace("u", "3"); },
    base64EncodeWebSafe: (s) => Buffer.from(String(s)).toString("base64url"),
    computeHmacSha256Signature: (a, b) => [...crypto.createHmac("sha256", b).update(a).digest()],
    sleep() {}, newBlob() {}, parseDate: (s) => new Date(s.replace(" ", "T") + ":00Z")
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }), getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; }, removeAll: () => {}, getAll: (ks) => Object.fromEntries(ks.map((k) => [k, cache[k]])), putAll: (o) => Object.assign(cache, o) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] ?? null, setProperty: (k, v) => { store[k] = v; } }) },
  MailApp: { sendEmail: (m) => sent.push(m), getRemainingDailyQuota: () => 90 },
  SpreadsheetApp: {}, DriveApp: {}, ContentService: { createTextOutput: () => ({ setMimeType() { return this; } }), MimeType: {} }
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

// in-memory tables replacing Db.js reads/writes
vm.runInContext(`
var TBL = {}; var ROWN = 2;
function readRows_(name) { return (TBL[name] = TBL[name] || []); }
function insertRow_(name, obj) { var o = Object.assign({}, obj); Object.defineProperty(o, "_row", { value: ROWN++, enumerable: false }); (TBL[name] = TBL[name] || []).push(o); }
function updateRow_(name, id, changes) { var r = (TBL[name] || []).filter(function (x) { return String(x.id) === String(id); })[0]; if (!r) throw new Error("no row " + id); Object.assign(r, changes); }
function log_() {}
function rememberError_() {}
function siteInfo_() { return {}; }
function getConfig_() { return { etransferEmail: "pay@css.test", contactEmail: "c@css.test", membershipSheetId: "x" }; }
function loadMembers_() { return TBL.__members || []; }
function emailBrand_() { return { signerName: "A", signerRole: "B", buttonColor: "#000000" }; }
function ticketLink_(t) { return "https://events/t?t=" + t.secret; }
`, ctx);

module.exports = { ctx, sent, run: (code) => vm.runInContext(code, ctx) };
