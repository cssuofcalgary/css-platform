// CSS Exec Portal — Settings → Email wording (admin only).
// Edits the words in each email (subject, heading, text), the signature and the button colour.
// A blank box means "use the standard wording"; the standard text is shown as the placeholder.

const EM_FIELDS = ["subject", "title", "subtitle", "intro", "closing"];
let emData = null;

function emKind() {
  return emData.kinds.find((k) => k.key === $("em-kind").value);
}

function emFieldBox(field) {
  return $("em-" + field);
}

function emCurrentFields() {
  const out = {};
  EM_FIELDS.forEach((f) => { out[f] = emFieldBox(f).value; });
  return out;
}

function emShowKind() {
  const kind = emKind();
  $("em-when").textContent = kind.when;
  $("em-fills").textContent = T.emFills(kind.placeholders);
  EM_FIELDS.forEach((f) => {
    emFieldBox(f).value = kind.custom[f] || "";
    emFieldBox(f).placeholder = kind.defaults[f] ? `${T.emDefault} ${kind.defaults[f]}` : "";
  });
  $("em-result").textContent = "";
  $("em-frame").hidden = true;
}

function emShowBrand() {
  $("em-signer").value = emData.brand.signerName === emData.brandDefaults.signerName ? "" : emData.brand.signerName;
  $("em-role").value = emData.brand.signerRole === emData.brandDefaults.signerRole ? "" : emData.brand.signerRole;
  $("em-signer").placeholder = `${T.emDefault} ${emData.brandDefaults.signerName}`;
  $("em-role").placeholder = `${T.emDefault} ${emData.brandDefaults.signerRole}`;
  $("em-color").value = emData.brand.buttonColor;
}

async function openEmailsCard() {
  const reply = await api("getEmailTemplates");
  if (!reply.ok) return handleEventError(reply, $("em-result"));
  const previous = $("em-kind").value;
  emData = reply;
  $("em-kind").innerHTML = reply.kinds.map((k) => `<option value="${escapeHtml(k.key)}">${escapeHtml(k.label)}</option>`).join("");
  if (previous && reply.kinds.some((k) => k.key === previous)) $("em-kind").value = previous;
  emShowKind();
  emShowBrand();
}

function emMessage(id, text, isError) {
  const box = $(id);
  box.className = (isError ? "error" : "good-text") + " small";
  box.textContent = text;
}

$("em-kind").addEventListener("change", () => { if (emData) emShowKind(); });

$("em-save").addEventListener("click", async () => {
  const kind = emKind();
  $("em-save").disabled = true;
  const reply = await api("saveEmailTemplate", { key: kind.key, fields: emCurrentFields() });
  $("em-save").disabled = false;
  if (!reply.ok) return emMessage("em-result", errorText(reply), true);
  kind.custom = emCurrentFields();
  emMessage("em-result", T.emSaved, false);
});

$("em-reset").addEventListener("click", async () => {
  if (!confirm(T.emResetConfirm)) return;
  EM_FIELDS.forEach((f) => { emFieldBox(f).value = ""; });
  $("em-save").click();
});

$("em-preview").addEventListener("click", async () => {
  $("em-preview").disabled = true;
  const reply = await api("previewEmail", { key: emKind().key, fields: emCurrentFields() });
  $("em-preview").disabled = false;
  if (!reply.ok) return emMessage("em-result", errorText(reply), true);
  $("em-frame").srcdoc = reply.html;
  $("em-frame").hidden = false;
  emMessage("em-result", `${T.emSubject}: ${reply.subject}`, false);
});

$("em-test").addEventListener("click", async () => {
  const to = $("em-test-to").value.trim();
  $("em-test").disabled = true;
  const reply = await api("sendTestEmail", { key: emKind().key, to, fields: emCurrentFields() });
  $("em-test").disabled = false;
  if (!reply.ok) return emMessage("em-result", errorText(reply), true);
  emMessage("em-result", T.emSent(to), false);
});

async function emSaveBrand(reset) {
  const brand = reset
    ? { signerName: "", signerRole: "", buttonColor: "" }
    : { signerName: $("em-signer").value, signerRole: $("em-role").value, buttonColor: $("em-color").value };
  const reply = await api("saveEmailBrand", { brand });
  if (!reply.ok) return emMessage("em-brand-result", errorText(reply), true);
  emData.brand = reply.brand;
  emShowBrand();
  emMessage("em-brand-result", T.emSaved, false);
}

$("em-brand-save").addEventListener("click", () => emSaveBrand(false));
$("em-brand-reset").addEventListener("click", () => { if (confirm(T.emBrandResetConfirm)) emSaveBrand(true); });
