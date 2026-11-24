// CSS Exec Portal — API client, sign-in, session state, member search and profile.

// ?mode=scanner explicitly opens the stripped-down door scanner.
const PARAMS = new URLSearchParams(location.search);
const SCANNER_MODE = PARAMS.get("mode") === "scanner";

const state = {
  membershipFee: null,   // the fee saved in Settings, as the server last said
  token: sessionStorage.getItem("css_token") || "",
  name: sessionStorage.getItem("css_name") || "",
  role: sessionStorage.getItem("css_role") || "exec",
  results: []
};

const $ = (id) => document.getElementById(id);

// ---- Talking to the API -----------------------------------------------------

// Looking things up is safe to repeat, so a hiccup (Google being slow, a dropped connection) is retried
// quietly. Anything that changes data (mark paid, scan, edit…) is never repeated automatically.
const READ_ACTIONS = ["signInNames", "listEvents", "listOrders", "doorList", "eventSummary", "searchMembers", "getMember", "listRecentEmails"];
const REQUEST_TIMEOUT_MS = 35000;
const RETRY_PAUSE_MS = 1200;

// The panda shows in the middle when a request takes longer than a moment (and moves on to "taking a little longer" and
// "still working" the longer it waits). Door scans, searches-as-you-type and the keep-alive stay quiet, and so does the
// scanner phone page. Jobs that work through a list show "almost there" instead.
const QUIET_ACTIONS = ["signInNames", "ping", "scan", "doorList", "deskAlerts", "searchMembers", "getMember", "emailStatus", "listRecentEmails"];
const EMAIL_ACTIONS = ["markOrderPaid", "markOrdersPaid", "sendPendingEmails", "resendTickets", "addOrder", "sendReminders", "updateTicket", "offerWaitlistSpot", "emailAttendees", "applyTransfer", "markMemberPaid", "resendMemberPass", "addMember", "updateMember"];   // after these the email indicator is refreshed
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

/** opts.quiet: no panda (something is already on screen and this only freshens it). */
async function api(action, details = {}, opts = {}) {
  const quiet = SCANNER_MODE || QUIET_ACTIONS.includes(action) || !!opts.quiet;
  if (!quiet) pandaBusy(true, BATCH_ACTIONS.includes(action));
  try {
    const reply = await apiRequest(action, details);
    if (reply && reply.membershipFee !== undefined) state.membershipFee = reply.membershipFee;
    if (reply && reply.ok && EMAIL_ACTIONS.includes(action) && typeof refreshMailStatus === "function") refreshMailStatus(true);
    return reply;
  } finally { if (!quiet) pandaBusy(false); }
}

// Buttons that record money or registrations send an id for each press. The same press (same details) keeps its id until the
// server says it worked, so a retry or a second click after a dropped connection gets the saved answer instead of a duplicate.
const pendingPressIds = {};
function newRequestId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}
async function apiOnce(action, details = {}) {
  const key = action + JSON.stringify(details);
  const requestId = pendingPressIds[key] || (pendingPressIds[key] = newRequestId());
  const reply = await api(action, { ...details, requestId });
  // Done, or "check this order first": either way the next press is a new one (after checking, Finance records it afresh).
  if (reply && (reply.ok || reply.error === "NEEDS_REVIEW")) delete pendingPressIds[key];
  return reply;
}

async function apiRequest(action, details = {}) {
  const body = { action, token: state.token, ...(SCANNER_MODE ? { scanner: true } : {}), ...details };   // "scanner" lets the server count this page as a scanner phone
  if (!API_URL) {   // demo mode
    const demo = await MockApi.handle(body);
    setConnectionNotice(!demo.ok && demo.error === "NETWORK" ? "offline" : false);
    return demo;
  }
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
  // No connection at all: the warning stays up until a later request gets through.
  setConnectionNotice(!reply.ok && reply.error === "NETWORK" ? "offline" : false);
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

/** on: true = "trying again", "offline" = no connection (stays until something gets through), false = hide. */
function setConnectionNotice(on) {
  const box = $("connection-notice");
  if (!box) return;
  box.hidden = !on;
  if (on) box.innerHTML = pandaImg("error", "pl-inline") + pandaEsc(on === "offline" ? T.offlineNotice : T.reconnecting);
}

// ---- Kept on this device ----------------------------------------------------
// The last copy of Overview, Events and Tasks is kept in this browser (per person), so those pages show straight away
// next time and freshen quietly. Member details, payments and door lists are never kept. Signing out wipes it all.
const DEVICE_PREFIX = "css_keep_";
const DEVICE_MAX_DAYS = 14;

function deviceKey(name) {
  return DEVICE_PREFIX + String(state.name || "").trim().replace(/\s+/g, " ").toLowerCase() + "|" + name;
}

function deviceSave(name, data) {
  if (!state.name || SCANNER_MODE || state.role === "door") return;
  try { localStorage.setItem(deviceKey(name), JSON.stringify({ at: Date.now(), data })); } catch (e) { /* full or blocked: just not kept */ }
}

/** The kept copy, or null (none, too old, or unreadable). */
function deviceLoad(name) {
  if (!state.name || SCANNER_MODE || state.role === "door") return null;
  try {
    const kept = JSON.parse(localStorage.getItem(deviceKey(name)) || "null");
    if (!kept || Date.now() - kept.at > DEVICE_MAX_DAYS * 86400000) return null;
    return kept.data;
  } catch (e) { return null; }
}

/** Sign out: forget everything kept on this device (for everyone who used it). */
function deviceForgetAll() {
  try { Object.keys(localStorage).filter((k) => k.startsWith(DEVICE_PREFIX) || k.startsWith("css_outbox_")).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* nothing kept */ }
}

function errorText(reply) {
  return T.errors[reply.error] || reply.message || T.errors.DEFAULT;
}

// ---- Sign-in ----------------------------------------------------------------

// Search the active People list; names previously used on this computer aren't suggestions.
let peopleNames = [];
let peopleNamesAsked = false;
let peopleNamesLoading = false;
let peopleNamesFailed = false;
let peopleNamesGeneration = 0;
let signInMatches = [], signInActive = -1;
let signInNamesDismissed = false;
async function loadPeopleNames() {
  if (peopleNamesAsked) return;
  peopleNamesAsked = true;
  peopleNamesLoading = true;
  peopleNamesFailed = false;
  renderSignInNames();
  const generation = peopleNamesGeneration;
  try {
    const reply = await api("signInNames");
    if (generation !== peopleNamesGeneration) return;
    if (!reply.ok || !Array.isArray(reply.names)) throw new Error("Names unavailable");
    const names = reply.names.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim().replace(/\s+/g, " "));
    const seen = new Set();
    peopleNames = names.filter((n) => { const key = n.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  } catch (e) {
    if (generation !== peopleNamesGeneration) return;
    peopleNamesAsked = false;
    peopleNamesFailed = true;
  } finally {
    if (generation === peopleNamesGeneration) { peopleNamesLoading = false; renderSignInNames(); }
  }
}

function hideSignInNames() {
  $("name-list").hidden = true;
  $("name-status").hidden = true;
  $("name-input").setAttribute("aria-expanded", "false");
  $("name-input").removeAttribute("aria-activedescendant");
  signInMatches = [];
  signInActive = -1;
}

function renderSignInNames() {
  hideSignInNames();
  const input = $("name-input");
  const query = input.value.trim().replace(/\s+/g, " ").toLowerCase();
  if (signInNamesDismissed || $("login-view").hidden || document.activeElement !== input || query.length < 2) return;
  const score = (name) => name === query ? 0 : name.startsWith(query) ? 1 : name.split(" ").some((word) => word.startsWith(query)) ? 2 : 3;
  signInMatches = peopleNames.filter((name) => name.toLowerCase().includes(query))
    .sort((a, b) => score(a.toLowerCase()) - score(b.toLowerCase()) || a.localeCompare(b)).slice(0, 8);
  if (signInMatches.length) {
    $("name-list").innerHTML = signInMatches.map((name, i) => `<li id="name-option-${i}" role="option" aria-selected="false" data-index="${i}">${escapeHtml(name)}</li>`).join("");
    $("name-list").hidden = false;
    input.setAttribute("aria-expanded", "true");
  } else {
    $("name-status").textContent = peopleNamesLoading ? T.nameSearching : peopleNamesFailed ? T.nameSearchFailed : T.nameNoMatches;
    $("name-status").hidden = false;
  }
}

function onSignInNameInput() {
  signInNamesDismissed = false;
  renderSignInNames();
  if ($("name-input").value.trim().length >= 2) loadPeopleNames();
}

function pickSignInName(index) {
  const name = signInMatches[index];
  if (!name) return;
  $("name-input").value = name;
  hideSignInNames();
  $("password").focus();
}

function onSignInNameKeydown(event) {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    if (!$("name-list").hidden || !$("name-status").hidden) { event.preventDefault(); event.stopPropagation(); signInNamesDismissed = true; hideSignInNames(); }
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (peopleNamesLoading && $("name-input").value.trim().length >= 2) return;
    if (signInMatches.length) pickSignInName(signInActive < 0 ? 0 : signInActive);
    else if ($("name-input").value.trim()) $("password").focus();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if ($("name-list").hidden) { signInNamesDismissed = false; renderSignInNames(); }
    if (!signInMatches.length) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    signInActive = signInActive < 0 ? (step > 0 ? 0 : signInMatches.length - 1) : (signInActive + step + signInMatches.length) % signInMatches.length;
    document.querySelectorAll("#name-list [role=option]").forEach((option, i) => {
      option.classList.toggle("active", i === signInActive);
      option.setAttribute("aria-selected", String(i === signInActive));
      if (i === signInActive) option.scrollIntoView({ block: "nearest" });
    });
    $("name-input").setAttribute("aria-activedescendant", "name-option-" + signInActive);
  }
}

function showLogin(message) {
  $("app-view").hidden = true;
  $("login-view").hidden = false;
  setLoginError(message || "");
  try { localStorage.removeItem("css_names"); } catch (e) { /* old saved names are no longer used */ }
  $("name-input").value = "";
  signInNamesDismissed = false;
  hideSignInNames();
  $("name-input").focus();
  loadPeopleNames();
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
  $("password").value = "";
  if (reply.needsPasswordSetup) return openExecPasswordSetup(reply);
  completeSignIn(reply, action);
}

function completeSignIn(reply, action) {
  state.token = reply.token;
  state.name = reply.name;
  state.role = reply.role || "exec";
  sessionStorage.setItem("css_token", state.token);
  sessionStorage.setItem("css_name", state.name);
  sessionStorage.setItem("css_role", state.role);
  $("password").value = "";
  if (action === "loginDoor" && !SCANNER_MODE) { location.replace("?mode=scanner"); return; }   // door sign-ins use the scanner page
  showApp();
  // Signed in again while Tasks was already the open tab: load it now (and send any changes waiting on this device).
  if (typeof loadTasks === "function" && !$("tab-tasks").hidden) loadTasks();
}

async function onLogout() {
  // Task changes still waiting to be sent would be lost: ask first.
  const waiting = typeof outboxCount === "function" ? outboxCount() : 0;
  if (waiting && !(await askConfirm(T.signOutUnsent(waiting), T.signOutAnyway))) return;
  await api("logout");
  signOutLocally();
  deviceForgetAll();
  showLogin();
}

function signOutLocally() {
  if (typeof stopCamera === "function") stopCamera();
  if (typeof doorState !== "undefined") clearInterval(doorState.refreshTimer);
  if (typeof deskAlertState !== "undefined") clearInterval(deskAlertState.timer);
  peopleNamesGeneration++;
  peopleNames = [];
  peopleNamesAsked = false;
  peopleNamesLoading = false;
  peopleNamesFailed = false;
  state.token = "";
  state.name = "";
  sessionStorage.removeItem("css_token");
  sessionStorage.removeItem("css_name");
  sessionStorage.removeItem("css_role");
  sessionStorage.removeItem("css_tab");
}

// ---- Member search ----------------------------------------------------------

function showApp() {
  hideSignInNames();
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  $("who-name").textContent = state.name;
  $("admin-badge").hidden = state.role !== "admin";
  $("full-portal-link").hidden = state.role === "door" || !SCANNER_MODE;
  $("settings-tab-button").hidden = state.role !== "admin";
  $("activity-tab-button").hidden = state.role !== "admin";
  $("admin-nav-label").hidden = state.role !== "admin";
  $("who-avatar").textContent = state.name.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  showSearch();
  if (typeof startMailStatus === "function") startMailStatus();
  // Phones open Tasks. The scanner link and door-only sessions deliberately open Door.
  // (The tab code loads after this file, so on first load wait until every script has run.)
  let landing = SCANNER_MODE || state.role === "door" ? "door" : isPhone() ? "tasks" : "overview";
  // A refresh keeps you where you were (same browser tab): the last tab is remembered for this sign-in.
  try {
    const saved = sessionStorage.getItem("css_tab");
    const button = saved && document.querySelector('.tab[data-tab="' + saved + '"]');
    if (!SCANNER_MODE && !isPhone() && state.role !== "door" && button && !button.hidden) landing = saved;
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
  renderMemberSignupAnswers(m);

  // Someone who signed up on the website and hasn't been confirmed yet: one tap to mark the payment received.
  state.member = m;
  loadMemberHistory(m);
  loadMemberRedemptions(m);
  loadMemberNotes(m);
  $("member-pay").hidden = m.paid || !m.memberId;
  $("member-assign").hidden = !!m.memberId || m.row === undefined;   // a row with no member ID yet: give it one first
  $("member-assign-error").hidden = true;
  $("member-assign-id").disabled = false;
  $("member-edit-button").hidden = !m.memberId;
  $("member-resend-pass").hidden = !(m.memberId && m.email && m.paid);
  $("member-resend-pass").disabled = false;
  $("member-resend-pass").textContent = T.resendPass;
  $("member-pay-error").hidden = true;
  $("member-mark-paid").disabled = false;
  $("member-mark-paid").textContent = T.memberMarkPaid(state.membershipFee);
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
  $("ma-paid-label").textContent = T.maPaidNow(state.membershipFee);
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
    button.textContent = T.memberMarkPaid(state.membershipFee);
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
  Object.assign(m, { cardSent: true, mailStatus: "Sent" });
  const listed = allState.members.find((x) => x.memberId === m.memberId);
  if (listed) Object.assign(listed, { cardSent: true, mailStatus: "Sent" });
  allState.stale = true;
  // Only the badges change: redrawing the whole page would wipe a note someone is halfway through typing
  if (state.member === m) $("member-badges").innerHTML = paidPill(m) + `<span class="pill good">${T.cardSent}</span>`;
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
  $("search-status").textContent = T.searchHint;
  document.title = T.appTitle;
}

function start() {
  // A door-only sign-in belongs on the scanner page (it can only scan), whichever page it started on.
  if (!SCANNER_MODE && state.token && state.role === "door") { location.replace("?mode=scanner"); return; }
  fillText();
  document.body.classList.toggle("scanner-mode", SCANNER_MODE);
  // Door volunteers sign in with their name (and the door password if one is set): on phones and the scanner link only.
  if (SCANNER_MODE || isPhone()) {
    $("door-login-button").hidden = false;
    $("door-login-button").addEventListener("click", onDoorLogin);
  }
  if (SCANNER_MODE) {
    $("brand").textContent = T.scannerTitle;
    $("full-portal-link").hidden = false;
    document.title = T.scannerTitle;
  }
  document.body.classList.toggle("phone", isPhone());
  if (!API_URL) {
    $("demo-banner").textContent = T.demoBanner;
    $("demo-banner").hidden = false;
  }
  $("login-form").addEventListener("submit", onLogin);
  $("name-input").addEventListener("input", onSignInNameInput);
  $("name-input").addEventListener("focus", onSignInNameInput);
  $("name-input").addEventListener("blur", hideSignInNames);
  $("name-input").addEventListener("keydown", onSignInNameKeydown);
  $("name-list").addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-index]")) event.preventDefault(); // keep focus until the click selects a name
  });
  $("name-list").addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");
    if (option) pickSignInName(Number(option.dataset.index));
  });
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
