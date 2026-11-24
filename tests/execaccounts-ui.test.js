// The actual first-time password screen, with a fake browser and API. No live data.
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
let fails = 0;
const ok = (value, message) => { console.log((value ? "PASS " : "FAIL ") + message); if (!value) fails++; };
const elements = {};
function element(id) {
  if (!elements[id]) elements[id] = { value: "", hidden: true, disabled: false, open: false, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }, focus() {},
    setAttribute() {}, removeAttribute() {},
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

  // Existing sessions still work, but no longer save names on this computer.
  const local = new Map(), session = new Map([["css_token", "old-session"], ["css_name", "TEST Remembered"], ["css_role", "exec"]]);
  const storage = (map) => ({ getItem: (key) => map.get(key) || null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) });
  const browser = vm.createContext({ console, URLSearchParams, location: { search: "" }, localStorage: storage(local), sessionStorage: storage(session),
    document: { getElementById: element, addEventListener() {}, readyState: "complete", querySelector() { return null; } },
    window: { matchMedia() { return { matches: false }; } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../exec-portal/app.js"), "utf8"), browser);
  vm.runInContext(`showSearch=()=>{}; switchTab=()=>{}; showApp();`, browser);
  ok(!local.has("css_names"), "an existing signed-in session does not save its name on this computer");
  vm.runInContext(`var landed=''; switchTab=(tab)=>{landed=tab;}; window.matchMedia=()=>({matches:true}); showApp();`, browser);
  ok(vm.runInContext("landed", browser) === "tasks", "phones open Tasks without a scanner redirect");
  session.set("css_tab", "overview");
  vm.runInContext(`document.querySelector=()=>({hidden:false}); showApp();`, browser);
  ok(vm.runInContext("landed", browser) === "tasks", "a phone's old saved tab does not replace the Tasks landing page");
  vm.runInContext(`state.role='door'; showApp();`, browser);
  ok(vm.runInContext("landed", browser) === "door", "door-only volunteers still open Door");
  vm.runInContext(`state.role='exec'; window.matchMedia=()=>({matches:false}); showApp();`, browser);
  ok(vm.runInContext("landed", browser) === "overview", "desktop sign-ins retain their saved tab");
  const scanner = vm.createContext({ console, URLSearchParams, location: { search: "?mode=scanner" }, localStorage: storage(local), sessionStorage: storage(session),
    document: { getElementById: element, addEventListener() {}, readyState: "complete", querySelector() { return null; } },
    window: { matchMedia() { return { matches: true }; } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../exec-portal/app.js"), "utf8"), scanner);
  vm.runInContext(`var landed=''; showSearch=()=>{}; switchTab=(tab)=>{landed=tab;}; showApp();`, scanner);
  ok(vm.runInContext("landed", scanner) === "door", "choosing the scanner link explicitly still opens Door on phones");
  const shell = vm.createContext({ console, $: element, sessionStorage: storage(new Map()) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../exec-portal/strings.js"), "utf8"), shell);
  vm.runInContext(`var state={token:'exec-session',name:'TEST Exec',role:'exec'}, calls=[], eventsState={}, ovState={};
    function api(action, details) { calls.push({action,details}); return Promise.resolve({ok:true,token:'unlocked-session',name:'TEST Exec',role:'admin'}); }
    function showApp() {} function showToast() {} function errorText(r) {return r.error;}`, shell);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../exec-portal/shell.js"), "utf8").split('$("admin-gear").addEventListener')[0], shell);
  element("admin-pw").value = "fake-settings-password";
  await vm.runInContext(`onAdminSubmit({preventDefault(){}})`, shell);
  ok(vm.runInContext(`calls[0].action==='unlockSettings' && !('name' in calls[0].details) && calls[1].action==='logout' && calls[1].details.token==='exec-session' && state.role==='admin'`, shell), "the gear uses authenticated Settings unlock and retires the old session");
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
