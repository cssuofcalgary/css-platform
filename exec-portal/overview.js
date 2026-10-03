// CSS Exec Portal — Overview tab: what needs attention, upcoming events, recent activity.
// Read-only. It only uses calls the other tabs already make (listEvents, listOrders, doorList, activityLog).

const OV_ACTIVITY_MAX = 10;
const ovState = { counter: 0, loadedAt: 0 };

/** Dollars for the totals (money() says "Free" for zero, which reads wrong here). */
function dollars(n) { return "$" + Number(n || 0).toFixed(Number(n) % 1 ? 2 : 0); }

function greetingPart() {
  const h = Number(new Date().toLocaleString("en-CA", { hour: "numeric", hour12: false, timeZone: "America/Edmonton" })) % 24;
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

function setGreeting() {
  const first = String(state.name || "").trim().split(/\s+/)[0] || "";
  $("ov-greeting").textContent = T.ovGood(greetingPart()) + (first ? ", " + first : "");
  $("ov-date").textContent = new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Edmonton" });
}

function ovMessage(kind, title, text, retry) {
  const icon = kind === "error" ? "!" : "·";
  return `<div class="state ${kind === "error" ? "err" : ""}"><div class="ill">${icon}</div><b>${escapeHtml(title)}</b>${text ? `<p>${escapeHtml(text)}</p>` : ""}${retry ? `<button class="secondary small-button" type="button" id="ov-retry">${escapeHtml(T.ovRetry)}</button>` : ""}</div>`;
}

async function openOverview() {
  const mine = ++ovState.counter;
  setGreeting();
  $("ov-activity-wrap").hidden = state.role !== "admin";
  document.querySelector(".ov-grid").classList.toggle("single", state.role !== "admin");   // no Recent activity for execs: Upcoming events takes the full width
  const first = !ovState.loadedAt;
  if (first) {
    $("ov-events").innerHTML = `<div class="state"><span class="spin"></span>${escapeHtml(T.ovLoading)}</div>`;
    $("ov-tiles").innerHTML = "";
    $("ov-attention").innerHTML = "";
  }
  if (!eventsState.loaded || Date.now() - ovState.loadedAt > 60000) await loadEvents();
  if (mine !== ovState.counter) return;
  if (!eventsState.loaded) {
    $("ov-events").innerHTML = ovMessage("error", T.ovError, "", true);
    return;
  }

  const today = todayMountain();
  const live = activeEvents();
  const upcoming = live.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || String(a.startTime).localeCompare(String(b.startTime)));
  renderOverviewEvents(upcoming);

  // Extra numbers need a look at payments (up to 3 events) and the door (events with entry open).
  const payEvents = upcoming.slice(0, 3);
  const doorEvents = live.filter((e) => e.entryOpen).slice(0, 2);
  const [pays, doors] = await Promise.all([
    Promise.all(payEvents.map((e) => api("listOrders", { eventId: e.id, filter: "awaiting", limit: 1 }))),
    Promise.all(doorEvents.map((e) => api("doorList", { eventId: e.id }))),
    loadPending(false)   // memberships waiting on a payment (also sets the sidebar count); its result is read from memState
  ]);
  if (mine !== ovState.counter) return;
  ovState.loadedAt = Date.now();

  const payData = payEvents.map((e, i) => ({ event: e, data: pays[i].ok ? pays[i] : null }));
  const doorData = doorEvents.map((e, i) => ({ event: e, data: doors[i].ok ? doors[i] : null }));
  renderOverviewTiles(upcoming, payData, doorData);
  renderOverviewAttention(payData, doorData, upcoming.length);
  renderNavBadges(payData, doorData);
  if (state.role === "admin") loadOverviewActivity(mine);
}

function renderOverviewEvents(upcoming) {
  if (!upcoming.length) { $("ov-events").innerHTML = ovMessage("empty", T.ovNoEvents); return; }
  $("ov-events").innerHTML = upcoming.slice(0, 5).map((e) => {
    const d = new Date(e.date + "T12:00:00");
    const month = d.toLocaleDateString("en-CA", { month: "short" }).toUpperCase();
    return `
    <div class="event-row2" data-open-event="${e.id}" role="button" tabindex="0">
      <div class="date-chip"><i>${escapeHtml(month)}</i><b>${d.getDate()}</b></div>
      <div class="ev-main"><h3>${escapeHtml(e.name)}</h3><div class="meta">${escapeHtml(formatEventDate(e))}<br>${countsText(e)}</div></div>
      <div class="ev-side">${statusPill(e.status, e)}<span class="manage">${escapeHtml(T.ovManage)}</span></div>
    </div>`;
  }).join("");
}

function renderOverviewTiles(upcoming, payData, doorData) {
  const counts = eventsState.counts || {};
  const registered = upcoming.reduce((n, e) => { const c = counts[e.id] || { paid: 0, awaiting: 0 }; return n + c.paid + c.awaiting; }, 0);
  const owed = payData.reduce((n, p) => n + (p.data ? p.data.money.awaiting : 0), 0);
  const owedOrders = payData.reduce((n, p) => n + (p.data ? p.data.counts.awaiting : 0), 0);
  const inside = doorData.reduce((n, p) => n + (p.data ? p.data.counts.checkedIn : 0), 0);
  const paid = doorData.reduce((n, p) => n + (p.data ? p.data.counts.paid : 0), 0);
  const next = upcoming[0] ? new Date(upcoming[0].date + "T12:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "";
  $("ov-tiles").innerHTML =
    statTile(T.ovTileEvents, upcoming.length, T.ovTileEventsNote(next)) +
    statTile(T.ovTileRegistered, registered, T.ovTileRegisteredNote) +
    statTile(T.ovTileAwaiting, dollars(owed), T.tileOrdersAwaiting(owedOrders), owedOrders > 0) +
    statTile(T.ovTileInside, doorData.length ? inside : "—", doorData.length ? T.ovTileInsideNote(paid) : T.entryClosed);
}

function attentionItem(kind, icon, title, note, go) {
  return `<button class="attn ${kind}" type="button" data-attn="${go.tab}" data-event="${go.eventId || ""}">
    <span class="ic"><svg><use href="#i-${icon}"/></svg></span>
    <span class="txt"><b>${escapeHtml(title)}</b>${note ? `<small>${escapeHtml(note)}</small>` : ""}</span>
    <svg class="go"><use href="#i-arrow"/></svg></button>`;
}

function renderOverviewAttention(payData, doorData, totalUpcoming) {
  const items = [];
  const failed = payData.some((p) => !p.data) || doorData.some((d) => !d.data);   // a request that failed is not the same as "nothing to do"
  payData.forEach(({ event, data }) => {
    if (!data) return;
    if (data.counts.overdue > 0) items.push(attentionItem("bad", "alert", `${event.name}: ${T.ovOverdue(data.counts.overdue)}`, T.ovOverdueNote, { tab: "payments", eventId: event.id }));
    else if (data.counts.awaiting > 0) items.push(attentionItem("warn", "clock", `${event.name}: ${T.ovAwaiting(data.counts.awaiting)}`, T.ovAwaitingNote(dollars(data.money.awaiting)), { tab: "payments", eventId: event.id }));
    if (data.counts.cancelRequests > 0) items.push(attentionItem("warn", "alert", `${event.name}: ${T.ovCancelReq(data.counts.cancelRequests)}`, T.ovCancelReqNote, { tab: "payments", eventId: event.id }));
    if (data.waitlist && data.waitlist.waiting > 0 && data.waitlist.free > 0) items.push(attentionItem("warn", "clock", `${event.name}: ${T.ovWaitlist(data.waitlist.waiting, data.waitlist.free)}`, T.ovWaitlistNote, { tab: "payments", eventId: event.id }));
    if (data.refundsOwed && data.refundsOwed.count > 0) items.push(attentionItem("bad", "alert", `${event.name}: ${T.refundsNotice(data.refundsOwed.count, dollars(data.refundsOwed.amount))}`, T.ovRefundsNote, { tab: "payments", eventId: event.id }));
    if (data.counts.needsSorting > data.refundsOwed.count) items.push(attentionItem("warn", "clock", `${event.name}: ${T.ovPartPaid(data.counts.needsSorting - data.refundsOwed.count)}`, T.ovPartPaidNote, { tab: "payments", eventId: event.id }));
    if (data.unsentEmails > 0) items.push(attentionItem("info", "alert", `${event.name}: ${T.ovUnsent(data.unsentEmails)}`, T.ovUnsentNote, { tab: "payments", eventId: event.id }));
  });
  if (memState.total > 0) items.push(attentionItem("warn", "clock", T.ovMembersWaiting(memState.total), T.ovMembersWaitingNote, { tab: "members" }));
  doorData.forEach(({ event, data }) => {
    items.push(attentionItem("ok", "scan", T.ovDoorOpen(event.name), data ? T.ovDoorNote(data.counts.checkedIn, data.counts.paid) : "", { tab: "door", eventId: event.id }));
  });
  const partial = failed ? `<div class="state err"><b>${escapeHtml(T.ovPartial)}</b><button class="secondary small-button" type="button" id="ov-retry">${escapeHtml(T.ovRetry)}</button></div>` : "";
  const covered = totalUpcoming > payData.length ? `<p class="muted small">${escapeHtml(T.ovCoverage(payData.length, totalUpcoming))}</p>` : "";
  $("ov-attention").innerHTML = items.length
    ? `<div class="eyebrow">${escapeHtml(T.ovAttention)}</div>${items.join("")}${partial}${covered}`
    : (failed ? partial : `<div class="all-clear"><svg><use href="#i-check"/></svg>${escapeHtml(totalUpcoming > payData.length ? T.ovNothingNext(payData.length) : T.ovNothing)}</div>${covered}`);
}

function renderNavBadges(payData, doorData) {
  const waiting = payData.reduce((n, p) => n + (p.data ? p.data.counts.awaiting : 0), 0);
  $("pay-nav-count").hidden = !waiting;
  $("pay-nav-count").textContent = waiting;
  $("door-nav-live").hidden = !doorData.length;
}

async function loadOverviewActivity(mine) {
  const box = $("ov-activity");
  if (!box.innerHTML) box.innerHTML = `<div class="state"><span class="spin"></span>${escapeHtml(T.ovLoading)}</div>`;
  const reply = await api("activityLog", { filters: { eventId: "", who: "", group: "all", query: "", limit: 50 } });
  if (mine !== ovState.counter) return;
  if (!reply.ok) { box.innerHTML = ovMessage("error", T.ovError, "", false); return; }
  // The server only offers 50 / 100 / 200, so ask for 50 and show the newest 10 here.
  const recent = reply.entries.slice(0, OV_ACTIVITY_MAX);
  box.innerHTML = recent.length ? recent.map((e) => {
    const when = new Date(e.time);
    const clock = isNaN(when) ? escapeHtml(e.time) : when.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<div class="feed-i"><span class="dot-i"></span><div><p><strong>${escapeHtml(e.who)}</strong> ${escapeHtml(e.summary)}</p></div><time>${clock}</time></div>`;
  }).join("") : ovMessage("empty", T.ovNoActivity);
}

/** Jumps to a tab, optionally with a particular event already picked. */
function goToTab(tab, eventId) {
  if (eventId) { globalEventId = eventId; payState.eventId = eventId; doorState.eventId = eventId; }
  switchTab(tab);
  if (eventId && $("global-event").options.length) $("global-event").value = eventId;
}

document.addEventListener("click", (e) => {
  const attn = e.target.closest("[data-attn]");
  if (attn) return goToTab(attn.dataset.attn, attn.dataset.event);
  const jump = e.target.closest("[data-goto]");
  if (jump) return switchTab(jump.dataset.goto);
  const row = e.target.closest("[data-open-event]");
  if (row) {
    const target = eventsState.events.find((x) => x.id === row.dataset.openEvent);
    if (target) { switchTab("events"); openAttendees(target); }
  }
  if (e.target.id === "ov-retry") { ovState.loadedAt = 0; openOverview(); }
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-open-event]")) { e.preventDefault(); e.target.click(); }
});
// Light / dark switch: remembers the choice on this device; without a choice it follows the device setting.
$("theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark" || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("css_theme", root.dataset.theme); } catch (e) { /* private mode: fine */ }
});
