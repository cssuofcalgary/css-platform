// CSS Exec Portal - Tasks workload. Uses the same search, label and department as the other views.

/** A shared task counts once for each person on it; an unfinished name line still belongs to the shared task. */
function tpRows() {
  const tpToday = todayMountain(), tpEnd = isoAddDays(tpToday, 6), tpSince = isoAddDays(tpToday, -6);
  const tpMine = taskState.filter === "mine", tpDept = !tpMine && taskState.filter !== "all" ? taskState.filter : "";
  const tpPeople = new Map();
  const tpAdd = (tpName, tpNobody) => {
    const tpClean = String(tpName || "").trim().replace(/\s+/g, " ");
    if (!tpClean) return null;
    const tpKey = tpNobody ? TASK_NOBODY : normName(tpClean);
    if (!tpPeople.has(tpKey)) tpPeople.set(tpKey, { name: tpClean, key: tpKey, nobody: !!tpNobody, open: 0, overdue: 0, blocked: 0, dueWeek: 0, doneWeek: 0 });
    return tpPeople.get(tpKey);
  };
  if (tpMine) tpAdd(state.name);
  else {
    activeTeam().filter((tpPerson) => !tpDept || personDepts(tpPerson).some((tpD) => sameName(tpD, tpDept)))
      .forEach((tpPerson) => tpAdd(tpPerson.name));
  }
  filteredTasks({ ignorePerson: true }).forEach((tpTask) => {
    const tpDone = tpTask.status === "done";
    const tpDoneDay = tpDone ? mountainDay(tpTask.doneAt || tpTask.updatedAt) : "";
    const tpRecent = !!tpDoneDay && tpDoneDay >= tpSince && tpDoneDay <= tpToday;
    if (tpDone && !tpRecent) return;
    const tpNames = [...new Map(taskOwners(tpTask).map((tpName) => [normName(tpName), tpName])).values()];
    const tpDue = taskIso(tpTask.due);
    const tpTargets = tpMine ? tpNames.filter((tpName) => sameName(tpName, state.name)) : tpNames;
    const tpRecords = tpTargets.map((tpName) => tpAdd(tpName)).filter(Boolean);
    if (!tpMine && !tpDone && !tpNames.length) tpRecords.push(tpAdd(T.taskNobody, true));
    tpRecords.forEach((tpPerson) => {
      if (tpDone) { tpPerson.doneWeek++; return; }
      tpPerson.open++;
      if (tpDue && tpDue < tpToday) tpPerson.overdue++;
      if (tpTask.status === "blocked") tpPerson.blocked++;
      if (tpDue && tpDue >= tpToday && tpDue <= tpEnd) tpPerson.dueWeek++;
    });
  });
  return [...tpPeople.values()].sort((tpA, tpB) => tpB.open - tpA.open || tpB.overdue - tpA.overdue || tpA.name.localeCompare(tpB.name, undefined, { sensitivity: "base" }));
}

function tpMetricHtml(tpPerson) {
  return [
    [tpPerson.overdue, "overdue", T.tpOverdue],
    [tpPerson.blocked, "blocked", T.tpBlocked],
    [tpPerson.dueWeek, "due", T.tpDueWeek],
    [tpPerson.doneWeek, "done", T.tpDoneWeek]
  ].filter((tpMetric) => tpMetric[0] > 0).map((tpMetric) => `<span class="tp-metric tp-${tpMetric[1]}">${escapeHtml(tpMetric[2](tpMetric[0]))}</span>`).join("");
}

function renderTaskPeople() {
  const tpRoot = $("task-people");
  if (!tpRoot) return;
  const tpList = tpRows(), tpMax = Math.max(1, ...tpList.map((tpPerson) => tpPerson.open));
  tpRoot.innerHTML = tpList.length ? `<div class="tp-list">${tpList.map((tpPerson) => `
    <button type="button" class="tp-row" data-tp-person="${escapeHtml(tpPerson.nobody ? TASK_NOBODY : tpPerson.name)}">
      <span class="tp-person">${avatarHtml([tpPerson.name])}<span class="tp-name">${escapeHtml(tpPerson.name)}</span></span>
      <span class="tp-work"><span class="tp-open">${escapeHtml(T.tpOpen(tpPerson.open))}</span><span class="tp-load" aria-hidden="true"><span style="width:${Math.round(tpPerson.open * 100 / tpMax)}%"></span></span></span>
      <span class="tp-metrics">${tpMetricHtml(tpPerson)}</span>
    </button>`).join("")}</div>` : `<p class="muted">${escapeHtml(taskState.loaded ? T.taskEmpty : T.taskLoading)}</p>`;
}

const tpRoot = $("task-people");
if (tpRoot) tpRoot.addEventListener("click", (tpEvent) => {
  const tpButton = tpEvent.target && typeof tpEvent.target.closest === "function" ? tpEvent.target.closest("[data-tp-person]") : null;
  if (tpButton) showPersonTasks(tpButton.getAttribute("data-tp-person"));
});
