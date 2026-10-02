// CSS Exec Portal — partner deals (member perks), on the Members tab. Any exec can add, edit and switch partners on or off;
// only the admin sees Delete. Members see the active ones on their pass page.

const partnerState = { list: [], editing: null, counts: {} };

async function loadPartners() {
  const reply = await api("listPartners");
  if (!reply.ok) return;
  partnerState.list = reply.partners;
  renderPartners();
  loadRedemptions();
}

async function loadRedemptions() {
  const reply = await api("listRedemptions", { limit: 25 });
  if (!reply.ok) return;
  partnerState.counts = reply.byPartner || {};
  renderPartners();   // the "N redeemed" counts
  $("redeem-status").textContent = reply.total ? (reply.total > reply.redemptions.length ? T.redeemShowing(reply.redemptions.length, reply.total) : "") : T.redeemNone;
  $("redeem-list").innerHTML = reply.redemptions.map((r) =>
    `<li>${escapeHtml(T.redeemLine(r.memberName || r.memberId, r.partnerName, shortTime(r.time)))}</li>`).join("");
}

async function downloadRedemptions() {
  const reply = await api("listRedemptions", { full: true });
  if (!reply.ok) return showToast(errorText(reply));
  if (!reply.redemptions.length) return showToast(T.redeemCsvNone);
  const head = ["Time", "Member ID", "Member", "Partner", "Offer"];
  const rows = reply.redemptions.map((r) => [r.time, r.memberId, r.memberName, r.partnerName, r.offer]);
  const csv = "﻿" + [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = "partner-redemptions.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

$("redeem-csv").addEventListener("click", downloadRedemptions);

function renderPartners() {
  $("partners-list").innerHTML = partnerState.list.length
    ? partnerState.list.map((p) => `
      <li data-partner="${escapeHtml(p.id)}" class="${p.active ? "" : "p-off"}">
        <div class="p-main"><strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(p.offer)}${p.address ? `<br><span class="muted small">${escapeHtml(p.address)}</span>` : ""}</div>
        ${partnerState.counts[p.name] ? `<span class="muted small">${T.redeemCount(partnerState.counts[p.name])}</span>` : ""}
        <span class="pill ${p.active ? "good" : "neutral"}">${p.active ? T.partnerOn : T.partnerOff}</span>
        <button class="link" type="button" data-partner-act="edit">${T.partnerEdit}</button>
        <button class="link" type="button" data-partner-act="toggle">${p.active ? T.partnerTurnOff : T.partnerTurnOn}</button>
      </li>`).join("")
    : `<li class="muted small">${T.partnersNone}</li>`;
}

function openPartnerDialog(p) {
  partnerState.editing = p || null;
  $("partner-title").textContent = p ? T.partnerDialogEdit : T.partnerDialogAdd;
  $("pt-name").value = p ? p.name : "";
  $("pt-offer").value = p ? p.offer : "";
  $("pt-address").value = p ? p.address : "";
  $("pt-active").checked = p ? p.active : true;
  $("pt-error").hidden = true;
  $("pt-save").disabled = false;
  $("pt-delete").hidden = !(p && state.role === "admin");
  $("partner-dialog").showModal();
  $("pt-name").focus();
}

async function savePartnerFrom(partner, button) {
  const reply = await api("savePartner", { partner });
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { $("partner-dialog").close(); signOutLocally(); showLogin(errorText(reply)); return null; }
    if (button) button.disabled = false;
    return reply;
  }
  await loadPartners();
  return reply;
}

$("partner-add").addEventListener("click", () => openPartnerDialog(null));
$("pt-cancel").addEventListener("click", () => $("partner-dialog").close());

$("partner-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("pt-error").hidden = true;
  $("pt-save").disabled = true;
  const p = partnerState.editing;
  const reply = await savePartnerFrom({
    id: p ? p.id : "", name: $("pt-name").value, offer: $("pt-offer").value, address: $("pt-address").value, active: $("pt-active").checked
  }, $("pt-save"));
  if (!reply) return;
  if (!reply.ok) { $("pt-error").textContent = errorText(reply); $("pt-error").hidden = false; return; }
  $("partner-dialog").close();
  showToast(T.partnerSaved, "success");
});

$("pt-delete").addEventListener("click", async () => {
  const p = partnerState.editing;
  if (!p || !confirm(T.partnerConfirmDelete(p.name))) return;
  const reply = await api("deletePartner", { partnerId: p.id });
  if (!reply.ok) { $("pt-error").textContent = errorText(reply); $("pt-error").hidden = false; return; }
  $("partner-dialog").close();
  await loadPartners();
  showToast(T.partnerDeleted);
});

$("partners-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-partner-act]");
  if (!button) return;
  const p = partnerState.list.find((x) => x.id === button.closest("[data-partner]").dataset.partner);
  if (!p) return;
  if (button.dataset.partnerAct === "edit") return openPartnerDialog(p);
  button.disabled = true;   // toggle on/off
  const reply = await savePartnerFrom({ id: p.id, name: p.name, offer: p.offer, address: p.address, active: !p.active }, button);
  if (reply && !reply.ok) showToast(errorText(reply));
});
