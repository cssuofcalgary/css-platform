// CSS Exec Portal — the small email indicator in the top bar: how many emails Google still allows,
// how many ticket emails are waiting, and the way to send the waiting ones.
// Refreshed when you sign in, when you open a tab (at most once a minute), and right after anything that sends or confirms.

const mailState = { left: -1, waiting: 0, checkedAt: "", loaded: false, last: 0, busy: false };
const MAIL_REFRESH_MS = 60000;
let mailHistoryRequest = 0;

async function loadMailHistory() {
  const request = ++mailHistoryRequest;
  $("mail-history-status").textContent = T.mailHistoryLoading;
  $("mail-history-list").innerHTML = "";
  const reply = await api("listRecentEmails");
  if (request !== mailHistoryRequest) return;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") {
      $("mail-status-dialog").close(); signOutLocally(); return showLogin(errorText(reply));
    }
    $("mail-history-status").textContent = errorText(reply);
    return;
  }
  $("mail-history-status").textContent = (reply.entries.length ? T.mailHistoryCount(reply.entries.length) : T.mailHistoryNone) +
    (reply.partial ? " · " + T.mailHistoryPartial : "");
  $("mail-history-list").innerHTML = reply.entries.map((entry) => `<li>
    <div class="email-history-top"><strong>${escapeHtml(entry.subject || T.mailHistoryNoSubject)}</strong>
      <span class="pill ${entry.status === "sent" ? "good" : "warn"}">${escapeHtml(entry.status === "sent" ? T.mailHistorySent : T.mailHistoryFailed)}</span></div>
    <div class="muted small">${escapeHtml(entry.to)}</div>
    <time class="muted small" datetime="${escapeHtml(entry.time)}">${escapeHtml(formatDate(entry.time))}</time>
  </li>`).join("");
}

function startMailStatus() {
  if (state.role === "door" || SCANNER_MODE) return;   // door volunteers only scan
  refreshMailStatus(true);
}

async function refreshMailStatus(force) {
  if (state.role === "door" || SCANNER_MODE || mailState.busy) return;
  if (!force && Date.now() - mailState.last < MAIL_REFRESH_MS) return;
  mailState.busy = true;
  try {
    const reply = await api("emailStatus");
    if (reply && reply.ok) {
      mailState.left = reply.left;
      mailState.waiting = reply.waiting;
      mailState.checkedAt = reply.checkedAt;
      mailState.loaded = true;
      mailState.last = Date.now();
    }
  } finally { mailState.busy = false; }
  renderMailStatus();
}

function renderMailStatus() {
  const pill = $("mail-pill");
  if (!pill) return;
  pill.hidden = !mailState.loaded;
  if (!mailState.loaded) return;
  pill.textContent = T.mailPill(mailState.left, mailState.waiting);
  pill.classList.toggle("warn", mailState.waiting > 0 || (mailState.left >= 0 && mailState.left < 10));
  if ($("mail-status-dialog").open) renderMailDialog();
}

function renderMailDialog() {
  $("mail-left").textContent = T.mailLeft(mailState.left);
  $("mail-waiting").textContent = T.mailWaiting(mailState.waiting);
  $("mail-checked").textContent = T.mailChecked(mailState.checkedAt ? new Date(mailState.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "just now");
  $("mail-send-pending").hidden = !(mailState.waiting > 0 && mailState.left !== 0);
}

$("mail-pill").addEventListener("click", () => {
  $("mail-result").textContent = "";
  renderMailDialog();
  $("mail-status-dialog").showModal();
  refreshMailStatus(true);
  loadMailHistory();
});
$("mail-close").addEventListener("click", () => $("mail-status-dialog").close());
$("mail-refresh").addEventListener("click", async () => {
  $("mail-result").textContent = "";
  await Promise.all([refreshMailStatus(true), loadMailHistory()]);
  if (!mailState.loaded) $("mail-result").textContent = T.mailNone;
});
$("mail-send-pending").addEventListener("click", async () => {
  const button = $("mail-send-pending");
  button.disabled = true;
  $("mail-result").textContent = T.mailSending;
  const count = mailState.left >= 0 ? Math.min(mailState.waiting, mailState.left) : mailState.waiting;
  const reply = await api("sendPendingEmails", { count });
  button.disabled = false;
  if (!reply.ok) { $("mail-result").textContent = errorText(reply); return; }
  $("mail-result").textContent = T.mailSentResult(reply.emailsSent, reply.emailsWaiting);
  loadMailHistory();
  if (typeof loadOrders === "function" && payState && payState.eventId && !$("tab-payments").hidden) loadOrders(false, true);
});

// Opening any tab refreshes the indicator (not more than once a minute).
if (typeof switchTab === "function") {
  const baseSwitchTab = switchTab;
  switchTab = function (name) { baseSwitchTab(name); refreshMailStatus(false); };   // eslint-disable-line no-global-assign
}
