/** Settings → People: add a pasted roster without replacing anyone already saved. */
function peopleLocked_() {
  return PropertiesService.getScriptProperties().getProperty("PEOPLE_LOCKED") === "true";
}

/** Pure parser, also used by the offline demo. Accepts one name per line, or Name, Department / spreadsheet tabs. */
function parsePeoplePaste_(text, departments) {
  if (typeof text !== "string" || text.length > 20000) return { error: "Paste up to 200 people (20,000 characters)." };
  const lines = text.split(/\r\n?|\n/);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    // A small CSV reader: quoted names may contain commas; spreadsheet tabs work too.
    const separator = lines[i].indexOf("\t") !== -1 ? "\t" : ",";
    const cells = [];
    let cell = "", quoted = false;
    for (let j = 0; j < lines[i].length; j++) {
      const c = lines[i][j];
      if (c === '"') {
        if (quoted && lines[i][j + 1] === '"') { cell += '"'; j++; }
        else quoted = !quoted;
      } else if (c === separator && !quoted) { cells.push(cell.trim()); cell = ""; }
      else cell += c;
    }
    cells.push(cell.trim());
    if (quoted || cells.length > 2) return { error: "Line " + (i + 1) + ": use Name, Department." };
    if (!rows.length && /^(name|full name)$/i.test(cells[0]) && /^department$/i.test(cells[1] || "")) continue;
    const name = cells[0].replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().replace(/^[=+\-@'\s]+/, "");
    if (!name || name.length > 60) return { error: "Line " + (i + 1) + ": use a name of 1 to 60 characters." };
    const typed = (cells[1] || "").toLowerCase();
    const department = (departments || []).filter(function (d) { return d.toLowerCase() === typed; })[0] || "";
    if (typed && !department) return { error: "Line " + (i + 1) + ": unknown department \"" + cells[1] + "\". Use " + departments.join(", ") + "." };
    rows.push({ name: name, department: department });
    if (rows.length > 200) return { error: "Paste up to 200 people at a time." };
  }
  return rows.length ? { rows: rows } : { error: "Paste at least one name." };
}

function peopleImportPlan_(text) {
  const parsed = parsePeoplePaste_(text, taskDepartments_());
  if (parsed.error) throw new ApiError_("BAD_REQUEST", parsed.error);
  const seen = Object.create(null);
  taskTeam_().forEach(function (p) { seen[teamNameKey_(p.name)] = true; });
  let added = 0;
  const rows = parsed.rows.map(function (p) {
    const key = teamNameKey_(p.name);
    const exists = Object.prototype.hasOwnProperty.call(seen, key);
    seen[key] = true;
    if (!exists) added++;
    return { name: p.name, department: p.department, add: !exists };
  });
  return { ok: true, rows: rows, added: added, skipped: rows.length - added };
}

function previewPeopleImport_(text) {
  return peopleImportPlan_(text);
}

function importPeople_(session, text) {
  return withLock_(function () {
    delete DB_.rows["Team"];
    const plan = peopleImportPlan_(text); // validate every row and re-check duplicates inside the lock
    let nextSort = teamNextSort_(readRows_("Team"));
    plan.rows.filter(function (p) { return p.add; }).forEach(function (p) {
      insertRow_("Team", { id: newId_("TM"), name: p.name, department: p.department, departments: p.department ? [p.department] : [],
        discordId: "", active: true, sort: nextSort++ });
    });
    delete DB_.rows["Team"];
    if (plan.added) log_(session.name, "people.imported", "", { added: plan.added, skipped: plan.skipped });
    return { ok: true, added: plan.added, skipped: plan.skipped, team: taskTeam_() };
  });
}
