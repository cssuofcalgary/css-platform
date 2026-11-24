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
  // First time: the copy kept on this device shows straight away (its action buttons stay off until the fresh one arrives).
  const kept = first && !ovState.showingKept ? deviceLoad("overview") : null;
  if (kept) {
    $("ov-events").innerHTML = kept.events || "";
    $("ov-tiles").innerHTML = kept.tiles || "";
    $("ov-attention").innerHTML = kept.attention || "";
    $("ov-attention").querySelectorAll(".attn-actions button").forEach((b) => { b.disabled = true; });
    $("pay-nav-count").hidden = !kept.waiting;
    $("pay-nav-count").textContent = kept.waiting || "";
    $("door-nav-live").hidden = !kept.doorLive;
    ovState.showingKept = true;
  } else if (first && !ovState.showingKept) {
    $("ov-events").innerHTML = `<div class="state"><span class="spin"></span>${escapeHtml(T.ovLoading)}</div>`;
    $("ov-tiles").innerHTML = "";
    $("ov-attention").innerHTML = "";
  }
  const quiet = { quiet: !first || ovState.showingKept };
  if (!eventsState.loaded || eventsState.fromDevice || Date.now() - ovState.loadedAt > 60000) await loadEvents();
  if (mine !== ovState.counter) return;
  if (!eventsState.loaded || (ovState.showingKept && eventsState.fromDevice)) {
    if (ovState.showingKept) return;   // no connection: keep showing the kept copy (the connection notice says so)
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
  const [pays, doors, , attention] = await Promise.all([
    Promise.all(payEvents.map((e) => api("listOrders", { eventId: e.id, filter: "awaiting", limit: 1 }, quiet))),
    Promise.all(doorEvents.map((e) => api("doorList", { eventId: e.id }))),
    loadPending(false, quiet.quiet),   // memberships waiting on a payment (also sets the sidebar count); its result is read from memState
    api("attentionList", {}, quiet)   // every live event: payments to check, refunds owed, emails not sent, offers and cards not delivered
  ]);
  if (mine !== ovState.counter) return;
  // Lost the connection half way: keep the kept copy rather than show zeros.
  const offline = [...pays, ...doors, attention].some((r) => !r.ok && ["NETWORK", "TEMPORARY", "BUSY"].includes(r.error));
  if (offline && ovState.showingKept) return;
  ovState.loadedAt = Date.now();
  ovState.showingKept = false;

  const payData = payEvents.map((e, i) => ({ event: e, data: pays[i].ok ? pays[i] : null }));
  const doorData = doorEvents.map((e, i) => ({ event: e, data: doors[i].ok ? doors[i] : null }));
  renderOverviewTiles(upcoming, payData, doorData);
  renderOverviewAttention(payData, doorData, upcoming.length, attention.ok ? attention.items : null);
  renderNavBadges(payData, doorData);
  if (!offline) {
    deviceSave("overview", { events: $("ov-events").innerHTML, tiles: $("ov-tiles").innerHTML, attention: $("ov-attention").innerHTML,
      waiting: payData.reduce((n, p) => n + (p.data ? p.data.counts.awaiting : 0), 0), doorLive: doorData.length > 0 });
  }
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

/** A Needs attention line with its own buttons (the next step), instead of the whole line being a link. */
function actionItem(kind, icon, title, note, buttons) {
  return `<div class="attn ${kind} has-actions">
    <span class="ic"><svg><use href="#i-${icon}"/></svg></span>
    <span class="txt"><b>${escapeHtml(title)}</b>${note ? `<small>${escapeHtml(note)}</small>` : ""}<small class="attn-result" hidden></small></span>
    <span class="attn-actions">${buttons.map((b) => `<button type="button" class="secondary small-button" ${Object.entries(b.data).map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`).join(" ")}>${escapeHtml(b.label)}</button>`).join("")}</span>
  </div>`;
}

/** The items from attentionList (every live event), each with the button that deals with it. */
function attentionActionItems(list) {
  const prefix = (x) => x.eventName ? `${x.eventName}: ` : "";
  const open = (x) => ({ label: T.attnOpen, data: { "attn-go": "payments", event: x.eventId || "" } });
  return list.map((x) => {
    if (x.kind === "review") {
      const codes = x.codes.join(", ");
      return actionItem("bad", "alert", prefix(x) + T.attnReview(codes, x.what), T.attnReviewNote(codes), [open(x), { label: T.attnDone, data: { "attn-do": "dismissReview", id: x.id } }]);
    }
    if (x.kind === "refunds") return actionItem("bad", "alert", prefix(x) + T.refundsNotice(x.count, dollars(x.amount)), "", [open(x)]);
    if (x.kind === "emails") return actionItem("info", "alert", prefix(x) + T.ovUnsent(x.count), "", [{ label: T.attnSendNow, data: { "attn-do": "sendPendingEmails", event: x.eventId } }]);
    if (x.kind === "offer") return actionItem("warn", "alert", prefix(x) + T.attnOffer(x.name, x.code), "", [{ label: T.attnResendOffer, data: { "attn-do": "resendWaitlistOffer", id: x.id } }]);
    if (x.kind === "card") return actionItem("warn", "alert", T.attnCard(x.name), "", [{ label: T.attnResendCard, data: { "attn-do": "resendMemberCard", id: x.id } }]);
    if (x.kind === "membersUnreadable") return actionItem("info", "alert", T.attnMembersUnreadable, "", []);
    return "";
  });
}

async function onAttentionAction(button) {
  const line = button.closest(".attn");
  const out = line.querySelector(".attn-result");
  const act = button.dataset.attnDo;
  button.disabled = true;
  let reply, text = "";
  if (act === "dismissReview") reply = await api("dismissReview", { requestId: button.dataset.id });
  if (act === "sendPendingEmails") { reply = await api("sendPendingEmails", { eventId: button.dataset.event }); if (reply.ok) text = T.attnSent(reply.emailsSent, reply.emailsWaiting); }
  if (act === "resendWaitlistOffer") { reply = await api("resendWaitlistOffer", { entryId: button.dataset.id }); if (reply.ok) text = reply.emailed ? T.attnOfferSent : T.attnStillFailed; }
  if (act === "resendMemberCard") { reply = await api("resendMemberCard", { memberId: button.dataset.id }); if (reply.ok) text = T.attnCardSent; }
  if (!reply.ok) text = reply.error === "EMAIL_FAILED" ? T.attnStillFailed : errorText(reply);
  out.textContent = text;
  out.hidden = !text;
  const finished = reply.ok && (act === "dismissReview" || text === T.attnOfferSent || text === T.attnCardSent || (act === "sendPendingEmails" && !reply.emailsWaiting));
  if (finished) line.classList.add("done");
  else button.disabled = false;
}

function renderOverviewAttention(payData, doorData, totalUpcoming, attention) {
  const items = attention ? attentionActionItems(attention) : [];
  // a request that failed is not the same as "nothing to do"
  const failed = !attention || payData.some((p) => !p.data) || doorData.some((d) => !d.data);
  payData.forEach(({ event, data }) => {
    if (!data) return;
    if (data.counts.overdue > 0) items.push(attentionItem("bad", "alert", `${event.name}: ${T.ovOverdue(data.counts.overdue)}`, T.ovOverdueNote, { tab: "payments", eventId: event.id }));
    else if (data.counts.awaiting > 0) items.push(attentionItem("warn", "clock", `${event.name}: ${T.ovAwaiting(data.counts.awaiting)}`, T.ovAwaitingNote(dollars(data.money.awaiting)), { tab: "payments", eventId: event.id }));
    if (data.counts.cancelRequests > 0) items.push(attentionItem("warn", "alert", `${event.name}: ${T.ovCancelReq(data.counts.cancelRequests)}`, T.ovCancelReqNote, { tab: "payments", eventId: event.id }));
    if (data.waitlist && data.waitlist.waiting > 0 && data.waitlist.free > 0) items.push(attentionItem("warn", "clock", `${event.name}: ${T.ovWaitlist(data.waitlist.waiting, data.waitlist.free)}`, T.ovWaitlistNote, { tab: "payments", eventId: event.id }));
    // Refunds owed and unsent ticket emails come from attentionList (every event, with a button), not from here.
    if (data.counts.needsSorting > data.refundsOwed.count) items.push(attentionItem("warn", "clock", `${event.name}: ${T.ovPartPaid(data.counts.needsSorting - data.refundsOwed.count)}`, T.ovPartPaidNote, { tab: "payments", eventId: event.id }));
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
  if (eventId) { globalEventId = eventId; payState.eventId = eventId; doorState.eventId = eventId; doorState.picked = true; }
  switchTab(tab);
  if (eventId && $("global-event").options.length) $("global-event").value = eventId;
}

document.addEventListener("click", (e) => {
  const doIt = e.target.closest("[data-attn-do]");
  if (doIt) return onAttentionAction(doIt);
  const goIt = e.target.closest("[data-attn-go]");
  if (goIt) return goToTab(goIt.dataset.attnGo, goIt.dataset.event);
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
