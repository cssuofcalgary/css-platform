// First sign-in (or after an admin reset): club password, then choose a personal password.
let execSetupToken = "";

function clearExecPasswordSetup() {
  execSetupToken = "";
  $("exec-password-new").value = "";
  $("exec-password-again").value = "";
  $("exec-password-error").textContent = "";
  $("exec-password-error").hidden = true;
}

function openExecPasswordSetup(reply) {
  clearExecPasswordSetup();
  execSetupToken = reply.setupToken;
  $("exec-password-name").textContent = reply.name;
  $("exec-password-dialog").showModal();
  $("exec-password-new").focus();
}

$("exec-password-dialog").addEventListener("close", clearExecPasswordSetup);
$("exec-password-cancel").addEventListener("click", () => $("exec-password-dialog").close());
$("exec-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("exec-password-new").value;
  const error = $("exec-password-error");
  const fail = (message) => { error.textContent = message; error.hidden = false; };
  if (password !== $("exec-password-again").value) return fail(T.execPasswordsMismatch);
  const save = $("exec-password-save"), cancel = $("exec-password-cancel");
  save.disabled = cancel.disabled = true;
  const reply = await api("finishExecSetup", { setupToken: execSetupToken, password });
  save.disabled = cancel.disabled = false;
  if (!reply.ok) {
    if (["PASSWORD_SETUP_EXPIRED", "PERSON_NOT_LISTED"].includes(reply.error)) {
      $("exec-password-dialog").close();
      return setLoginError(errorText(reply));
    }
    return fail(errorText(reply));
  }
  $("exec-password-dialog").close();
  completeSignIn(reply, "login");
});
// Escape must not close a password setup while its save is being confirmed.
$("exec-password-dialog").addEventListener("cancel", (event) => { if ($("exec-password-save").disabled) event.preventDefault(); });
