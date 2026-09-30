// CSS Exec Portal — Payments tab: email everyone registered for the event.

function mailFields() {
  return { eventId: payState.eventId, audience: $("mail-audience").value, subject: $("mail-subject").value, message: $("mail-message").value };
}

function mailShowError(text) {
  $("mail-error").textContent = text || "";
  $("mail-error").hidden = !text;
}

function openMailAll() {
  const event = payState.data && payState.data.event;
  if (!event) return;
  $("mail-title").textContent = T.mailTitle(event.name);
  $("mail-subject").value = "";
  $("mail-message").value = "";
  $("mail-info").textContent = "";
  $("mail-frame").hidden = true;
  mailShowError("");
  $("mail-dialog").showModal();
}

/** Counts the people and shows the email as it will look. Returns the reply, or null if it failed. */
async function mailPreview() {
  mailShowError("");
  const reply = await api("emailAttendees", { ...mailFields(), dryRun: true });
  if (!reply.ok) { mailShowError(errorText(reply)); return null; }
  $("mail-info").textContent = T.mailCount(reply.toEmail, reply.testAddresses, reply.emailsLeftToday);
  $("mail-frame").srcdoc = reply.previewHtml;
  $("mail-frame").hidden = false;
  return reply;
}

$("mail-all-button").addEventListener("click", openMailAll);
$("mail-cancel").addEventListener("click", () => $("mail-dialog").close());
$("mail-preview").addEventListener("click", async () => {
  $("mail-preview").disabled = true;
  await mailPreview();
  $("mail-preview").disabled = false;
});

$("mail-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = $("mail-send");
  button.disabled = true;
  const preview = await mailPreview();
  if (!preview) { button.disabled = false; return; }
  if (!preview.toEmail) { button.disabled = false; return mailShowError(T.mailNobody); }
  if (!confirm(T.mailConfirm(preview.toEmail))) { button.disabled = false; return; }
  button.textContent = T.signingIn;
  const reply = await api("emailAttendees", mailFields());
  button.disabled = false;
  button.textContent = T.mailSend;
  if (!reply.ok) return mailShowError(errorText(reply));
  $("mail-dialog").close();
  showToast(T.mailDone(reply.sent, reply.failed));
});
