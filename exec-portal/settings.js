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

$("set-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const result = $("set-password-result");
  const fields = {};
  const pair = (a, b, key) => {
    if (!$(a).value && !$(b).value) return true;
    if ($(a).value !== $(b).value) { result.className = "error small"; result.textContent = T.setPwMismatch; return false; }
    fields[key] = $(a).value;
    return true;
  };
  if (!pair("set-exec-pw", "set-exec-pw2", "execPassword") || !pair("set-admin-pw", "set-admin-pw2", "adminPassword")) return;
  if ($("set-door-pw").value) fields.doorPassword = $("set-door-pw").value;
  if (!Object.keys(fields).length) { result.className = "muted small"; result.textContent = T.setNothing; return; }
  if ((fields.execPassword || fields.adminPassword) && !confirm(T.setPwConfirm)) return;
  const ok = await saveSettings(fields, "set-password-result", $("set-password-save"));
  if (ok) { ["set-exec-pw", "set-exec-pw2", "set-admin-pw", "set-admin-pw2", "set-door-pw"].forEach((id) => { $(id).value = ""; }); openSettingsTab(); }
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
