// CSS Exec Portal — Settings tab (admin only): passwords, e-transfer and contact details,
// the Membership sheet, sign everyone out, and a health check.

async function openSettingsTab() {
  $("set-status").textContent = T.setLoading;
  showSettingsPane((function () { try { return sessionStorage.getItem("css_set_pane"); } catch (e) { return ""; } })() || "general");
  const reply = await api("getSettings");
  if (!reply.ok) return handleEventError(reply, $("set-status"));
  const s = reply.settings;
  $("people-locked").checked = !!s.peopleLocked;
  $("people-locked").disabled = false;
  $("set-status").textContent = "";
  $("set-etransfer").value = s.etransferEmail;
  $("set-contact").value = s.contactEmail;
  $("set-instagram").value = s.instagramUrl;
  $("set-sheet").value = s.membershipSheetId;
  $("set-tab").value = s.membershipTab;
  $("set-year").value = s.membershipYear || "";
  $("set-year").placeholder = T.setYearPlaceholder;
  $("set-fee").value = s.membershipFee;
  $("set-pw-note").textContent = T.setPwNote(s.execPasswordSet, s.adminPasswordSet);
  ["set-exec-pw", "set-exec-pw2", "set-admin-pw", "set-admin-pw2"].forEach((id) => { $(id).value = ""; });
  $("set-door-note").textContent = s.doorPasswordSet ? T.setDoorNoteSet : T.setDoorNoteNone;
  $("set-door-clear").hidden = !s.doorPasswordSet;
  $("set-door-pw").value = "";
  $("set-site").textContent = s.publicSiteUrl ? T.setSiteUrl(s.publicSiteUrl) : "";
  showCardSettings(s);
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

// ---- Card payments (Square): the token is never shown; a blank box keeps the saved one ----

function showCardSettings(s) {
  $("set-card-note").textContent = !s.squareConfigured ? T.setCardNoteOff : s.squareEnvironment === "sandbox" ? T.setCardNoteTest : T.setCardNoteOn;
  $("set-card-env").value = s.squareEnvironment === "sandbox" ? "sandbox" : "production";
  $("set-card-location").value = s.squareLocationId || "";
  $("set-card-token").value = "";
  $("set-card-token").placeholder = s.squareTokenSet ? T.setCardTokenSaved : "";
  $("set-card-token").dataset.saved = s.squareTokenSet ? "1" : "";
  const passFee = s.squareEnvironment === "sandbox" && s.squarePassFee === true;
  $("set-card-pass-fee").checked = passFee;
  $("set-card-fee-pct").value = s.squareFeePercent !== undefined ? s.squareFeePercent : 2.9;
  $("set-card-fee-fixed").value = s.squareFeeFixed !== undefined ? Number(s.squareFeeFixed).toFixed(2) : "0.30";
  updateCardFeeFields();
  $("set-card-off").hidden = !s.squareConfigured && !s.squareTokenSet && !s.squareLocationId;
}

function updateCardFeeFields() {
  const sandbox = $("set-card-env").value === "sandbox";
  if (!sandbox) $("set-card-pass-fee").checked = false;
  $("set-card-fee-toggle").hidden = !sandbox;
  $("set-card-fee-fields").hidden = !sandbox || !$("set-card-pass-fee").checked;
}

$("set-card-env").addEventListener("change", updateCardFeeFields);
$("set-card-pass-fee").addEventListener("change", updateCardFeeFields);

$("set-card-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const result = $("set-card-result");
  if (!$("set-card-token").value.trim() && !$("set-card-token").dataset.saved) {
    result.className = "error small";
    result.textContent = T.setCardNeedToken;
    return;
  }
  const passFee = $("set-card-env").value === "sandbox" && $("set-card-pass-fee").checked;
  const fields = {
    squareEnvironment: $("set-card-env").value,
    squareLocationId: $("set-card-location").value.trim(),
    squarePassFee: passFee
  };
  if (passFee) {
    fields.squareFeePercent = $("set-card-fee-pct").value.trim();
    fields.squareFeeFixed = $("set-card-fee-fixed").value.trim();
  }
  if ($("set-card-token").value.trim()) fields.squareAccessToken = $("set-card-token").value.trim();
  if (await saveSettings(fields, "set-card-result", $("set-card-save"))) {
    const msg = result.textContent;
    await openSettingsTab();
    result.className = "good-text small";
    result.textContent = msg;
  }
});

$("set-card-off").addEventListener("click", async () => {
  if (!(await askConfirm(T.setCardOffConfirm))) return;
  if (await saveSettings({ clearSquare: true }, "set-card-result", $("set-card-off"))) {
    const msg = $("set-card-result").textContent;
    await openSettingsTab();
    $("set-card-result").className = "good-text small";
    $("set-card-result").textContent = msg;
  }
});

$("set-membership-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveSettings({ membershipSheet: $("set-sheet").value, membershipTab: $("set-tab").value, membershipYear: $("set-year").value, membershipFee: $("set-fee").value }, "set-membership-result", $("set-membership-save"));
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
  if (kind !== "door" && !(await askConfirm(T.setPwConfirm))) return;
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
  if (!(await askConfirm(T.setDoorClearConfirm))) return;
  if (await saveSettings({ clearDoorPassword: true }, "set-password-result", $("set-door-clear"))) openSettingsTab();
});

$("set-signout-all").addEventListener("click", async () => {
  if (!(await askConfirm(T.setSignOutConfirm))) return;
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
  if (name === "people") loadPeople();
}
$("set-nav").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-sub]");
  if (b) showSettingsPane(b.dataset.sub);
});

// ---- System health: run it by hand; every run is written to Activity ----

function healthTile(ok, name, detail, warning = false) {
  return `<div class="hc ${ok ? "ok" : warning ? "" : "bad"}"><span class="pill ${ok ? "good" : "warn"}">${ok ? T.setOk : warning ? T.setWarning : T.setProblem}</span><b>${escapeHtml(name)}</b><small>${escapeHtml(detail)}</small></div>`;
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
      ${reply.checks.map((c) => healthTile(c.ok, c.name, c.detail, c.warning)).join("")}
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

// ---- People: the one list of names used for signing in and for "Who" on tasks. Each change saves straight away. ----

const PEOPLE_DEPTS = () => (typeof TASK_DEPTS !== "undefined" ? TASK_DEPTS : ["Events", "Marketing", "Internal", "External", "Finance", "General"]);
const peopleActive = (v) => !(v === false || v === 0 || /^(false|no|0)$/i.test(String(v)));

function personRowHtml(p) {
  const dept = String(p.department || "");
  const depts = PEOPLE_DEPTS();
  return `<div class="people-row" data-id="${escapeHtml(p.id || "")}">
    <input class="people-name" maxlength="60" autocomplete="off" autocapitalize="words" aria-label="${escapeHtml(T.teamName)}" value="${escapeHtml(p.name || "")}">
    <select class="people-dept" aria-label="${escapeHtml(T.teamDept)}"><option value="">${escapeHtml(T.peopleNoDept)}</option>${depts.map((d) => `<option${d === dept ? " selected" : ""}>${escapeHtml(d)}</option>`).join("")}</select>
    <input class="people-discord" inputmode="numeric" maxlength="20" autocomplete="off" aria-label="${escapeHtml(T.teamDiscord)}" placeholder="${escapeHtml(T.teamDiscord)}" value="${escapeHtml(p.discordId || "")}">
    <input type="checkbox" class="toggle people-active" aria-label="${escapeHtml(T.teamActive)}"${peopleActive(p.active) ? " checked" : ""}>
    <button type="button" class="secondary small-button people-reset"${p.passwordSet ? "" : " disabled"}>${escapeHtml(p.passwordSet ? T.peopleReset : T.peoplePasswordNotSet)}</button>
    <button type="button" class="icon-btn people-remove" title="${escapeHtml(T.peopleRemove)}" aria-label="${escapeHtml(T.peopleRemove)}"><svg><use href="#i-x"/></svg></button>
  </div>`;
}

function peopleSay(text, kind) {
  $("people-result").className = (kind === "error" ? "error" : kind === "good" ? "good-text" : "muted") + " small";
  $("people-result").textContent = text || "";
}

function peopleFail(reply) {
  if (reply.error === "NOT_LOGGED_IN") return handleEventError(reply, $("people-result"));
  peopleSay(errorText(reply), "error");
}

function renderPeople(team) {
  $("people-list").innerHTML = team.length ? team.map(personRowHtml).join("") : `<p class="muted small people-none">${escapeHtml(T.peopleNone)}</p>`;
}

/** Keeps the Tasks page's list of people in step with what was just saved here. */
function sharePeople(team) {
  if (Array.isArray(team) && typeof taskState !== "undefined") taskState.team = team;
}

async function loadPeople() {
  peopleSay(T.peopleLoading);
  const reply = await api("listTasks");
  if (!reply.ok) return handleEventError(reply, $("people-result"));
  peopleSay("");
  sharePeople(reply.team || []);
  renderPeople(reply.team || []);
  const bot = await api("taskBotStatus");
  $("people-bot").hidden = !bot.ok;
  if (bot.ok) $("people-bot").textContent = T.teamBot(bot);
}

/**
 * Saves one row. Only one save per row runs at a time: a change made while it is saving waits, then one more save sends
 * the row as it is by then (with the id the first save got back, so a new person is never added twice).
 */
const peopleSaving = new WeakMap();   // row → { done: Promise, again: bool }
function savePersonRow(row) {
  const busy = peopleSaving.get(row);
  if (busy) { busy.again = true; return busy.done; }
  const job = { again: false };
  job.done = (async () => {
    try {
      do { job.again = false; await savePersonRowNow(row); } while (job.again);
    } finally {
      peopleSaving.delete(row);
    }
  })();
  peopleSaving.set(row, job);
  return job.done;
}

async function savePersonRowNow(row) {
  if (!row.isConnected) return;
  const name = row.querySelector(".people-name").value.trim().replace(/\s+/g, " ");
  const discordInput = row.querySelector(".people-discord");
  const discordId = discordInput.value.replace(/\s+/g, "");
  if (!name) {
    if (row.dataset.id) { row.querySelector(".people-name").focus(); peopleSay(T.peopleNameNeeded, "error"); }
    return;   // a new row with no name yet is simply not saved
  }
  if (discordId && !/^\d{17,20}$/.test(discordId)) { discordInput.focus(); return peopleSay(T.teamBadDiscord(name), "error"); }
  const person = { id: row.dataset.id || "", name, department: row.querySelector(".people-dept").value, discordId, active: row.querySelector(".people-active").checked };
  row.classList.add("saving");
  const reply = await api("savePerson", { person });
  row.classList.remove("saving");
  if (!reply.ok) return peopleFail(reply);
  if (reply.person && reply.person.id) row.dataset.id = reply.person.id;
  row.querySelector(".people-name").value = (reply.person && reply.person.name) || name;
  discordInput.value = discordId;
  sharePeople(reply.team);
  peopleSay(T.peopleSaved((reply.person && reply.person.name) || name), "good");
}

$("people-list").addEventListener("change", (e) => {
  const row = e.target.closest(".people-row");
  if (row) savePersonRow(row);
});
// Enter in a box saves that row (the change event follows from leaving the box).
$("people-list").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input:not([type=checkbox])")) { e.preventDefault(); e.target.blur(); }
});
$("people-list").addEventListener("click", async (e) => {
  const reset = e.target.closest(".people-reset");
  if (reset) {
    const row = reset.closest(".people-row");
    if (peopleSaving.get(row)) await peopleSaving.get(row).done;
    const name = row.querySelector(".people-name").value.trim();
    if (!(await askConfirm(T.peopleResetConfirm(name), T.peopleReset))) return;
    reset.disabled = true;
    const reply = await api("resetPersonPassword", { id: row.dataset.id });
    if (!reply.ok) { reset.disabled = false; return peopleFail(reply); }
    reset.textContent = T.peoplePasswordNotSet;
    sharePeople(reply.team);
    peopleSay(T.peopleResetDone(name), "good");
    return;
  }
  const b = e.target.closest(".people-remove");
  if (!b) return;
  const row = b.closest(".people-row");
  const name = row.querySelector(".people-name").value.trim();
  if (peopleSaving.get(row)) await peopleSaving.get(row).done;   // a new person still being saved gets their id first
  if (!row.dataset.id) { row.remove(); return peopleSay(""); }   // never saved: just take the row away
  if (!(await askConfirm(T.peopleRemoveConfirm(name), T.peopleRemove))) return;
  b.disabled = true;
  const reply = await api("removePerson", { id: row.dataset.id });
  b.disabled = false;
  if (!reply.ok) return peopleFail(reply);
  row.remove();
  sharePeople(reply.team);
  if (Array.isArray(reply.team) && !reply.team.length) renderPeople([]);
  peopleSay(T.peopleRemoved(name), "good");
});
$("people-add").addEventListener("click", () => {
  const none = $("people-list").querySelector(".people-none");
  if (none) none.remove();
  $("people-list").insertAdjacentHTML("afterbegin", personRowHtml({ active: true }));
  $("people-list").firstElementChild.querySelector(".people-name").focus();
});

$("people-locked").addEventListener("change", async () => {
  const toggle = $("people-locked");
  const locked = toggle.checked;
  toggle.disabled = true;
  const reply = await api("saveSettings", { settings: { peopleLocked: locked } });
  toggle.disabled = false;
  if (!reply.ok) {
    toggle.checked = !locked;
    return handleEventError(reply, $("people-lock-result"));
  }
  $("people-lock-result").textContent = locked ? T.peopleLockSaved : T.peopleUnlockSaved;
});

// Preview first. The server checks every row and skips existing names again when Add is pressed.
let peopleImportText = "", peopleImportRequest = 0;
$("people-paste").addEventListener("click", async () => {
  await Promise.all(Array.from($("people-list").querySelectorAll(".people-row"), (row) => peopleSaving.get(row)?.done));
  $("people-paste-text").value = "";
  $("people-paste-text").placeholder = T.peoplePastePlaceholder;
  $("people-import-preview").hidden = true;
  $("people-import-result").textContent = "";
  $("people-import-save").disabled = true;
  peopleImportText = "";
  $("people-import-dialog").showModal();
  $("people-paste-text").focus();
});
$("people-paste-text").addEventListener("input", () => {
  peopleImportRequest++;
  peopleImportText = "";
  $("people-import-preview").hidden = true;
  $("people-import-result").textContent = "";
  $("people-import-save").disabled = true;
});
$("people-import-review").addEventListener("click", async () => {
  const text = $("people-paste-text").value;
  const request = ++peopleImportRequest;
  $("people-import-review").disabled = true;
  $("people-import-save").disabled = true;
  const reply = await api("previewPeopleImport", { text });
  $("people-import-review").disabled = false;
  if (request !== peopleImportRequest || !$("people-import-dialog").open) return;
  if (!reply.ok) return peopleImportFail(reply);
  peopleImportText = text;
  $("people-import-preview").innerHTML = `<ul class="plain-list">${reply.rows.map((p) =>
    `<li class="people-import-row"><span>${escapeHtml(p.name)}${p.department ? " · " + escapeHtml(p.department) : ""}</span><span class="muted small">${escapeHtml(p.add ? T.peopleImportAdd : T.peopleImportSkip)}</span></li>`).join("")}</ul>`;
  $("people-import-preview").hidden = false;
  $("people-import-result").className = "muted small";
  $("people-import-result").textContent = T.peopleImportSummary(reply.added, reply.skipped);
  $("people-import-save").disabled = !reply.added;
});
function peopleImportFail(reply) {
  if (reply.error === "NOT_LOGGED_IN") $("people-import-dialog").close();
  handleEventError(reply, $("people-import-result"));
}
$("people-import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const save = $("people-import-save");
  if (save.disabled || !peopleImportText || peopleImportText !== $("people-paste-text").value) return;
  save.disabled = $("people-import-review").disabled = $("people-import-cancel").disabled = $("people-paste-text").disabled = true;
  save.textContent = T.peopleImportAdding;
  const reply = await api("importPeople", { text: peopleImportText });
  $("people-import-review").disabled = $("people-import-cancel").disabled = $("people-paste-text").disabled = false;
  save.textContent = T.peopleImport;
  if (!reply.ok) { save.disabled = false; return peopleImportFail(reply); }
  sharePeople(reply.team);
  renderPeople(reply.team || []);
  $("people-import-dialog").close();
  peopleSay(T.peopleImportDone(reply.added, reply.skipped), "good");
});
$("people-import-cancel").addEventListener("click", () => $("people-import-dialog").close());
$("people-import-dialog").addEventListener("cancel", (event) => { if ($("people-paste-text").disabled) event.preventDefault(); });
$("people-import-dialog").addEventListener("close", () => { peopleImportRequest++; });
