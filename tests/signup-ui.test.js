// Public signup validation and retries. Runs the actual page scripts with a small fake browser; no email or live API.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
let fails = 0;
const ok = (condition, message) => {
  console.log((condition ? "PASS " : "FAIL ") + message);
  if (!condition) fails++;
};

function browser() {
  const elements = {};
  const context = vm.createContext({
    console, URL, URLSearchParams,
    document: {
      getElementById(id) { return elements[id] || (elements[id] = { value: "", hidden: false, disabled: false, addEventListener() {} }); },
      querySelectorAll() { return []; }
    },
    window: { crypto: true, scrollTo() {} },
    crypto: { randomUUID() { return "request-" + (++context.requestCount); } },
    setTimeout(fn) { fn(); },
    requestCount: 0
  });
  const run = (source) => vm.runInContext(source, context);
  run(fs.readFileSync(path.join(__dirname, "../public/strings.js"), "utf8"));
  run(fs.readFileSync(path.join(__dirname, "../public/public.js"), "utf8").replace(/\bstart\(\);\s*$/, ""));
  run(`currentEvent = { slug: "test", ticketTypes: [{ id: "general", name: "General", price: 5 }], questions: [] };`);
  return { context, run, elements };
}
const valid = { name: "Test Attendee", email: "test@example.com", ucid: "30123456", memberId: "", ticketTypeId: "general", answers: {} };

async function main() {
  const { run } = browser();
  const problem = (changes, people) => run("firstProblem(" + JSON.stringify(people || [Object.assign({}, valid, changes)]) + ")");
  ok(problem({}) === "", "a valid signup with an eight-digit UCID can continue");
  ok(/UCID or CSS member ID/.test(problem({ ucid: "" })), "a missing UCID and member ID is refused before any request");
  ok(problem({ ucid: "", memberId: "CSS1234" }) === "", "a member ID replaces the UCID for general-price tickets too");
  for (const ucid of ["1234567", "123456789", "30123abc", "3012 3456", "３０１２３４５６"]) {
    ok(/8-digit UCID/.test(problem({ ucid })), "malformed UCID is refused: " + ucid);
  }
  ok(/8-digit UCID/.test(problem({ ucid: "wrong", memberId: "CSS1234" })), "a supplied malformed UCID cannot hide behind a member ID");
  ok(/Friend 1/.test(problem({}, [valid, Object.assign({}, valid, { name: "Friend", ucid: "", email: "friend@example.com" })])), "the missing identity message names the affected friend");
  ok(problem({ email: "person@school.example.edu" }) === "", "an unfamiliar but well-formed school domain is accepted");
  ok(/valid email/.test(problem({ email: "test@@example.com" })), "a malformed email is refused");
  for (const email of ["person@gnail.com.", "person@gnail..com", "person@-gmail.com", "person@gmail-.com"]) {
    ok(/valid email/.test(problem({ email })), "invalid email domain is refused before registration: " + email);
  }
  const typo = problem({ email: "frigidernie@gnail.com" });
  ok(typo.includes("frigidernie@gmail.com"), "the reported gnail.com typo offers the corrected full address");
  for (const domain of ["gmial.com", "gamil.com", "gmaill.com", "gmai.com", "gmail.con", "gmail.cmo", "hotmial.com", "hotmail.con", "outlok.com", "outlook.con", "yaho.com", "yahoo.con", "ucalgary.con"]) {
    ok(/did you mean/.test(problem({ email: "test@" + domain })), "a known email domain typo is caught: " + domain);
  }
  ok(/frigidernie@gmail.com/.test(problem({ email: "frigidernie@GNAIL.COM" })), "email typo detection ignores domain capitalization");
  run(`currentEvent.questions = [{ id: "meal", label: "Meal", required: true }];`);
  ok(problem({}) === "Please fill in: Meal", "required event questions retain their clear error message");
  run(`currentEvent.questions = [];`);

  const markup = run("personFields(currentEvent, 0)");
  ok(/data-f="ucid"[^>]*maxlength="8"[^>]*required/.test(markup), "the UCID field advertises an eight-digit requirement");
  ok(/<div class="member-fields">/.test(markup) && /data-f="memberId"/.test(markup), "member code is visible even for a general-price ticket");
  ok(!/Leave blank if you're not/.test(markup), "the old optional-UCID instruction is removed");
  run(`
    var ucidInput = { required: true };
    var memberInput = { value: "" };
    var star = { hidden: false };
    var note = { hidden: false };
    var section = { querySelector(selector) {
      return selector === '[data-f="ucid"]' ? ucidInput : selector === '[data-f="memberId"]' ? memberInput :
        selector === '[data-identity-required]' ? star : selector === '[data-member-note]' ? note : { value: "general" };
    }};
    document.querySelectorAll = () => [section];
    updateMemberFields();
  `);
  ok(run("ucidInput.required && !star.hidden && note.hidden"), "UCID starts required and general tickets hide the existing member-verification note");
  run(`memberInput.value = "CSS1234"; updateMemberFields();`);
  ok(run("!ucidInput.required && star.hidden"), "typing a member code immediately makes UCID optional");
  run(`memberInput.value = "  "; updateMemberFields();`);
  ok(run("ucidInput.required && !star.hidden"), "clearing the member code makes UCID required again");

  const retry = browser();
  retry.run(`
    var peopleForTest = ${JSON.stringify([valid])};
    readPeople = () => peopleForTest;
    updateTotal = () => {};
    var requests = [];
    var nextReply = { ok: false, error: "NETWORK" };
    api = async (action, details) => { requests.push(details); return nextReply; };
    showPaymentScreen = () => {};
    var submitEvent = { preventDefault() {} };
  `);
  await retry.run("onSubmit(submitEvent)");
  ok(retry.run("requests.length === 4 && requests.every(r => r.requestId === requests[0].requestId)"), "all four automatic retries use one request ID");
  await retry.run("onSubmit(submitEvent)");
  ok(retry.run("requests.length === 8 && requests.every(r => r.requestId === requests[0].requestId)"), "pressing Register again after a network failure retains the same request ID");
  retry.run(`peopleForTest[0].email = "different@example.com"; nextReply = { ok: false, error: "BAD_REQUEST", message: "Try another ticket" };`);
  await retry.run("onSubmit(submitEvent)");
  ok(retry.run("requests[8].requestId !== requests[0].requestId"), "changing the registration details uses a new request ID");
  retry.run(`nextReply = { ok: true };`);
  await retry.run("onSubmit(submitEvent)");
  ok(retry.run("pendingRegistration === null"), "a successful registration clears the pending request");
  const beforeTypo = retry.run("requests.length");
  retry.run(`peopleForTest[0].email = "frigidernie@gnail.com";`);
  await retry.run("onSubmit(submitEvent)");
  ok(retry.run("requests.length") === beforeTypo && retry.elements["form-error"].textContent.includes("gmail.com"), "an email typo shows the correction without sending a registration");
  ok(retry.run('peopleForTest[0].email === "frigidernie@gnail.com"'), "the typed address is never silently changed");
  retry.run(`peopleForTest[0].email = "valid@example.com"; var resolveRequest; api = (action, details) => { requests.push(details); return new Promise(resolve => { resolveRequest = resolve; }); };`);
  const first = retry.run("onSubmit(submitEvent)");
  const beforeSecondSubmit = retry.run("requests.length");
  await retry.run("onSubmit(submitEvent)");
  ok(retry.run("requests.length") === beforeSecondSubmit, "a second submit while the first is waiting cannot start another registration");
  retry.run(`resolveRequest({ ok: false, error: "BAD_REQUEST", message: "No changes" });`);
  await first;
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exitCode = fails ? 1 : 0;
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
