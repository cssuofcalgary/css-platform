// CSS Exec Portal — Members tab: the "Pending" list (sign-ups waiting on a payment), with a one-tap Mark paid.
// Search and the member page live in app.js; this file only adds the Pending view, the sidebar count and the Overview alert.

const MEMBERS_PAGE = 20;
const memState = { view: "", list: [], total: 0, hasMore: false, loaded: false, counter: 0 };

/** Opens the Members tab: Pending first when someone is waiting, Search otherwise. */
async function openMembersTab() {
  showMemberList();
  loadPartners();
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
          <button type="button" class="primary small-button" data-pending-pay="${escapeHtml(m.memberId)}">${T.memberMarkPaid(state.membershipFee)}</button>
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
    pay.textContent = T.memberMarkPaid(state.membershipFee);
    return showToast(errorText(reply));
  }
  showToast(reply.already ? T.markedAlready : reply.emailed ? T.memberMarkedPaid(m.name) : T.markedPaidNoEmail(m.name));
  const item = pay.closest(".pending-item");
  if (item) { item.classList.add("leaving"); await new Promise((r) => setTimeout(r, 220)); }
  memberPaidHook(m);
}

// ---- Join QR: a big code for member.ucalgarycss.ca/join, to show on a screen or print for a table ----------------
// Made in the browser with the same QR library as the event site's ticket page (qrcodejs 1.0.0). Always dark on white, also in dark mode, so phones can scan it.

const JOIN_URL = "https://member.ucalgarycss.ca/join";
let joinQrPng = "";

function joinQrImage() {
  const holder = document.createElement("div");
  new QRCode(holder, { text: JOIN_URL, width: 1000, height: 1000, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
  const qr = holder.querySelector("canvas");
  const pad = 80, caption = 170, size = 1000 + pad * 2;
  const out = document.createElement("canvas");
  out.width = size; out.height = size + caption;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(qr, pad, pad, 1000, 1000);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.font = "bold 72px system-ui, sans-serif";
  ctx.fillText(T.joinQrTitle, size / 2, size + 40);
  ctx.font = "44px system-ui, sans-serif";
  ctx.fillText(JOIN_URL.replace(/^https:\/\//, ""), size / 2, size + 115);
  return out.toDataURL("image/png");
}

function joinQrDialog() {
  let dialog = $("join-qr-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "join-qr-dialog";
  dialog.className = "edit-dialog";
  dialog.innerHTML = `
    <div class="editor">
      <h2>${escapeHtml(T.joinQrTitle)}</h2>
      <img id="join-qr-img" alt="${escapeHtml(JOIN_URL)}" style="display:block;width:100%;max-width:420px;height:auto;margin:12px auto;background:#fff;border-radius:8px;">
      <p id="join-qr-error" class="error" role="alert" hidden></p>
      <div class="button-row">
        <button type="button" id="join-qr-download" class="secondary">${escapeHtml(T.joinQrDownload)}</button>
        <button type="button" id="join-qr-print" class="secondary">${escapeHtml(T.joinQrPrint)}</button>
      </div>
      <button type="button" id="join-qr-close" class="primary" style="width:100%;margin-top:10px;">${escapeHtml(T.close)}</button>
    </div>`;
  document.body.appendChild(dialog);
  $("join-qr-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  $("join-qr-print").addEventListener("click", printJoinQr);
  $("join-qr-download").addEventListener("click", () => {
    if (!joinQrPng) return;
    const a = document.createElement("a");
    a.href = joinQrPng;
    a.download = "css-join-qr.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  return dialog;
}

function openJoinQr() {
  const dialog = joinQrDialog();
  const ready = typeof QRCode !== "undefined";
  if (ready && !joinQrPng) { try { joinQrPng = joinQrImage(); } catch (e) { joinQrPng = ""; } }
  $("join-qr-error").hidden = !!joinQrPng;
  $("join-qr-error").textContent = joinQrPng ? "" : T.joinQrFailed;
  $("join-qr-img").hidden = !joinQrPng;
  $("join-qr-img").src = joinQrPng || "";
  $("join-qr-download").hidden = !joinQrPng;
  $("join-qr-print").hidden = !joinQrPng;
  dialog.showModal();
}

/** Prints only the code (a hidden frame, so the dashboard itself isn't printed and no pop-up is needed). */
function printJoinQr() {
  if (!joinQrPng) return;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><title>${escapeHtml(T.joinQrTitle)}</title><style>@page{margin:12mm}html,body{margin:0;height:100%;background:#fff}body{display:flex;align-items:center;justify-content:center}img{width:100%;max-width:170mm;height:auto}</style></head><body><img src="${joinQrPng}" alt=""></body></html>`);
  doc.close();
  const img = doc.querySelector("img");
  const go = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); };
  if (img.complete) go(); else img.addEventListener("load", go);
}

(function addJoinQrButton() {
  const add = $("add-member-button");
  if (!add || $("join-qr-button")) return;
  const btn = document.createElement("button");
  btn.id = "join-qr-button";
  btn.type = "button";
  btn.className = "secondary small-button";
  btn.textContent = T.joinQr;
  btn.addEventListener("click", openJoinQr);
  add.parentNode.insertBefore(btn, add);
})();

document.querySelectorAll("#mem-filters .chip").forEach((chip) => chip.addEventListener("click", () => setMembersView(chip.dataset.memView)));
$("pending-list").addEventListener("click", onPendingClick);
$("pending-more").addEventListener("click", () => loadPending(true));
$("pending-refresh").addEventListener("click", () => loadPending(false));
