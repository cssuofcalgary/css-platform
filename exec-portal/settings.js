// CSS Exec Portal — Settings tab (admin only): passwords, e-transfer and contact details,
// the Membership sheet, sign everyone out, and a health check.

async function openSettingsTab() {
  $("set-status").textContent = T.setLoading;
  showSettingsPane((function () { try { return sessionStorage.getItem("css_set_pane"); } catch (e) { return ""; } })() || "general");
  const reply = await api("getSettings");
  if (!reply.ok) return handleEventError(reply, $("set-status"));
  const s = reply.settings;
  $("set-status").textContent = "";
  $("set-etransfer").value = s.etransferEmail;
  $("set-contact").value = s.contactEmail;
  $("set-instagram").value = s.instagramUrl;
  $("set-sheet").value = s.membershipSheetId;
  $("set-tab").value = s.membershipTab;
  $("set-pw-note").textContent = T.setPwNote(s.execPasswordSet, s.adminPasswordSet);
  ["set-exec-pw", "set-exec-pw2", "set-admin-pw", "set-admin-pw2"].forEach((id) => { $(id).value = ""; });
  $("set-door-note").textContent = s.doorPasswordSet ? T.setDoorNoteSet : T.setDoorNoteNone;
  $("set-door-clear").hidden = !s.doorPasswordSet;
  $("set-door-pw").value = "";
  $("set-site").textContent = s.publicSiteUrl ? T.setSiteUrl(s.publicSiteUrl) : "";
  if (typeof openEmailsCard === "function") openEmailsCard();
}

/** Sends only what this form owns; shows the result under the form. */
async function saveSettings(fields, resultId, button) {
  const result = $(resultId);
  result.className = "muted small";
  result.textContent = T.editSaving;
  button.disabled = true;
  const reply = await api("saveSettings", { settings: fields });
  button.disabled = false;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") return handleEventError(reply, result);
    result.className = "error small";
    result.textContent = errorText(reply);
    return false;
  }
  if (reply.token) {   // passwords changed: everyone was signed out, we keep a fresh session
    state.token = reply.token;
    sessionStorage.setItem("css_token", state.token);
  }
  result.className = "good-text small";
  result.textContent = reply.changed.length
    ? T.setSaved(reply.changed.join(", ")) + (reply.message ? " " + reply.message : "") + (reply.signedOutEveryone ? " " + T.setEveryoneOut : "")
    : T.setNothing;
  return true;
}

$("set-general-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveSettings({ etransferEmail: $("set-etransfer").value, contactEmail: $("set-contact").value, instagramUrl: $("set-instagram").value },
    "set-general-result", $("set-general-save"));
});

$("set-membership-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveSettings({ membershipSheet: $("set-sheet").value, membershipTab: $("set-tab").value }, "set-membership-result", $("set-membership-save"));
});

// ---- Security: each password is a row; Change opens its boxes right there ----

const CRED_INPUTS = { exec: ["set-exec-pw", "set-exec-pw2"], admin: ["set-admin-pw", "set-admin-pw2"], door: ["set-door-pw"] };

function closeCredEditors() {
  document.querySelectorAll("#set-password-form .cred-edit").forEach((e) => { e.hidden = true; });
  Object.values(CRED_INPUTS).flat().forEach((id) => { $(id).value = ""; });
  $("set-password-result").textContent = "";
}

function openCredEditor(kind) {
  closeCredEditors();
  const box = document.querySelector(`#set-password-form [data-cred="${kind}"] .cred-edit`);
  box.hidden = false;
  box.querySelectorAll("input").forEach((el) => { el.placeholder = T[el.dataset.ph] || ""; });
  $(CRED_INPUTS[kind][0]).focus();
}

async function saveCredential(kind) {
  const result = $("set-password-result");
  const [first, again] = CRED_INPUTS[kind];
  const fail = (text) => { result.className = "error small"; result.textContent = text; };
  if (!$(first).value) return fail(T.secNeedPw);
  if (again && $(first).value !== $(again).value) return fail(T.setPwMismatch);
  const fields = { [kind === "exec" ? "execPassword" : kind === "admin" ? "adminPassword" : "doorPassword"]: $(first).value };
  if (kind !== "door" && !confirm(T.setPwConfirm)) return;
  const button = document.querySelector(`#set-password-form [data-save="${kind}"]`);
  const ok = await saveSettings(fields, "set-password-result", button);
  if (ok) { const msg = $("set-password-result").textContent; await openSettingsTab(); closeCredEditors(); $("set-password-result").className = "good-text small"; $("set-password-result").textContent = msg; }
}

$("set-password-form").addEventListener("click", (e) => {
  const change = e.target.closest("[data-change]");
  if (change) return openCredEditor(change.dataset.change);
  const cancel = e.target.closest("[data-cancel]");
  if (cancel) return closeCredEditors();
  const save = e.target.closest("[data-save]");
  if (save) saveCredential(save.dataset.save);
});
// Enter inside a box saves that row
$("set-password-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const open = document.querySelector("#set-password-form .cred-edit:not([hidden])");
  if (open) saveCredential(open.closest(".cred").dataset.cred);
});

$("set-door-clear").addEventListener("click", async () => {
  if (!confirm(T.setDoorClearConfirm)) return;
  if (await saveSettings({ clearDoorPassword: true }, "set-password-result", $("set-door-clear"))) openSettingsTab();
});

$("set-signout-all").addEventListener("click", async () => {
  if (!confirm(T.setSignOutConfirm)) return;
  const button = $("set-signout-all");
  button.disabled = true;
  const reply = await api("signOutAll");
  button.disabled = false;
  if (!reply.ok) return handleEventError(reply, $("set-signout-result"));
  state.token = reply.token;
  sessionStorage.setItem("css_token", state.token);
  $("set-signout-result").textContent = T.setEveryoneOut;
});

// ---- Sections (General / Membership / Security / Emails / Sessions / System health) ----

function showSettingsPane(name) {
  document.querySelectorAll("#set-nav [data-sub]").forEach((b) => b.classList.toggle("on", b.dataset.sub === name));
  document.querySelectorAll("#tab-settings [data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== name; });
  try { sessionStorage.setItem("css_set_pane", name); } catch (e) { /* fine */ }
  if (name === "health") loadHealthHistory();
  if (name === "sessions") loadSessions();
}
$("set-nav").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-sub]");
  if (b) showSettingsPane(b.dataset.sub);
});

// ---- System health: run it by hand; every run is written to Activity ----

function healthTile(ok, name, detail) {
  return `<div class="hc ${ok ? "ok" : "bad"}"><span class="pill ${ok ? "good" : "warn"}">${ok ? T.setOk : T.setProblem}</span><b>${escapeHtml(name)}</b><small>${escapeHtml(detail)}</small></div>`;
}

async function loadHealthHistory() {
  const list = $("set-health-history");
  const reply = await api("activityLog", { filters: { eventId: "", who: "", group: "settings", query: "health", limit: 8 } });
  if (!reply.ok) return handleEventError(reply, list);
  list.innerHTML = reply.entries.length ? reply.entries.map((e) => {
    const when = new Date(e.time);
    const clock = isNaN(when) ? escapeHtml(e.time) : when.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<li><span class="muted">${clock}</span> · <strong>${escapeHtml(e.who)}</strong> ${escapeHtml(e.summary)}</li>`;
  }).join("") : `<li class="muted small">${T.setHealthNone}</li>`;
}

$("set-health-button").addEventListener("click", async () => {
  const box = $("set-health-result");
  const button = $("set-health-button");
  button.disabled = true;
  box.innerHTML = `<div class="state"><span class="spin"></span>${T.setChecking}</div>`;
  const reply = await api("healthCheck");
  button.disabled = false;
  if (!reply.ok) { box.innerHTML = ""; return handleEventError(reply, box); }
  const err = reply.lastError;
  box.innerHTML = `<div class="health-grid">
      <div class="hc"><small>${T.healthVersion}</small><b class="mono">${escapeHtml(reply.version)}</b></div>
      ${reply.checks.map((c) => healthTile(c.ok, c.name, c.detail)).join("")}
      ${healthTile(!!reply.setup.publicSiteUrl, T.healthSite, reply.setup.publicSiteUrl || T.setNoSiteUrl)}
      ${healthTile(!err, T.healthLastError, err ? `${shortTime(err.time)} · ${err.action} · ${err.message}` : T.setNoError)}
    </div>`;
  loadHealthHistory();
});

// ---- Online now: who is signed in, and a way to sign one device out ----

function ago(ms) {
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return sec < 5 ? T.justNow : T.secondsAgo(sec);
}

async function loadSessions() {
  const reply = await api("getSettings");
  if (!reply.ok) return handleEventError(reply, $("set-sessions-result"));
  const roleName = { admin: T.roleAdminName, exec: T.roleExecName, door: T.roleScannerName, scanner: T.roleScannerName };
  const list = reply.activeSessions || [];
  $("set-sessions-list").innerHTML = list.length ? list.map((x) => `
    <li class="sess">
      <div><strong>${escapeHtml(x.name)}</strong> ${x.thisDevice ? `<span class="pill good">${T.thisDevice}</span>` : ""}
        <small>${escapeHtml(roleName[x.role] || x.role)} · ${ago(x.lastSeen)}</small></div>
      ${x.thisDevice ? "" : `<button class="secondary small-button" type="button" data-kick="${escapeHtml(x.id)}" data-name="${escapeHtml(x.name)}">${T.kickSignOut}</button>`}
    </li>`).join("") : `<li class="muted small">${T.setNobodyOnline}</li>`;
}

$("set-sessions-list").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-kick]");
  if (!b) return;
  b.disabled = true;
  const reply = await api("kickSession", { tokenToKick: b.dataset.kick });   // the public id from the list, never a real token
  if (!reply.ok && reply.error !== "NOT_FOUND") { b.disabled = false; return handleEventError(reply, $("set-sessions-result")); }
  $("set-sessions-result").textContent = reply.ok ? T.kickedDone(b.dataset.name) : "";
  loadSessions();
});
$("set-sessions-refresh").addEventListener("click", loadSessions);
