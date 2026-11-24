// Sign-in People search through the actual input listeners, using a fake browser and API.
// No live names, passwords, network requests or emails.
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
let fails = 0;
const ok = (value, message) => { console.log((value ? "PASS " : "FAIL ") + message); if (!value) fails++; };
const local = new Map([["css_names", '["TEST Old Device Name"]']]);
const storage = (map) => ({ getItem: (key) => map.get(key) || null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) });
const elements = {};
const document = { activeElement: null, readyState: "complete", body: { classList: { toggle() {} } },
  getElementById: element, addEventListener() {}, querySelector() { return null; },
  querySelectorAll(selector) { return selector === "#name-list [role=option]" ? element("name-list").options : []; } };
function element(id) {
  if (!elements[id]) {
    let html = "";
    elements[id] = { id, value: "", hidden: true, disabled: false, textContent: "", attributes: {}, listeners: {}, options: [],
      addEventListener(type, callback) { this.listeners[type] = callback; },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      removeAttribute(key) { delete this.attributes[key]; },
      focus() {
        if (document.activeElement === this) return;
        document.activeElement?.listeners.blur?.();
        document.activeElement = this;
        this.listeners.focus?.();
      },
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = value;
        this.options = [...value.matchAll(/<li id="([^"]+)"[^>]*data-index="(\d+)"[^>]*>(.*?)<\/li>/g)].map((match) => ({
          id: match[1], dataset: { index: match[2] }, label: match[3], attributes: {}, active: false,
          setAttribute(key, value) { this.attributes[key] = String(value); }, scrollIntoView() {},
          classList: { toggle() {} }, closest(selector) { return selector === "[data-index]" ? this : null; }
        }));
      }
    };
  }
  return elements[id];
}
const browser = vm.createContext({ console, URLSearchParams, location: { search: "" }, document,
  localStorage: storage(local), sessionStorage: storage(new Map()), API_URL: "offline-test",
  window: { matchMedia() { return { matches: false }; } } });
const run = (code) => vm.runInContext(code, browser);
run(fs.readFileSync(path.join(__dirname, "../exec-portal/strings.js"), "utf8"));
run(fs.readFileSync(path.join(__dirname, "../exec-portal/app.js"), "utf8"));
const requests = [];
browser.testApi = (action) => new Promise((resolve, reject) => requests.push({ action, resolve, reject }));
run("api=testApi; fillText=()=>{}; start();");
const input = element("name-input"), list = element("name-list"), status = element("name-status"), password = element("password");
const type = (value) => { input.focus(); input.value = value; input.listeners.input(); };
const press = (key, isComposing = false) => {
  const event = { key, isComposing, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  input.listeners.keydown(event);
  return event;
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const labels = () => list.options.map((option) => option.label).join("|");

async function main() {
  ok(input.value === "" && !local.has("css_names") && document.activeElement === input, "sign-in starts blank and discards old device name suggestions");
  ok(requests.length === 1 && requests[0].action === "signInNames", "the search loads the club People list without signing in");
  type("K");
  ok(list.hidden && status.hidden, "one letter shows no suggestions or search status");
  type("ke");
  ok(list.hidden && !status.hidden && status.textContent === run("T.nameSearching"), "two letters show searching while People is loading");
  const loadingEnter = press("Enter");
  ok(loadingEnter.prevented && document.activeElement === input && input.value === "ke", "Enter waits for People to load instead of continuing with an incomplete name");
  requests[0].resolve({ ok: true, names: ["Marcus Lee", "TEST Kevin B", "Kevin Chen", "  Kevin   Chen  ", "KEVIN CHEN", "A < B", "", null] });
  await settle();
  ok(!list.hidden && labels() === "Kevin Chen|TEST Kevin B", "loaded suggestions match the current text, ignore case and duplicate names, and put first-name matches first");
  ok(!labels().includes("Old Device"), "computer-saved names are never mixed into People results");
  type("LE");
  ok(labels() === "Marcus Lee", "search also finds a person's last name regardless of case");
  type("ke");
  const enter = press("Enter");
  ok(enter.prevented && input.value === "Kevin Chen" && list.hidden && document.activeElement === password, "Enter selects the first match and moves to the password without submitting sign-in");
  type("ke");
  press("ArrowDown");
  press("ArrowDown");
  ok(input.attributes["aria-activedescendant"] === "name-option-1" && list.options[1].attributes["aria-selected"] === "true", "arrow keys move the accessible selection to the next person");
  press("Enter");
  ok(input.value === "TEST Kevin B" && document.activeElement === password, "Enter selects the highlighted person");
  type("ke");
  press("ArrowUp");
  press("Enter");
  ok(input.value === "TEST Kevin B", "ArrowUp from a fresh list selects the last match");
  type("ke");
  const option = list.options[1];
  let keptFocus = false;
  list.listeners.pointerdown({ target: option, preventDefault() { keptFocus = true; } });
  list.listeners.click({ target: option });
  ok(keptFocus && input.value === "TEST Kevin B" && document.activeElement === password && list.hidden, "clicking a suggestion preserves focus until selection, fills the name and closes the list");
  type("ke");
  const escape = press("Escape");
  ok(escape.prevented && escape.stopped && list.hidden && input.value === "ke" && input.attributes["aria-expanded"] === "false", "Escape closes suggestions and preserves the typed search");
  press("ArrowDown");
  ok(!list.hidden, "arrow keys can reopen suggestions after Escape");
  type("k");
  ok(list.hidden && status.hidden && !input.attributes["aria-activedescendant"], "deleting back to one letter closes the list and clears its active option");
  type("A <");
  ok(labels() === "A &lt; B" && !list.innerHTML.includes("A < B"), "names containing markup are safely displayed as text");
  type("zz");
  ok(list.hidden && !status.hidden && status.textContent === run("T.nameNoMatches"), "an unmatched name gives a clear empty result");
  press("Enter");
  ok(input.value === "zz" && document.activeElement === password && status.hidden, "an unmatched typed name can still continue to existing sign-in and door flows");
  type("ke");
  password.focus();
  ok(list.hidden && status.hidden && input.attributes["aria-expanded"] === "false", "moving away from the name field closes suggestions");
  type("ke");
  const composing = press("Enter", true);
  ok(!composing.prevented && input.value === "ke" && document.activeElement === input, "Enter used to compose a name does not select a person or move focus");
  ok(requests.length === 1, "typing and refocusing reuse the loaded People list without extra requests");

  // A failed or delayed load must not replace newer text or reopen a blurred field.
  run("peopleNames=[]; peopleNamesAsked=false;");
  type("ke");
  requests[1].resolve({ ok: false, error: "NETWORK" });
  await settle();
  ok(!status.hidden && status.textContent === run("T.nameSearchFailed"), "a failed People load shows a retry message instead of claiming there are no matches");
  type("ma");
  ok(requests.length === 3 && status.textContent === run("T.nameSearching"), "typing again retries a failed load");
  type("le");
  requests[2].resolve({ ok: true, names: ["TEST Kevin B", "Marcus Lee"] });
  await settle();
  ok(labels() === "Marcus Lee" && input.value === "le", "a delayed reply uses the latest search text instead of showing old matches");
  run("peopleNames=[]; peopleNamesAsked=false;");
  type("ke");
  password.focus();
  requests[3].resolve({ ok: true, names: ["TEST Kevin B"] });
  await settle();
  ok(list.hidden && status.hidden && document.activeElement === password, "a delayed reply never reopens suggestions after the name field loses focus");
  run("peopleNames=[]; peopleNamesAsked=false;");
  type("ke");
  type("k");
  requests[4].resolve({ ok: true, names: ["TEST Kevin B"] });
  await settle();
  ok(list.hidden && status.hidden && input.value === "k", "a delayed reply respects the two-letter threshold after the user deletes text");
  run("peopleNames=[]; peopleNamesAsked=false;");
  type("ke");
  press("Escape");
  requests[5].resolve({ ok: true, names: ["TEST Kevin B"] });
  await settle();
  ok(list.hidden && status.hidden && document.activeElement === input, "Escape dismisses an in-flight search and its delayed reply cannot reopen suggestions");
  type("kev");
  ok(!list.hidden && labels() === "TEST Kevin B", "typing again reopens matches after dismissing a pending search");

  run("peopleNames=[]; peopleNamesAsked=false;");
  type("ke");
  run("signOutLocally();");
  type("ke");
  requests[6].resolve({ ok: true, names: ["TEST Old Kevin"] });
  await settle();
  ok(list.hidden && status.textContent === run("T.nameSearching"), "a signed-out session's delayed People response cannot replace the next search");
  requests[7].resolve({ ok: true, names: ["TEST New Kevin"] });
  await settle();
  ok(labels() === "TEST New Kevin", "the next sign-in reloads People rather than reusing a stale roster");

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exitCode = fails ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
