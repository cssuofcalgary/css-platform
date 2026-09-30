// CSS Exec Portal v0.1 — sign in, search members, view a member. Read-only.

const state = {
  token: sessionStorage.getItem("css_token") || "",
  name: sessionStorage.getItem("css_name") || "",
  role: sessionStorage.getItem("css_role") || "exec",
  results: []
};

const $ = (id) => document.getElementById(id);

// ---- Talking to the API -----------------------------------------------------

async function api(action, details = {}) {
  const body = { action, token: state.token, ...details };
  if (!API_URL) return MockApi.handle(body);   // demo mode
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      // text/plain avoids a browser pre-check that Apps Script can't answer
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: "NETWORK" };
  }
}

function errorText(reply) {
  return T.errors[reply.error] || reply.message || T.errors.DEFAULT;
}

// ---- Sign-in ----------------------------------------------------------------

function showLogin(message) {
  $("app-view").hidden = true;
  $("login-view").hidden = false;
  setLoginError(message || "");
  $("password").focus();
}

function setLoginError(text) {
  $("login-error").textContent = text;
  $("login-error").hidden = !text;
}

async function onLogin(event) {
  event.preventDefault();
  const name = $("name-input").value;
  const button = $("login-button");
  button.disabled = true;
  button.textContent = T.signingIn;

  const reply = await api("login", { password: $("password").value, name });

  button.disabled = false;
  button.textContent = T.signIn;
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
}

// ---- Member search ----------------------------------------------------------

function showApp() {
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  $("who-name").textContent = state.name;
  $("admin-badge").hidden = state.role !== "admin";
  showSearch();
  $("search-input").focus();
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
      <button class="result" data-index="${i}">
        <span>
          <span class="name">${escapeHtml(m.name)}</span><br>
          <span class="sub">${escapeHtml(m.memberId || T.noId)}${m.ucid ? " · " + escapeHtml(m.ucid) : ""}</span>
        </span>
        ${paidPill(m)}
      </button>
    </li>`).join("");
}

function onResultClick(event) {
  const button = event.target.closest(".result");
  if (button) showMember(state.results[Number(button.dataset.index)]);
}

// ---- Member page ------------------------------------------------------------

function showMember(m) {
  $("search-view").hidden = true;
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
    [T.fieldPayWhen, formatDate(m.payment.when)],
    [T.fieldPayWhere, m.payment.where],
    [T.fieldPayWho, m.payment.who]
  ].filter(([, value]) => value);

  $("member-fields").innerHTML = rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
  window.scrollTo(0, 0);
}

function showSearch() {
  $("member-view").hidden = true;
  $("search-view").hidden = false;
}

// ---- Helpers ----------------------------------------------------------------

function paidPill(m) {
  return `<span class="pill ${m.paid ? "good" : "warn"}">${m.paid ? T.paid : T.unpaid}</span>`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;   // not a date: show as typed
  return date.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Start ------------------------------------------------------------------

function fillText() {
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = T[el.dataset.t]; });
  $("search-input").placeholder = T.searchPlaceholder;
  $("name-input").placeholder = T.namePlaceholder;
  $("pay-search").placeholder = T.paySearchPlaceholder;
  $("search-status").textContent = T.searchHint;
  document.title = T.appTitle;
}

function start() {
  fillText();
  if (!API_URL) {
    $("demo-banner").textContent = T.demoBanner;
    $("demo-banner").hidden = false;
  }
  $("login-form").addEventListener("submit", onLogin);
  $("logout-button").addEventListener("click", onLogout);
  $("search-input").addEventListener("input", onSearchInput);
  $("results").addEventListener("click", onResultClick);
  $("back-button").addEventListener("click", showSearch);

  if (state.token) showApp(); else showLogin();
}

start();
