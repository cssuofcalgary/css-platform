// CSS Exec Portal — Activity tab: a readable change log ("Kevin marked TNM-4408 paid · 6:02 pm").

const actState = { group: "all", timer: null, counter: 0 };

async function openActivityTab() {
  if (!eventsState.loaded) await loadEvents();
  const current = $("act-event").value;
  $("act-event").innerHTML = `<option value="">${T.actAllEvents}</option>` + eventsState.events.map((e) =>
    `<option value="${e.id}" ${e.id === current ? "selected" : ""}>${escapeHtml(e.name)} (${escapeHtml(e.date)})</option>`).join("");
  loadActivity();
}

async function loadActivity() {
  const mine = ++actState.counter;
  $("act-status").textContent = T.actLoading;
  const reply = await api("activityLog", { filters: {
    eventId: $("act-event").value, who: $("act-who").value, group: actState.group, query: $("act-search").value, limit: Number($("act-limit").value)
  } });
  if (mine !== actState.counter) return;   // a newer request already started
  if (!reply.ok) return handleEventError(reply, $("act-status"));

  const who = $("act-who").value;
  $("act-who").innerHTML = `<option value="">${T.actEveryone}</option>` +
    [...new Set([...reply.people, ...(who ? [who] : [])])].sort().map((p) =>
      `<option ${p === who ? "selected" : ""}>${escapeHtml(p)}</option>`).join("");

  $("act-status").textContent = reply.entries.length ? (reply.truncated ? T.actTruncated(reply.entries.length) : T.actCount(reply.entries.length)) : T.actNone;
  let day = "";
  $("act-list").innerHTML = reply.entries.map((e) => {
    const when = new Date(e.time);
    const label = isNaN(when) ? "" : when.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
    const heading = label && label !== day ? `<li class="act-day">${escapeHtml(label)}</li>` : "";
    if (label) day = label;
    const clock = isNaN(when) ? escapeHtml(e.time) : when.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
    return `${heading}<li class="card act"><span class="act-time">${clock}</span><span><strong>${escapeHtml(e.who)}</strong> ${escapeHtml(e.summary)}</span></li>`;
  }).join("");
}

$("act-event").addEventListener("change", loadActivity);
$("act-who").addEventListener("change", loadActivity);
$("act-limit").addEventListener("change", loadActivity);
$("act-search").addEventListener("input", () => { clearTimeout(actState.timer); actState.timer = setTimeout(loadActivity, 350); });
$("act-groups").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  actState.group = chip.dataset.group;
  document.querySelectorAll("#act-groups .chip").forEach((c) => c.classList.toggle("active", c === chip));
  loadActivity();
});
