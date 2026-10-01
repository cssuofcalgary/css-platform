// CSS Exec Portal — shell extras: admin mode (the gear) and the event editor's section list.
// (The light/dark switch lives in overview.js.)

// ---- Admin mode: the gear by the light/dark switch ------------------------------------
function openAdminDialog() {
  const isAdmin = state.role === "admin";
  $("admin-title").textContent = isAdmin ? T.adminTitleIn : T.adminTitleEnter;
  $("admin-hint").textContent = isAdmin ? T.adminHintIn : T.adminHintEnter;
  $("admin-pw-wrap").hidden = isAdmin;
  $("admin-submit").textContent = isAdmin ? T.adminLeave : T.adminEnter;
  $("admin-pw").value = "";
  $("admin-error").hidden = true;
  $("admin-dialog").showModal();
  if (!isAdmin) $("admin-pw").focus();
}

async function onAdminSubmit(ev) {
  ev.preventDefault();
  if (state.role === "admin") {   // leaving admin mode = signing out; the exec password gets you back in as a normal exec
    $("admin-dialog").close();
    await onLogout();
    return;
  }
  const typed = $("admin-pw").value;
  if (!typed) return;
  const button = $("admin-submit");
  button.disabled = true;
  button.textContent = T.adminEntering;
  const oldToken = state.token;
  const reply = await api("login", { password: typed, name: state.name });
  button.disabled = false;
  button.textContent = T.adminEnter;
  $("admin-pw").value = "";
  if (!reply.ok || reply.role !== "admin") {
    $("admin-error").textContent = reply.ok ? T.adminWrong : errorText(reply);   // a normal exec password isn't the admin one
    $("admin-error").hidden = false;
    return;
  }
  api("logout", { token: oldToken });   // the old exec session isn't needed any more
  state.token = reply.token;
  state.name = reply.name;
  state.role = "admin";
  sessionStorage.setItem("css_token", state.token);
  sessionStorage.setItem("css_name", state.name);
  sessionStorage.setItem("css_role", state.role);
  $("admin-dialog").close();
  eventsState.loaded = false;   // admins see more buttons (archive, delete)
  ovState.loadedAt = 0;
  showApp();
  showToast(T.adminOn);
}

$("admin-gear").addEventListener("click", openAdminDialog);
$("admin-cancel").addEventListener("click", () => $("admin-dialog").close());
$("admin-form").addEventListener("submit", onAdminSubmit);

// ---- Tap the logo to refresh the page (handy on a phone at the door) ----
document.addEventListener("click", (ev) => { if (ev.target.closest(".logo, .login-logo")) window.location.reload(); });

// ---- Event pickers: only Door and Payments have one. Picking an event in either follows into the other. ----
["pay-event", "door-event"].forEach((id) => $(id).addEventListener("change", () => {
  globalEventId = $(id).value;
  payState.eventId = globalEventId;
  doorState.eventId = globalEventId;
  doorState.picked = true;
}));

// ---- Event editor: section list that scrolls to each section and follows you down the page ----
$("ed-steps").addEventListener("click", (ev) => {
  const step = ev.target.closest("[data-step]");
  if (step) document.getElementById(step.dataset.step).scrollIntoView({ behavior: "smooth", block: "start" });
});
window.addEventListener("scroll", () => {
  if ($("event-editor-view").hidden) return;
  let current = "p-basics";
  document.querySelectorAll("#event-form .panel").forEach((p) => { if (p.getBoundingClientRect().top < 150) current = p.id; });
  document.querySelectorAll("#ed-steps [data-step]").forEach((b) => b.classList.toggle("on", b.dataset.step === current));
}, { passive: true });
