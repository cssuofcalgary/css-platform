// CSS Exec Portal — Settings tab (admin only): passwords, e-transfer and contact details,
// the Membership sheet, sign everyone out, and a health check.

async function openSettingsTab() {
  $("set-status").textContent = T.setLoading;
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

$("set-health-button").addEventListener("click", async () => {
  const box = $("set-health-result");
  $("set-health-button").disabled = true;
  box.innerHTML = `<p class="muted small">${T.setChecking}</p>`;
  const reply = await api("healthCheck");
  $("set-health-button").disabled = false;
  if (!reply.ok) return handleEventError(reply, box);
  const err = reply.lastError;
  box.innerHTML = `
    <ul class="plain-list">
      <li><span class="pill good">${T.setOk}</span> ${T.setVersion(escapeHtml(reply.version))}</li>
      ${reply.checks.map((c) => `<li><span class="pill ${c.ok ? "good" : "warn"}">${c.ok ? T.setOk : T.setProblem}</span> <strong>${escapeHtml(c.name)}</strong> <span class="muted">${escapeHtml(c.detail)}</span></li>`).join("")}
      <li><span class="pill ${reply.setup.publicSiteUrl ? "good" : "warn"}">${reply.setup.publicSiteUrl ? T.setOk : T.setProblem}</span> ${reply.setup.publicSiteUrl ? T.setSiteUrl(escapeHtml(reply.setup.publicSiteUrl)) : T.setNoSiteUrl}</li>
      <li>${err ? `<span class="pill neutral">${T.setLastError}</span> ${escapeHtml(shortTime(err.time))} · ${escapeHtml(err.action)} · <span class="muted">${escapeHtml(err.message)}</span>` : `<span class="pill good">${T.setOk}</span> ${T.setNoError}`}</li>
    </ul>`;
});
