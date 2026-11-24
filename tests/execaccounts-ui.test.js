// The actual first-time password screen, with a fake browser and API. No live data.
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
let fails = 0;
const ok = (value, message) => { console.log((value ? "PASS " : "FAIL ") + message); if (!value) fails++; };
const elements = {};
function element(id) {
  if (!elements[id]) elements[id] = { value: "", hidden: true, disabled: false, open: false, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }, focus() {},
    showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); } };
  return elements[id];
}
const context = vm.createContext({ console, $: element });
const run = (code) => vm.runInContext(code, context);
run(fs.readFileSync(path.join(__dirname, "../exec-portal/strings.js"), "utf8"));
run(`var calls = [], completed = [], loginError = '', reply = {ok:true,token:'test-session',name:'TEST Exec',role:'exec'};
function api(action, details) { calls.push({action,details}); return Promise.resolve(reply); }
function errorText(r) { return r.message || r.error; }
function completeSignIn(r) { completed.push(r); }
function setLoginError(text) { loginError = text; }`);
run(fs.readFileSync(path.join(__dirname, "../exec-portal/execaccounts.js"), "utf8"));
const submit = () => element("exec-password-form").listeners.submit({ preventDefault() {} });
async function main() {
  run(`openExecPasswordSetup({setupToken:'setup-only',name:'TEST Exec'})`);
  ok(element("exec-password-dialog").open && element("exec-password-name").textContent === "TEST Exec", "setup shows the invited name before a portal session exists");
  element("exec-password-new").value = "test-private-1";
  element("exec-password-again").value = "different";
  await submit();
  ok(run("calls.length") === 0 && !element("exec-password-error").hidden, "mismatched passwords stay on the screen without calling the API");
  element("exec-password-again").value = "test-private-1";
  await submit();
  ok(run("calls[0].action") === "finishExecSetup" && run("calls[0].details.setupToken") === "setup-only", "the screen submits the setup proof, rather than signing in with a shared password");
  ok(run("completed.length") === 1 && !element("exec-password-dialog").open && element("exec-password-new").value === "", "success signs in and clears the password fields and setup token");
  run(`openExecPasswordSetup({setupToken:'expired',name:'TEST Exec'}); reply={ok:false,error:'PASSWORD_SETUP_EXPIRED',message:'Sign in again.'};`);
  element("exec-password-new").value = element("exec-password-again").value = "test-private-2";
  await submit();
  ok(!element("exec-password-dialog").open && run("loginError") === "Sign in again.", "expired setup returns to sign-in instead of trapping the user");
  run(`openExecPasswordSetup({setupToken:'cancelled',name:'TEST Exec'})`);
  element("exec-password-new").value = "typed-secret";
  element("exec-password-cancel").listeners.click();
  ok(element("exec-password-new").value === "" && run("execSetupToken") === "", "Cancel clears the unsubmitted password and setup token");

  // Existing pre-feature sessions should also seed the remembered name on this device.
  const local = new Map(), session = new Map([["css_token", "old-session"], ["css_name", "TEST Remembered"], ["css_role", "exec"]]);
  const storage = (map) => ({ getItem: (key) => map.get(key) || null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) });
  const browser = vm.createContext({ console, URLSearchParams, location: { search: "" }, localStorage: storage(local), sessionStorage: storage(session),
    document: { getElementById: element, addEventListener() {}, readyState: "complete", querySelector() { return null; } },
    window: { matchMedia() { return { matches: false }; } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../exec-portal/app.js"), "utf8"), browser);
  vm.runInContext(`showSearch=()=>{}; switchTab=()=>{}; showApp();`, browser);
  ok(JSON.parse(local.get("css_names"))[0] === "TEST Remembered", "an existing signed-in session remembers its name without requiring another login");
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
