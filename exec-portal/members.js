// CSS Exec Portal — Members tab: the "Pending" list (sign-ups waiting on a payment), with a one-tap Mark paid.
// Search and the member page live in app.js; this file only adds the Pending view, the sidebar count and the Overview alert.

const MEMBERS_PAGE = 20;
const memState = { view: "", list: [], total: 0, hasMore: false, loaded: false, counter: 0 };

/** Opens the Members tab: Pending first when someone is waiting, Search otherwise. */
async function openMembersTab() {
  showMemberList();
  if (!memState.loaded) await loadPending(false);
  else loadPending(false);   // already have a list: show it now, refresh quietly
  if (!memState.view) setMembersView(memState.total > 0 ? "pending" : "search");
  else setMembersView(memState.view);
}

function setMembersView(view) {
  memState.view = view;
  document.querySelectorAll("#mem-filters .chip").forEach((c) => c.classList.toggle("active", c.dataset.memView === view));
  $("search-view").hidden = view !== "search";
  $("pending-view").hidden = view !== "pending";
  if (view === "search") $("search-input").focus();
}

/** Back from a member page: the list the exec came from. */
function showMemberList() {
  $("member-view").hidden = true;
  $("mem-list-area").hidden = false;
  if (memState.view) setMembersView(memState.view);
}

/** The first page (or the next one, with append). Also keeps the sidebar count and the Overview alert up to date. */
async function loadPending(append) {
  const mine = ++memState.counter;
  if (!append && !memState.loaded) $("pending-status").textContent = T.pendingLoading;
  const reply = await api("listPendingMembers", {
    offset: append ? memState.list.length : 0,
    limit: append ? MEMBERS_PAGE : Math.max(MEMBERS_PAGE, memState.list.length)
  });
  if (mine !== memState.counter) return;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
    if (!memState.loaded) $("pending-status").textContent = errorText(reply);
    return;
  }
  memState.list = append ? memState.list.concat(reply.members) : reply.members;
  memState.total = reply.total;
  memState.hasMore = reply.hasMore;
  memState.loaded = true;
  renderPending();
}

function updatePendingBadges() {
  const n = memState.total;
  $("mem-nav-count").hidden = !n;
  $("mem-nav-count").textContent = n;
  $("mem-pending-count").textContent = n ? n : "";
}

function renderPending() {
  updatePendingBadges();
  $("pending-status").textContent = memState.total ? T.pendingCount(memState.total) : T.pendingNone;
  $("pending-more").hidden = !memState.hasMore;
  $("pending-more").textContent = T.pendingMore(memState.list.length, memState.total);
  $("pending-list").innerHTML = memState.list.map((m) => {
    const cash = /cash/i.test(m.payment.method || "");
    const cells = cash
      ? [[T.fieldPayWhen, formatDay(m.payment.when)], [T.fieldPayWhere, m.payment.where], [T.fieldPayWho, m.payment.who]]
      : [[T.memberSince, formatDay(m.signedUp)], [T.fieldEmail, m.email], [T.memberUcid, m.ucid]];
    return `
    <li class="pending-item" data-id="${escapeHtml(m.memberId)}">
      <div class="pending-card">
        <div class="m-top">
          <span class="avatar" aria-hidden="true">${escapeHtml(String(m.name || "?").trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase())}</span>
          <span class="m-id"><span class="name">${escapeHtml(m.name)}</span><span class="sub">${escapeHtml(m.memberId)} · ${escapeHtml(m.payment.method || "")}</span></span>
          <span class="pill warn">${escapeHtml(m.status)}</span>
        </div>
        <div class="kv">${cells.map(([label, value]) => `<span><i>${escapeHtml(label)}</i><b>${escapeHtml(value || "—")}</b></span>`).join("")}</div>
        <div class="pending-actions">
          <button type="button" class="secondary small-button" data-pending-open="${escapeHtml(m.memberId)}">${T.pendingDetails}</button>
          <button type="button" class="primary small-button" data-pending-pay="${escapeHtml(m.memberId)}">${T.markPaid}</button>
        </div>
      </div>
    </li>`;
  }).join("");
}

/** Called when someone was marked paid anywhere (the member page or this list): drop them from Pending. */
function memberPaidHook(m) {
  const before = memState.list.length;
  memState.list = memState.list.filter((x) => x.memberId !== m.memberId);
  if (memState.list.length < before) memState.total = Math.max(0, memState.total - 1);
  if (memState.loaded) renderPending();
}

async function onPendingClick(event) {
  const open = event.target.closest("[data-pending-open]");
  if (open) {
    const m = memState.list.find((x) => x.memberId === open.dataset.pendingOpen);
    if (m) { $("mem-list-area").hidden = true; showMember(m); }
    return;
  }
  const pay = event.target.closest("[data-pending-pay]");
  if (!pay) return;
  const m = memState.list.find((x) => x.memberId === pay.dataset.pendingPay);
  if (!m) return;
  pay.disabled = true;
  pay.textContent = T.markPaying;
  const reply = await api("markMemberPaid", { memberId: m.memberId });
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
    pay.disabled = false;
    pay.textContent = T.markPaid;
    return showToast(errorText(reply));
  }
  showToast(reply.already ? T.markedAlready : reply.emailed ? T.markedPaid(m.name) : T.markedPaidNoEmail(m.name));
  const item = pay.closest(".pending-item");
  if (item) { item.classList.add("leaving"); await new Promise((r) => setTimeout(r, 220)); }
  memberPaidHook(m);
}

document.querySelectorAll("#mem-filters .chip").forEach((chip) => chip.addEventListener("click", () => setMembersView(chip.dataset.memView)));
$("pending-list").addEventListener("click", onPendingClick);
$("pending-more").addEventListener("click", () => loadPending(true));
$("pending-refresh").addEventListener("click", () => loadPending(false));
