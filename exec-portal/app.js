// CSS Exec Portal v0.1 — sign in, search members, view a member. Read-only.

// ?mode=scanner = the stripped-down door scanner (phones open it by themselves; ?full=1 skips that)
const PARAMS = new URLSearchParams(location.search);
const SCANNER_MODE = PARAMS.get("mode") === "scanner";
const FORCE_FULL = PARAMS.get("full") === "1";

const state = {
  token: sessionStorage.getItem("css_token") || "",
  name: sessionStorage.getItem("css_name") || "",
  role: sessionStorage.getItem("css_role") || "exec",
  results: []
};

const $ = (id) => document.getElementById(id);

// ---- Talking to the API -----------------------------------------------------

// Looking things up is safe to repeat, so a hiccup (Google being slow, a dropped connection) is retried
// quietly. Anything that changes data (mark paid, scan, edit…) is never repeated automatically.
const READ_ACTIONS = ["listEvents", "listOrders", "doorList", "eventSummary", "searchMembers", "getMember"];
const REQUEST_TIMEOUT_MS = 35000;
const RETRY_PAUSE_MS = 1200;

// The panda shows in the middle when a request takes longer than a moment (and moves on to "taking a little longer" and
// "still working" the longer it waits). Door scans, searches-as-you-type and the keep-alive stay quiet, and so does the
// scanner phone page. Jobs that work through a list show "almost there" instead.
const QUIET_ACTIONS = ["ping", "scan", "doorList", "deskAlerts", "searchMembers", "getMember", "emailStatus"];
const EMAIL_ACTIONS = ["markOrderPaid", "markOrdersPaid", "sendPendingEmails", "resendTickets", "addOrder", "sendReminders", "editTicket", "offerWaitlist", "mailAll"];   // after these the email indicator is refreshed
const BATCH_ACTIONS = ["sendPendingEmails", "markOrdersPaid", "sendReminders"];
const PANDA_DELAY_MS = 700;
let pandaBusyCount = 0, pandaBusyTimer = null, pandaBatch = false;

function pandaBusy(on, batch) {
  pandaBusyCount = Math.max(0, pandaBusyCount + (on ? 1 : -1));
  const box = $("panda-busy");
  if (!box) return;
  if (on && batch) pandaBatch = true;
  if (on && pandaBusyCount === 1) pandaBusyTimer = setTimeout(() => { box.hidden = false; mountPanda(box, "loading", { compact: true, batch: pandaBatch }); }, PANDA_DELAY_MS);
  if (pandaBusyCount === 0) { clearTimeout(pandaBusyTimer); box.hidden = true; clearPanda(box); pandaBatch = false; }
}

async function api(action, details = {}) {
  const quiet = SCANNER_MODE || QUIET_ACTIONS.includes(action);
  if (!quiet) pandaBusy(true, BATCH_ACTIONS.includes(action));
  try {
    const reply = await apiRequest(action, details);
    if (reply && reply.ok && EMAIL_ACTIONS.includes(action) && typeof refreshMailStatus === "function") refreshMailStatus(true);
    return reply;
  } finally { if (!quiet) pandaBusy(false); }
}

async function apiRequest(action, details = {}) {
  const body = { action, token: state.token, ...(SCANNER_MODE ? { scanner: true } : {}), ...details };   // "scanner" lets the server count this page as a scanner phone
  if (!API_URL) return MockApi.handle(body);   // demo mode
  // "Busy" means the server never started the action, so EVERY action can safely be tried again. Other hiccups are only
  // retried for lookups; something that changes data is never repeated on a guess.
  const isRead = READ_ACTIONS.includes(action);
  const tries = isRead ? 3 : 4;
  let reply = { ok: false, error: "NETWORK" };
  for (let attempt = 1; attempt <= tries; attempt++) {
    reply = await sendOnce(body);
    const hiccup = !reply.ok && (reply.error === "BUSY" || (isRead && ["NETWORK", "TEMPORARY"].includes(reply.error)));
    if (!hiccup || attempt === tries) break;
    setConnectionNotice(true);
    await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS * attempt));
  }
  setConnectionNotice(false);
  return reply;
}

async function sendOnce(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);   // never wait forever
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      // text/plain avoids a browser pre-check that Apps Script can't answer
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: "NETWORK" };
  } finally {
    clearTimeout(timer);
  }
}

let toastTimer = null;
function showToast(message, kind) {
  const box = $("toast");
  box.textContent = message;
  if (kind === "success") box.insertAdjacentHTML("afterbegin", pandaImg("success", "pl-toast"));
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 8000);
}

function setConnectionNotice(on) {
  const box = $("connection-notice");
  if (box) box.hidden = !on;
}

function errorText(reply) {
  return T.errors[reply.error] || reply.message || T.errors.DEFAULT;
}

// ---- Sign-in ----------------------------------------------------------------

function showLogin(message) {
  $("app-view").hidden = true;
  $("login-view").hidden = false;
  setLoginError(message || "");
  $("name-input").focus();
}

function setLoginError(text) {
  $("login-error").innerHTML = text ? pandaImg("error", "pl-inline") + pandaEsc(text) : "";
  $("login-error").hidden = !text;
}

async function onLogin(event) {
  event.preventDefault();
  await signInWith("login", $("login-button"), T.signIn);
}

/** Door volunteers: name only (plus the door password if the admin set one). Scanner page only. */
async function onDoorLogin() {
  if (!$("name-input").value.trim()) { $("name-input").focus(); return setLoginError(T.errors.NAME_NEEDED); }
  await signInWith("loginDoor", $("door-login-button"), T.doorSignIn);
}

async function signInWith(action, button, label) {
  const name = $("name-input").value;
  button.disabled = true;
  button.textContent = T.signingIn;

  const reply = await api(action, { password: $("password").value, name });

  button.disabled = false;
  button.textContent = label;
  if (!reply.ok) return setLoginError(errorText(reply));

  state.token = reply.token;
  state.name = reply.name;
  state.role = reply.role || "exec";
  sessionStorage.setItem("css_token", state.token);
  sessionStorage.setItem("css_name", state.name);
  sessionStorage.setItem("css_role", state.role);
  $("password").value = "";
  showApp();
}

async function onLogout() {
  await api("logout");
  signOutLocally();
  showLogin();
}

function signOutLocally() {
  state.token = "";
  state.name = "";
  sessionStorage.removeItem("css_token");
  sessionStorage.removeItem("css_name");
  sessionStorage.removeItem("css_role");
  sessionStorage.removeItem("css_tab");
}

// ---- Member search ----------------------------------------------------------

function showApp() {
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  $("who-name").textContent = state.name;
  $("admin-badge").hidden = state.role !== "admin";
  if (state.role === "door") $("full-portal-link").hidden = true;   // door volunteers only scan
  $("settings-tab-button").hidden = state.role !== "admin";
  $("activity-tab-button").hidden = state.role !== "admin";
  $("admin-nav-label").hidden = state.role !== "admin";
  $("who-avatar").textContent = state.name.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  showSearch();
  if (typeof startMailStatus === "function") startMailStatus();
  // Phones are for the door: open straight to the Door tab. Everyone else lands on the Overview.
  // (The tab code loads after this file, so on first load wait until every script has run.)
  let landing = SCANNER_MODE || isPhone() ? "door" : "overview";
  // A refresh keeps you where you were (same browser tab): the last tab is remembered for this sign-in.
  try {
    const saved = sessionStorage.getItem("css_tab");
    const button = saved && document.querySelector('.tab[data-tab="' + saved + '"]');
    if (!SCANNER_MODE && state.role !== "door" && button && !button.hidden) landing = saved;
  } catch (e) { /* no storage: land on the usual tab */ }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => switchTab(landing));
  else switchTab(landing);
}

/** A phone = small screen + touch. Tablets and laptops get the full portal. */
function isPhone() {
  return window.matchMedia("(max-width: 700px) and (pointer: coarse)").matches;
}

let searchTimer = null;
let searchCounter = 0;

function onSearchInput() {
  clearTimeout(searchTimer);
  const query = $("search-input").value.trim();
  if (query.length < 2) {
    $("results").innerHTML = "";
    $("search-status").textContent = T.searchHint;
    return;
  }
  searchTimer = setTimeout(() => runSearch(query), 300);
}

async function runSearch(query) {
  const mine = ++searchCounter;
  $("search-status").textContent = T.searching;
  const reply = await api("searchMembers", { query });
  if (mine !== searchCounter) return;   // a newer search already started

  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
    $("search-status").textContent = errorText(reply);
    return;
  }
  state.results = reply.results;
  const total = reply.total || reply.results.length;
  $("search-status").textContent = !reply.results.length ? `${T.noResults} "${query}".`
    : total > reply.results.length ? T.showingFirst(reply.results.length, total)
    : T.resultsCount(total);
  renderResults();
}

function renderResults() {
  $("results").innerHTML = state.results.map((m, i) => `
    <li>
      <button class="result member-result" data-index="${i}" style="animation-delay:${Math.min(i, 12) * 30}ms">
        <span class="m-top">
          <span class="avatar" aria-hidden="true">${escapeHtml(String(m.name || "?").trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase())}</span>
          <span class="m-id"><span class="name">${escapeHtml(m.name)}</span><span class="sub">${escapeHtml(m.memberId || T.noId)}</span></span>
          ${paidPill(m)}
        </span>
        <span class="kv">
          <span><i>${T.memberSince}</i><b>${escapeHtml(formatDate(m.signedUp) || "—")}</b></span>
          <span><i>${T.memberUcid}</i><b class="mono">${escapeHtml(m.ucid || "—")}</b></span>
          <span><i>${T.fieldEmail}</i><b>${escapeHtml(m.email || "—")}</b></span>
        </span>
      </button>
    </li>`).join("");
}

function onResultClick(event) {
  const button = event.target.closest(".result");
  if (button) showMember(state.results[Number(button.dataset.index)]);
}

// ---- Member page ------------------------------------------------------------

function showMember(m) {
  $("mem-list-area").hidden = true;
  $("member-view").hidden = false;
  $("member-name").textContent = m.name;
  $("member-badges").innerHTML = paidPill(m) +
    `<span class="pill ${m.cardSent ? "good" : "warn"}">${m.cardSent ? T.cardSent : T.cardNotSent}</span>`;

  const rows = [
    [T.fieldMemberId, m.memberId || T.noId],
    [T.fieldUcid, m.ucid],
    [T.fieldEmail, m.email],
    [T.fieldSignedUp, formatDate(m.signedUp)],
    [T.fieldPayMethod, m.payment.method],
    [T.fieldPayWhen, formatDay(m.payment.when)],
    [T.fieldPayWhere, m.payment.where],
    [T.fieldPayWho, m.payment.who]
  ].filter(([, value]) => value);

  $("member-fields").innerHTML = rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");

  // Someone who signed up on the website and hasn't been confirmed yet: one tap to mark the payment received.
  state.member = m;
  loadMemberHistory(m);
  $("member-pay").hidden = m.paid || !m.memberId;
  $("member-edit-button").hidden = !m.memberId;
  $("member-resend-pass").hidden = !(m.memberId && m.email && m.paid);
  $("member-resend-pass").disabled = false;
  $("member-resend-pass").textContent = T.resendPass;
  $("member-pay-error").hidden = true;
  $("member-mark-paid").disabled = false;
  $("member-mark-paid").textContent = T.memberMarkPaid;
  window.scrollTo(0, 0);
}

// ---- Add a member by hand ---------------------------------------------------

function openAddMember() {
  ["ma-name", "ma-ucid", "ma-email", "ma-where"].forEach((id) => { $(id).value = ""; });
  $("ma-method").value = "cash";
  $("ma-when").value = todayMountain();
  $("ma-when").max = todayMountain();
  $("ma-who").value = state.name || "";
  $("ma-paid").checked = true;
  $("ma-error").hidden = true;
  $("ma-submit").disabled = false;
  $("ma-submit").textContent = T.maSubmit;
  syncAddMemberMethod();
  $("member-add-dialog").showModal();
  $("ma-name").focus();
}

function syncAddMemberMethod() {
  $("ma-cash").hidden = $("ma-method").value !== "cash";
}

async function onAddMemberSubmit(event) {
  event.preventDefault();
  const cash = $("ma-method").value === "cash";
  const member = { name: $("ma-name").value, ucid: $("ma-ucid").value, email: $("ma-email").value, method: $("ma-method").value };
  if (cash) Object.assign(member, { when: $("ma-when").value, where: $("ma-where").value, who: $("ma-who").value });
  const paidNow = $("ma-paid").checked;

  $("ma-error").hidden = true;
  $("ma-submit").disabled = true;
  $("ma-submit").textContent = T.maSaving;
  const reply = await api("addMember", { member, paidNow });
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { $("member-add-dialog").close(); signOutLocally(); return showLogin(errorText(reply)); }
    $("ma-submit").disabled = false;
    $("ma-submit").textContent = T.maSubmit;
    $("ma-error").textContent = errorText(reply);
    $("ma-error").hidden = false;
    return;
  }
  $("member-add-dialog").close();
  showToast(T.maAdded(member.name.trim(), reply.emailed, reply.paid));
  if (!reply.paid) loadPending(false);   // an unpaid add shows up under Pending
  const fresh = await api("getMember", { memberId: reply.memberId });   // open the new member's page
  if (fresh.ok) showMember(fresh.member);
}

async function markMemberPaid() {
  const m = state.member;
  if (!m || m.paid) return;
  const button = $("member-mark-paid");
  button.disabled = true;
  button.textContent = T.markPaying;
  $("member-pay-error").hidden = true;
  const reply = await api("markMemberPaid", { memberId: m.memberId });
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
    button.disabled = false;
    button.textContent = T.memberMarkPaid;
    $("member-pay-error").textContent = errorText(reply);
    $("member-pay-error").hidden = false;
    return;
  }
  Object.assign(m, reply.member || {}, { paid: true });   // the open page and the search results show the new state
  memberPaidHook(m);   // and Pending drops them
  showMember(m);
  showToast(reply.already ? T.markedAlready : reply.emailed ? T.memberMarkedPaid(m.name) : T.markedPaidNoEmail(m.name), reply.emailed ? "success" : undefined);
}

async function resendMemberPass() {
  const m = state.member;
  if (!m || !m.memberId || !m.email) return;
  const button = $("member-resend-pass");
  button.disabled = true;
  button.textContent = T.resendingPass;
  const reply = await api("resendMemberPass", { memberId: m.memberId });
  button.disabled = false;
  button.textContent = T.resendPass;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
    return showToast(errorText(reply));
  }
  showToast(T.passEmailed(m.email), "success");
}

// ---- Edit a member ----------------------------------------------------------

function openEditMember() {
  const m = state.member;
  if (!m || !m.memberId) return;
  $("em-name").value = m.name || "";
  $("em-email").value = m.email || "";
  $("em-ucid").value = m.ucid || "";
  $("em-paid").value = m.paid ? "paid" : "unpaid";
  $("em-error").hidden = true;
  $("em-submit").disabled = false;
  $("em-submit").textContent = T.emSave;
  $("edit-member-dialog").showModal();
  $("em-name").focus();
}

async function onEditMemberSubmit(event) {
  event.preventDefault();
  const m = state.member;
  if (!m) return;
  const member = { memberId: m.memberId, name: $("em-name").value, email: $("em-email").value, ucid: $("em-ucid").value, paid: $("em-paid").value === "paid" };
  $("em-error").hidden = true;
  $("em-submit").disabled = true;
  $("em-submit").textContent = T.emSaving;
  const reply = await api("updateMember", { member });
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { $("edit-member-dialog").close(); signOutLocally(); return showLogin(errorText(reply)); }
    $("em-submit").disabled = false;
    $("em-submit").textContent = T.emSave;
    $("em-error").textContent = errorText(reply);
    $("em-error").hidden = false;
    return;
  }
  $("edit-member-dialog").close();
  Object.assign(m, reply.member || {});   // the open page and the search results show the new details
  if (m.paid) memberPaidHook(m);          // and Pending drops them
  showMember(m);
  showToast(reply.emailed ? T.memberUpdatedPass : T.memberUpdated, "success");
}

function showSearch() {
  showMemberList();   // back to the list the exec came from: Pending or Search
}

// ---- Helpers ----------------------------------------------------------------

function paidPill(m) {
  const waiting = !m.paid && /^awaiting/i.test(m.status || "");   // "Awaiting Cash" / "Awaiting E-transfer" from the website sign-up
  return `<span class="pill ${m.paid ? "good" : "warn"}">${escapeHtml(m.paid ? T.paid : waiting ? m.status : T.unpaid)}</span>`;
}

/** A date without a clock time (the day someone paid). Sheets hands dates back as midnight timestamps. */
function formatDay(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + "T12:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  const date = new Date(value);
  if (isNaN(date) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Edmonton" });
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;   // not a date: show as typed
  return date.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

/** Today's date in Calgary (yyyy-mm-dd), not UTC: after 6 pm UTC is already "tomorrow". */
function todayMountain() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Start ------------------------------------------------------------------

/** A number with a label, for the summary strips on Payments and Attendees. `attention` adds an accent edge. */
function statTile(label, value, note, attention) {
  return `<div class="tile${attention ? " attention" : ""}"><div class="tile-num">${value}</div><div class="tile-label">${label}</div>${note ? `<div class="tile-note">${note}</div>` : ""}</div>`;
}

function fillText() {
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = T[el.dataset.t]; });
  $("search-input").placeholder = T.searchPlaceholder;
  $("name-input").placeholder = T.namePlaceholder;
  $("pay-search").placeholder = T.paySearchPlaceholder;
  $("att-search").placeholder = T.attSearchPlaceholder;
  $("connection-notice").innerHTML = pandaImg("error", "pl-inline") + pandaEsc(T.reconnecting);
  $("search-status").textContent = T.searchHint;
  document.title = T.appTitle;
}

function start() {
  if (isPhone() && !SCANNER_MODE && !FORCE_FULL) { location.replace("?mode=scanner"); return; }   // phones = scanner
  fillText();
  document.body.classList.toggle("scanner-mode", SCANNER_MODE);
  if (SCANNER_MODE) {
    $("brand").textContent = T.scannerTitle;
    $("full-portal-link").hidden = false;
    $("door-login-button").hidden = false;
    $("door-login-button").addEventListener("click", onDoorLogin);
    document.title = T.scannerTitle;
  }
  document.body.classList.toggle("phone", isPhone());
  if (!API_URL) {
    $("demo-banner").textContent = T.demoBanner;
    $("demo-banner").hidden = false;
  }
  $("login-form").addEventListener("submit", onLogin);
  $("logout-button").addEventListener("click", onLogout);
  $("search-input").addEventListener("input", onSearchInput);
  $("results").addEventListener("click", onResultClick);
  $("back-button").addEventListener("click", showSearch);
  $("member-mark-paid").addEventListener("click", markMemberPaid);
  $("member-resend-pass").addEventListener("click", resendMemberPass);
  $("member-edit-button").addEventListener("click", openEditMember);
  $("em-cancel").addEventListener("click", () => $("edit-member-dialog").close());
  $("edit-member-form").addEventListener("submit", onEditMemberSubmit);
  $("add-member-button").addEventListener("click", openAddMember);
  $("ma-method").addEventListener("change", syncAddMemberMethod);
  $("ma-cancel").addEventListener("click", () => $("member-add-dialog").close());
  $("member-add-form").addEventListener("submit", onAddMemberSubmit);

  if (state.token) showApp(); else showLogin();
}

// Run once every script has loaded (members.js and the tab files come after this one, and a saved sign-in calls into them straight away)
document.addEventListener("DOMContentLoaded", start);
