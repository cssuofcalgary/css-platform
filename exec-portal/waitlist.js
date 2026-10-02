// CSS Exec Portal — the waitlist, shown on the Payments tab under the "Waitlist" chip.
// Nothing here moves by itself: Finance presses "Offer a spot" (a normal registration is made and emailed) or "Remove".

let waitlistCounter = 0;

/** Called whenever the Payments list redraws with the Waitlist chip on: show what we have, then fetch the fresh list. */
function renderWaitlist() {
  const have = payState.waitlist && payState.waitlist.forEvent === payState.eventId ? payState.waitlist : null;
  if (have) drawWaitlist(have); else $("orders").innerHTML = "";
  loadWaitlist();
}

async function loadWaitlist() {
  const mine = ++waitlistCounter;
  const eventId = payState.eventId;
  const reply = await api("listWaitlist", { eventId });
  if (mine !== waitlistCounter || payState.filter !== "waitlist" || payState.eventId !== eventId) return;
  if (!reply.ok) return handleEventError(reply, $("pay-status"));
  reply.forEvent = eventId;
  payState.waitlist = reply;
  drawWaitlist(reply);
}

function drawWaitlist(wl) {
  const waiting = wl.entries.filter((e) => e.status === "waiting").length;
  $("pay-status").textContent = wl.entries.length ? T.wlSummary(waiting, wl.free) : "";
  $("orders").innerHTML = wl.entries.length ? wl.entries.map((w) => waitlistCard(w, wl.holdHours)).join("") : `<li class="muted">${T.wlEmpty}</li>`;
}

function waitlistCard(w, holdHours) {
  const stale = w.status === "offered" && w.offeredAt && Date.now() - new Date(w.offeredAt).getTime() > holdHours * 3600 * 1000;
  const answers = Object.entries(w.answers || {}).map(([k, v]) => ` · ${escapeHtml(k)}: ${escapeHtml(v)}`).join("");
  return `
    <li class="card order" data-wl="${escapeHtml(w.id)}" data-wl-name="${escapeHtml(w.name)}" data-wl-type="${escapeHtml(w.ticketType)}">
      <div class="o-code">
        <span class="order-code">${w.position ? T.wlPosition(w.position) : "—"}</span>
        <span class="o-when">${T.wlJoined(escapeHtml(shortTime(w.createdAt)))}</span>
      </div>
      <div class="o-who order-meta">
        <span><strong>${escapeHtml(w.name)}</strong> · ${escapeHtml(w.email)}</span>
        <span>${escapeHtml(w.ticketType)}${w.ucid ? ` · UCID ${escapeHtml(w.ucid)}` : ""}${w.memberId ? ` · ${escapeHtml(w.memberId)}` : ""}${answers}</span>
        ${w.status === "offered" ? `<span>${escapeHtml(T.wlOfferedInfo(w.offeredBy, shortTime(w.offeredAt), w.orderCode))}</span>` : ""}
        ${stale ? `<span class="flag">${escapeHtml(T.wlStale(holdHours))}</span>` : ""}
      </div>
      <div class="o-total"><span class="pill ${w.status === "waiting" ? "warn" : "good"}">${w.status === "waiting" ? T.wlWaitingPill : T.wlOfferedPill}</span></div>
      <div class="order-actions o-actions">
        ${w.status === "waiting" ? `<button class="primary" data-wl-act="offer">${T.wlOffer}</button>` : ""}
        ${w.status === "waiting" ? `<button class="link danger" data-wl-act="remove">${T.wlRemove}</button>` : ""}
        <span class="order-result"></span>
      </div>
    </li>`;
}

async function onWaitlistClick(event) {
  const button = event.target.closest("[data-wl-act]");
  const card = button.closest("[data-wl]");
  const id = card.dataset.wl, name = card.dataset.wlName, type = card.dataset.wlType;
  const result = card.querySelector(".order-result");
  const siteUrl = new URL(PUBLIC_SITE_URL, location.href).href;
  let reply;

  if (button.dataset.wlAct === "offer") {
    if (!confirm(T.wlConfirmOffer(name, type))) return;
    button.disabled = true;
    reply = await api("offerWaitlistSpot", { entryId: id, siteUrl });
    if (!reply.ok && reply.error === "OVER_CAPACITY" && confirm(reply.message)) {
      reply = await api("offerWaitlistSpot", { entryId: id, siteUrl, force: true });
    }
    if (reply.ok) showToast(T.wlOfferDone(reply.code, reply.emailed));
  }
  if (button.dataset.wlAct === "remove") {
    if (!confirm(T.wlConfirmRemove(name))) return;
    button.disabled = true;
    reply = await api("removeWaitlistEntry", { entryId: id });
    if (reply.ok) showToast(T.wlRemoved);
  }
  if (!reply || !reply.ok) {
    button.disabled = false;
    return reply ? handleEventError(reply, result) : undefined;
  }
  eventsState.loaded = false;
  loadOrders();   // counts, the waitlist and the orders all changed
}
