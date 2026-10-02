// CSS Exec Portal — feedback on an event, the on-demand event report, and a member's history.

// ---- Feedback block on the event page ---------------------------------------

function starText(n) {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return "★".repeat(full) + "☆".repeat(5 - full);
}

function renderFeedbackBlock(fb) {
  const box = $("detail-feedback");
  if (!fb || !fb.count) {
    box.innerHTML = `<h3 class="section-title">${T.feedbackHeading}</h3><p class="muted small">${T.feedbackNone}</p>`;
    return;
  }
  box.innerHTML = `
    <h3 class="section-title">${T.feedbackHeading}</h3>
    <p><span class="rating-stars">${starText(fb.average)}</span> <strong>${T.feedbackLine(fb.average, fb.count)}</strong></p>
    <ul class="plain-list">${fb.distribution.map((n, i) => ({ stars: i + 1, n })).reverse()
      .map((r) => `<li><span class="rating-stars">${starText(r.stars)}</span> <span class="muted">${r.n}</span></li>`).join("")}</ul>
    ${fb.comments.length ? `<ul class="plain-list">${fb.comments.map((c) =>
      `<li><span class="rating-stars">${starText(c.rating)}</span> ${escapeHtml(c.comment)} <span class="muted">· ${escapeHtml(c.name)}</span></li>`).join("")}</ul>` : ""}`;
}

// ---- Event report -----------------------------------------------------------

const reportState = { text: "", name: "report" };

function reportToText(r) {
  const e = r.event;
  const lines = [];
  const when = [e.date, [e.startTime, e.endTime].filter(Boolean).join(" to ")].filter(Boolean).join(", ");
  lines.push(`EVENT REPORT: ${e.name}`);
  lines.push([when, e.location].filter(Boolean).join(" · "));
  lines.push(`Made ${shortTime(r.generatedAt)} by ${r.generatedBy}`);
  lines.push("");
  lines.push("TURNOUT");
  lines.push(`  Registered: ${r.totals.registered}${e.capacity ? ` (capacity ${e.capacity})` : ""}`);
  lines.push(`  Paid tickets: ${r.paidTickets}   Still unpaid: ${r.totals.awaiting}   Cancelled/refunded: ${r.totals.closed}`);
  lines.push(`  Checked in: ${r.checkedInPaid} of ${r.paidTickets} paid${r.attendanceRate === null ? "" : ` (${r.attendanceRate}% showed up)`}`);
  lines.push(`  Members: ${r.members.members}   Non-members: ${r.members.others}   Walk-ins: ${r.walkIns}`);
  lines.push("");
  lines.push("MONEY");
  lines.push(`  Received: ${money(r.money.received)}   Still to come: ${money(r.money.awaiting)}`);
  lines.push("");
  if (r.byType.length) {
    lines.push("TICKET TYPES");
    r.byType.forEach((b) => lines.push(`  ${b.name}: ${b.paid} paid, ${b.awaiting} unpaid, ${b.checkedIn} checked in`));
    lines.push("");
  }
  r.questions.forEach((q) => {
    lines.push(`QUESTION: ${q.label}`);
    if (!q.answers.length) lines.push("  (no answers)");
    q.answers.forEach((a) => lines.push(`  ${a.answer}: ${a.paid + a.awaiting}`));
    lines.push("");
  });
  if (r.byDay.length) {
    lines.push("SIGN-UPS PER DAY");
    r.byDay.forEach((d) => lines.push(`  ${d.day}: ${d.tickets}`));
    lines.push("");
  }
  lines.push("FEEDBACK");
  if (!r.feedback.count) lines.push("  No ratings.");
  else {
    lines.push(`  ${r.feedback.average} / 5 from ${r.feedback.count} rating${r.feedback.count === 1 ? "" : "s"}`);
    r.feedback.comments.forEach((c) => lines.push(`  ${"★".repeat(c.rating)} "${c.comment}" (${c.name})`));
  }
  return lines.join("\n");
}

async function openEventReport() {
  if (!attState.event) return;
  const button = $("detail-report");
  button.disabled = true;
  $("report-body").textContent = T.reportLoading;
  const reply = await api("eventReport", { eventId: attState.event.id });
  button.disabled = false;
  if (!reply.ok) return handleEventError(reply, $("detail-status"));
  reportState.text = reportToText(reply);
  reportState.name = `${reply.event.name}-${reply.event.date || ""}-report`.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  $("report-body").textContent = reportState.text;
  $("report-dialog").showModal();
}

$("detail-report").addEventListener("click", openEventReport);
$("report-close").addEventListener("click", () => $("report-dialog").close());
$("report-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(reportState.text); showToast(T.reportCopied); }
  catch (e) { const range = document.createRange(); range.selectNodeContents($("report-body")); getSelection().removeAllRanges(); getSelection().addRange(range); }
});
$("report-download").addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([reportState.text], { type: "text/plain;charset=utf-8" }));
  link.download = `${reportState.name || "report"}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
});

// ---- Member history ----------------------------------------------------------

async function loadMemberHistory(m) {
  const box = $("member-history");
  box.innerHTML = "";
  if (!m || !m.memberId) return;
  const reply = await api("memberHistory", { memberId: m.memberId });
  if (!state.member || state.member.memberId !== m.memberId) return;   // they moved on to someone else while this loaded
  if (!reply.ok) return;
  if (!reply.entries.length) {
    box.innerHTML = `<h3 class="section-title">${T.memberHistoryHeading}</h3><p class="muted small">${T.memberHistoryNone}</p>`;
    return;
  }
  const label = (x) => x.status === "refunded" || x.status === "cancelled" ? T.historyClosed
    : x.status === "awaiting" ? T.historyWaiting
    : x.checkedInAt ? T.historyShowed : T.historyNoShow;
  box.innerHTML = `
    <h3 class="section-title">${T.memberHistoryHeading}</h3>
    <p class="muted small">${T.memberHistoryLine(reply.registered, reply.attended, reply.rated)}${reply.olderNotShown ? " " + T.memberHistoryOlder(reply.olderNotShown) : ""}</p>
    <ul class="history-list">${reply.entries.map((x) => `
      <li><strong>${escapeHtml(x.eventName)}</strong> <span class="muted">${escapeHtml(x.date || "")} · ${escapeHtml(x.ticketType)}</span>
        <span class="pill ${x.checkedInAt ? "good" : "neutral"}">${escapeHtml(label(x))}</span>
        ${x.rating ? `<span class="rating-stars">${starText(x.rating)}</span>` : ""}${x.comment ? ` <span class="muted">“${escapeHtml(x.comment)}”</span>` : ""}</li>`).join("")}
    </ul>`;
}
