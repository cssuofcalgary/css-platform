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
  $("all-view").hidden = view !== "all";
  if (view === "search") $("search-input").focus();
  if (view === "all" && (!allState.loaded || allState.stale)) loadAllMembers();
}

// ---- All members: the whole sheet as a list you can search, filter, sort, open and download ----------------------

const ALL_PAGE = 100;
const allState = { members: [], loaded: false, stale: false, filter: "all", sort: "newest", query: "", shown: ALL_PAGE, counter: 0 };

const ALL_FILTERS = {
  all: () => true,
  paid: (m) => m.paid,
  waiting: (m) => !m.paid,
  noId: (m) => !m.memberId,
  noCard: (m) => m.paid && !m.cardSent
};

async function loadAllMembers() {
  const mine = ++allState.counter;
  $("all-status").textContent = T.pendingLoading;
  const reply = await api("listAllMembers");
  if (mine !== allState.counter) return;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
    $("all-status").textContent = errorText(reply);
    return;
  }
  allState.members = reply.members;
  allState.loaded = true;
  allState.stale = false;
  renderAllMembers();
}

/** Signed-up time for sorting (sheet dates come back as text or timestamps; unknown ones go last). */
function signedUpTime(m) { const t = Date.parse(m.signedUp); return isNaN(t) ? 0 : t; }

function allMatches() {
  const q = allState.query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const list = allState.members.filter(ALL_FILTERS[allState.filter]).filter((m) => !q ||
    [m.name, m.email, m.memberId].some((v) => String(v || "").toLowerCase().includes(q)) || (digits.length >= 3 && String(m.ucid || "").includes(digits)));
  const by = {
    newest: (a, b) => signedUpTime(b) - signedUpTime(a) || b.row - a.row,
    oldest: (a, b) => signedUpTime(a) - signedUpTime(b) || a.row - b.row,
    name: (a, b) => String(a.name).localeCompare(String(b.name))
  }[allState.sort];
  return list.sort(by);
}

function renderAllMembers() {
  $("all-filters").innerHTML = Object.keys(ALL_FILTERS).map((key) => {
    const n = allState.members.filter(ALL_FILTERS[key]).length;
    return `<button type="button" class="chip ${allState.filter === key ? "active" : ""}" data-all-filter="${key}">${escapeHtml(T.allFilters[key])} <span class="chip-count">${n}</span></button>`;
  }).join("");
  const list = allMatches();
  const page = list.slice(0, allState.shown);
  $("all-status").textContent = list.length ? T.allCount(list.length, allState.members.length) : T.allNone;
  const h = T.allHead;
  $("all-table").innerHTML = !list.length ? "" : `
    <div class="all-row all-head" role="row"><span>${h.name}</span><span>${h.id}</span><span>${h.status}</span><span>${h.card}</span><span>${h.method}</span><span>${h.signedUp}</span></div>
    ${page.map((m) => `
    <button type="button" class="all-row" role="row" data-all-row="${m.row}">
      <span class="all-name"><b>${escapeHtml(m.name)}</b><small>${escapeHtml(m.email || "")}${m.ucid ? " · " + escapeHtml(m.ucid) : ""}</small></span>
      <span class="mono">${m.memberId ? escapeHtml(m.memberId) : `<span class="pill warn">${escapeHtml(T.noId)}</span>`}</span>
      <span>${paidPill(m)}</span>
      <span>${m.paid ? `<span class="pill ${m.cardSent ? "good" : "warn"}">${escapeHtml(m.cardSent ? T.cardShortSent : T.cardShortNot)}</span>` : "—"}</span>
      <span>${escapeHtml(m.payment.method || "—")}</span>
      <span>${escapeHtml(formatDay(m.signedUp) || "—")}</span>
    </button>`).join("")}`;
  $("all-more").hidden = list.length <= allState.shown;
  $("all-more").textContent = T.allMore(page.length, list.length);
}

function allMembersCsv() {
  const head = ["Name", "Email", "UCID", "Member ID", "Status", "Card", "Paid by", "When paid", "Where", "Who took it", "Signed up"];
  const rows = allMatches().map((m) => [m.name, m.email, m.ucid, m.memberId, m.paid ? "Paid" : (m.status || "Not paid"),
    m.paid ? (m.cardSent ? "Sent" : "Not sent") : "", m.payment.method, m.payment.when, m.payment.where, m.payment.who, m.signedUp]);
  const text = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  a.download = `css-members-${todayMountain()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("all-search").placeholder = T.searchPlaceholder;
$("all-sort").innerHTML =Object.keys(T.allSorts).map((k) => `<option value="${k}">${escapeHtml(T.allSorts[k])}</option>`).join("");
$("all-sort").addEventListener("change", () => { allState.sort = $("all-sort").value; allState.shown = ALL_PAGE; renderAllMembers(); });
$("all-search").addEventListener("input", () => { allState.query = $("all-search").value; allState.shown = ALL_PAGE; renderAllMembers(); });
$("all-filters").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-all-filter]");
  if (!chip) return;
  allState.filter = chip.dataset.allFilter; allState.shown = ALL_PAGE; renderAllMembers();
});
$("all-more").addEventListener("click", () => { allState.shown += ALL_PAGE; renderAllMembers(); });
$("all-csv").addEventListener("click", allMembersCsv);
$("all-table").addEventListener("click", (e) => {
  const row = e.target.closest("[data-all-row]");
  if (!row) return;
  const m = allState.members.find((x) => String(x.row) === row.dataset.allRow);
  if (m) showMember(m);
});

/** "Create member ID" on the member page of a row that has none: then Mark paid works like for anyone else. */
$("member-assign-id").addEventListener("click", async () => {
  const m = state.member;
  if (!m || m.memberId) return;
  const button = $("member-assign-id");
  button.disabled = true;
  button.textContent = T.assigning;
  const reply = await api("assignMemberId", { row: m.row, name: m.name });
  button.textContent = T.assignId;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
    button.disabled = false;
    $("member-assign-error").textContent = errorText(reply);
    $("member-assign-error").hidden = false;
    return;
  }
  const fresh = { ...m, ...reply.member };
  const i = allState.members.findIndex((x) => x.row === m.row);
  if (i !== -1) allState.members[i] = fresh;
  showMember(fresh);
  showToast(T.assignedId(fresh.memberId), "success");
  loadPending(false);   // an unpaid row now waits in Pending
});

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
  allState.stale = true;   // All members reloads next time it's shown
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

// The same Join QR at the help desk (Check-in tab), next to "+ Walk-in": people who want to join can scan it at the door.
(function addDeskJoinQrButton() {
  const walkIn = $("walkin-button");
  if (!walkIn || $("desk-join-qr-button")) return;
  const group = document.createElement("span");
  group.className = "button-pair";
  const btn = document.createElement("button");
  btn.id = "desk-join-qr-button";
  btn.type = "button";
  btn.className = "secondary small-button";
  btn.textContent = T.joinQr;
  btn.addEventListener("click", openJoinQr);
  walkIn.replaceWith(group);
  group.append(btn, walkIn);
})();

document.querySelectorAll("#mem-filters .chip").forEach((chip) => chip.addEventListener("click", () => setMembersView(chip.dataset.memView)));
$("pending-list").addEventListener("click", onPendingClick);
$("pending-more").addEventListener("click", () => loadPending(true));
$("pending-refresh").addEventListener("click", () => loadPending(false));

// ---- The questions on the public Join CSS form -------------------------------------------

const membershipFormState = { questions: [], loading: false, saving: false };

function setMembershipFormError(message) {
  $("membership-form-error").textContent = message;
  $("membership-form-error").hidden = !message;
}

function membershipFormQuestionRows() {
  return [...document.querySelectorAll("#membership-form-questions [data-mf-question]")];
}

/** Existing IDs stay attached to their rows when wording or order changes. */
function readMembershipFormQuestions() {
  return membershipFormQuestionRows().map((row) => ({
    id: row.dataset.questionId || "",
    label: row.querySelector("[data-mf-label]").value.trim(),
    type: row.querySelector("[data-mf-type]").value === "choice" ? "choice" : "text",
    required: row.querySelector("[data-mf-required]").checked,
    options: row.querySelector("[data-mf-options]").value.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean)
  }));
}

function renderMembershipFormQuestions() {
  $("membership-form-questions").innerHTML = membershipFormState.questions.map((question, index) => `
    <div class="repeat-row" data-mf-question data-question-id="${escapeHtml(question.id || "")}">
      <label for="mfq-${index}-label">${T.questionLabel}</label>
      <input id="mfq-${index}-label" data-mf-label maxlength="120" value="${escapeHtml(question.label || "")}">
      <div class="grid-2">
        <div><label for="mfq-${index}-type">${T.questionType}</label>
          <select id="mfq-${index}-type" data-mf-type>
            <option value="text" ${question.type !== "choice" ? "selected" : ""}>${T.typeText}</option>
            <option value="choice" ${question.type === "choice" ? "selected" : ""}>${T.typeChoice}</option>
          </select></div>
        <label class="check align-end"><input type="checkbox" data-mf-required ${question.required ? "checked" : ""}> ${T.required}</label>
      </div>
      <div data-mf-options-box ${question.type === "choice" ? "" : "hidden"}>
        <label for="mfq-${index}-options">${T.questionOptions}</label>
        <textarea id="mfq-${index}-options" data-mf-options rows="3">${escapeHtml((question.options || []).join("\n"))}</textarea>
      </div>
      <button type="button" class="link danger" data-mf-remove="${index}">${T.remove}</button>
    </div>`).join("");
  $("membership-form-add").disabled = membershipFormState.saving || membershipFormState.questions.length >= 20;
}

async function openMembershipFormSettings() {
  if (state.role !== "admin") { openAdminDialog(); return; }
  if (membershipFormState.loading || membershipFormState.saving) return;
  membershipFormState.loading = true;
  $("member-form-settings").disabled = true;
  const reply = await api("getMembershipForm");
  membershipFormState.loading = false;
  $("member-form-settings").disabled = false;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") return handleEventError(reply, $("pending-status"));
    return showToast(errorText(reply));
  }
  membershipFormState.questions = (reply.questions || []).map((q) => ({ ...q, options: (q.options || []).slice() }));
  setMembershipFormError("");
  renderMembershipFormQuestions();
  $("membership-form-dialog").showModal();
}

function addMembershipFormQuestion() {
  if (membershipFormState.saving) return;
  membershipFormState.questions = readMembershipFormQuestions();
  if (membershipFormState.questions.length >= 20) return setMembershipFormError(T.mfLimit);
  membershipFormState.questions.push({ id: "", label: "", type: "text", required: false, options: [] });
  setMembershipFormError("");
  renderMembershipFormQuestions();
  $("mfq-" + (membershipFormState.questions.length - 1) + "-label").focus();
}

function removeMembershipFormQuestion(event) {
  const button = event.target.closest("[data-mf-remove]");
  if (!button || membershipFormState.saving) return;
  membershipFormState.questions = readMembershipFormQuestions();
  membershipFormState.questions.splice(Number(button.dataset.mfRemove), 1);
  renderMembershipFormQuestions();
}

function syncMembershipQuestionType(event) {
  if (!event.target.matches("[data-mf-type]")) return;
  event.target.closest("[data-mf-question]").querySelector("[data-mf-options-box]").hidden = event.target.value !== "choice";
}

function setMembershipFormBusy(busy) {
  membershipFormState.saving = busy;
  document.querySelectorAll("#membership-form-form button, #membership-form-form input, #membership-form-form textarea, #membership-form-form select").forEach((control) => { control.disabled = busy; });
  $("membership-form-save").textContent = busy ? T.saving : T.mfSave;
  $("membership-form-add").disabled = busy || membershipFormState.questions.length >= 20;
}

async function saveMembershipFormSettings(event) {
  event.preventDefault();
  if (membershipFormState.saving) return;
  if (state.role !== "admin") { openAdminDialog(); return; }
  const questions = readMembershipFormQuestions();
  if (questions.some((q) => !q.label)) return setMembershipFormError(T.mfNeedLabel);
  if (questions.some((q) => q.type === "choice" && q.options.length < 2)) return setMembershipFormError(T.mfNeedOptions);
  membershipFormState.questions = questions;
  setMembershipFormError("");
  setMembershipFormBusy(true);
  const reply = await api("saveMembershipForm", { questions });
  setMembershipFormBusy(false);
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { $("membership-form-dialog").close(); return handleEventError(reply, $("pending-status")); }
    return setMembershipFormError(errorText(reply));
  }
  membershipFormState.questions = reply.questions || questions;
  $("membership-form-dialog").close();
  showToast(T.mfSaved, "success");
}

/** Answer labels are the wording saved when this person joined, even after questions change. */
function renderMemberSignupAnswers(member) {
  const answers = Object.entries(member.signupAnswers || {}).filter(([, value]) => value !== "" && value !== null && value !== undefined);
  $("member-signup-section").hidden = !answers.length;
  $("member-signup-answers").innerHTML = answers.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value).replace(/\r?\n/g, "<br>")}</dd>`).join("");
}

$("member-form-settings").addEventListener("click", openMembershipFormSettings);
$("membership-form-add").addEventListener("click", addMembershipFormQuestion);
$("membership-form-questions").addEventListener("click", removeMembershipFormQuestion);
$("membership-form-questions").addEventListener("change", syncMembershipQuestionType);
$("membership-form-form").addEventListener("submit", saveMembershipFormSettings);
$("membership-form-cancel").addEventListener("click", () => { if (!membershipFormState.saving) $("membership-form-dialog").close(); });
$("membership-form-dialog").addEventListener("cancel", (event) => { if (membershipFormState.saving) event.preventDefault(); });
