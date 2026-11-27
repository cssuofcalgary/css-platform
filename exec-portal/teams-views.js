// Tracker views share the same records; only the chosen cell is sent when it changes.
var tvInstances = new WeakMap();
var tvColorNames = ["blue", "green", "yellow", "red", "gold", "purple", "grey"];

function tvEscape(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
    return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
  });
}

function tvAvailableViews(tracker) {
  var fields = tracker && Array.isArray(tracker.fields) ? tracker.fields : [];
  var views = ["table"];
  if (fields.some(function (f) { return f.type === "choice"; })) views.push("board");
  if (fields.some(function (f) { return f.type === "date"; })) views.push("calendar");
  return views;
}

function tvViewField(tracker, view) {
  var type = view === "board" ? "choice" : "date";
  var key = view === "board" ? "boardField" : "dateField";
  var fields = tracker.fields || [];
  return fields.find(function (f) { return f.id === (tracker.views || {})[key] && f.type === type; }) ||
    fields.find(function (f) { return f.type === type; });
}

function tvCellText(field, value, team) {
  if (field.type === "checkbox") return value === true ? T.tmYes : T.tmNo;
  if (value == null || value === "") return "";
  if (field.type === "choice") {
    var option = (field.options || []).find(function (o) { return o.id === value; });
    return option ? option.label : "";
  }
  if (field.type === "money") {
    var amount = Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat("en-CA", {style: "currency", currency: "CAD"}).format(amount) : String(value);
  }
  return String(value);
}

function tvCellHtml(field, value) {
  var text = tvCellText(field, value);
  if (field.type === "choice" && text) {
    var option = (field.options || []).find(function (o) { return o.id === value; });
    var color = tvColorNames.indexOf(option.color) >= 0 ? option.color : "grey";
    return '<span class="tv-choice tv-choice-' + color + '">' + tvEscape(text) + '</span>';
  }
  if (field.type === "link" && /^https?:\/\//i.test(String(value || "").trim())) {
    return '<a href="' + tvEscape(String(value).trim()) + '" target="_blank" rel="noopener noreferrer">' + tvEscape(text) + '</a>';
  }
  return tvEscape(text);
}

function tvRows(ctx) {
  return (ctx.rows || []).slice().sort(function (a, b) {
    return (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.id).localeCompare(String(b.id));
  });
}

function tvTitle(ctx, row) {
  var field = (ctx.tracker.fields || [])[0];
  return field && tvCellText(field, (row.values || {})[field.id], ctx.team) || T.tmUntitled;
}

function tvOptions(field, team, current) {
  if (field.type === "choice") return (field.options || []).map(function (o) { return {value: o.id, label: o.label}; });
  var names = (team || []).filter(function (p) { return p.active !== false; }).map(function (p) { return p.name; });
  if (current) names.push(String(current));
  return names.filter(function (name, i) { return name && names.indexOf(name) === i; })
    .sort(function (a, b) { return a.localeCompare(b); }).map(function (name) { return {value: name, label: name}; });
}

function tvInput(field, value, team) {
  var input;
  if (field.type === "choice" || field.type === "person") {
    input = document.createElement("select");
    var blank = document.createElement("option");
    blank.value = ""; blank.textContent = T.tmChoose; input.appendChild(blank);
    tvOptions(field, team, value).forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry.value; option.textContent = entry.label; input.appendChild(option);
    });
  } else if (field.type === "longtext") {
    input = document.createElement("textarea"); input.rows = 3; input.maxLength = 5000;
  } else {
    input = document.createElement("input");
    input.type = field.type === "checkbox" ? "checkbox" : field.type === "date" ? "date" :
      field.type === "number" || field.type === "money" ? "number" : "text";
    if (input.type === "number") input.step = "any";
    else if (input.type === "text") input.maxLength = 500;
  }
  input.className = "tv-editor";
  input.setAttribute("aria-label", field.name);
  if (field.type === "checkbox") input.checked = value === true;
  else input.value = value == null ? "" : value;
  return input;
}

function tvInputValue(input, field) {
  if (field.type === "checkbox") return input.checked;
  if (field.type === "number" || field.type === "money") return input.value === "" ? "" : Number(input.value);
  return input.value;
}

function tvValidInput(input, field) {
  if ((field.type === "number" || field.type === "money") && input.value !== "" && !Number.isFinite(Number(input.value))) {
    if (input.setCustomValidity) input.setCustomValidity(T.tmInvalidNumber);
    if (input.reportValidity) input.reportValidity();
    return false;
  }
  if (input.setCustomValidity) input.setCustomValidity("");
  return !input.checkValidity || input.checkValidity();
}

// A failed older request must never replace a newer edit still on screen.
function tvEditState(value) { return {version: 0, savedVersion: 0, saved: value}; }
function tvCommit(instance, edit, value, callback, recover, settled, fieldId) {
  var version = ++edit.version;
  return Promise.resolve().then(callback).then(function (row) {
    var saved = row && row.values && Object.prototype.hasOwnProperty.call(row.values, fieldId) ? row.values[fieldId] : value;
    if (version > edit.savedVersion) { edit.savedVersion = version; edit.saved = saved; }
    if (instance.alive && edit.version === version && settled) settled(edit.saved);
  }, function () {
    if (instance.alive && edit.version === version && recover) recover(edit.saved);
  });
}

function tvTableEditor(field, team) {
  return function (cell, onRendered, success, cancel) {
    var input = tvInput(field, cell.getValue(), team), ended = false;
    function save() {
      if (ended || !tvValidInput(input, field)) return;
      ended = true; success(tvInputValue(input, field));
    }
    input.addEventListener("change", function () { if (field.type !== "longtext") save(); });
    input.addEventListener("blur", save);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { ended = true; cancel(); }
      else if (event.key === "Enter" && (field.type !== "longtext" || event.ctrlKey || event.metaKey)) {
        event.preventDefault(); save();
      }
    });
    onRendered(function () { input.focus(); });
    return input;
  };
}

function tvRenderTable(el, ctx, instance) {
  var fields = ctx.tracker.fields || [];
  if (typeof Tabulator === "undefined") return tvFallbackTable(el, ctx, instance);
  var data = tvRows(ctx).map(function (row) { return Object.assign({id: row.id}, row.values || {}); });
  var columns = [{title: "", field: "_tvOpen", width: 62, headerSort: false, resizable: false,
    formatter: function () { return '<button type="button" class="tv-open" aria-label="' + tvEscape(T.tmOpenRecord) + '">' + tvEscape(T.tmOpen) + '</button>'; },
    cellClick: function (event, cell) { ctx.onOpen(cell.getRow().getData().id); }}];
  fields.forEach(function (field) {
    columns.push({title: tvEscape(field.name), field: field.id, minWidth: field.type === "longtext" ? 230 : 150,
      sorter: field.type === "choice" ? tvChoiceSorter(field) : field.type === "number" || field.type === "money" ? "number" : "string",
      formatter: function (cell) { return tvCellHtml(field, cell.getValue()); },
      editor: tvTableEditor(field, ctx.team)});
  });
  try {
    var table = new Tabulator(el, {data: data, columns: columns, index: "id", layout: "fitDataStretch",
      height: "min(65vh, 640px)", placeholder: tvEmptyText(ctx), columnHeaderVertAlign: "middle"});
    instance.destroyers.push(function () { table.destroy(); });
    var reverting = new Set(), edits = new Map();
    table.on("cellEdited", function (cell) {
      var fieldId = cell.getField(), rowId = cell.getRow().getData().id, key = rowId + "\n" + fieldId;
      if (reverting.has(key)) return;
      if (!edits.has(key)) edits.set(key, tvEditState(cell.getOldValue()));
      var value = cell.getValue();
      function showSaved(saved) {
        if (cell.getValue() === saved) return;
        reverting.add(key);
        try { cell.setValue(saved, true); } finally { reverting.delete(key); }
      }
      tvCommit(instance, edits.get(key), value, function () { return ctx.onEdit(rowId, fieldId, value); }, showSaved, showSaved, fieldId);
    });
    table.on("rowDblClick", function (event, row) { ctx.onOpen(row.getData().id); });
  } catch (error) {
    instance.destroyers.forEach(function (destroy) { try { destroy(); } catch (ignored) {} });
    instance.destroyers = [];
    el.innerHTML = "";
    tvFallbackTable(el, ctx, instance);
  }
}

function tvFallbackTable(el, ctx, instance) {
  var wrap = document.createElement("div"); wrap.className = "tv-table-wrap";
  var table = document.createElement("table"); table.className = "tv-table";
  var head = document.createElement("thead"), headRow = document.createElement("tr");
  var openHead = document.createElement("th"); openHead.textContent = T.tmOpen; headRow.appendChild(openHead);
  (ctx.tracker.fields || []).forEach(function (field) {
    var th = document.createElement("th"); th.textContent = field.name; th.scope = "col"; headRow.appendChild(th);
  });
  head.appendChild(headRow); table.appendChild(head);
  var body = document.createElement("tbody");
  tvRows(ctx).forEach(function (row) {
    var tr = document.createElement("tr"), td = document.createElement("td"), open = document.createElement("button");
    open.type = "button"; open.className = "tv-open"; open.textContent = T.tmOpen;
    open.setAttribute("aria-label", T.tmOpenRecord + ": " + tvTitle(ctx, row));
    open.addEventListener("click", function () { ctx.onOpen(row.id); }); td.appendChild(open); tr.appendChild(td);
    (ctx.tracker.fields || []).forEach(function (field) {
      var cell = document.createElement("td"), previous = (row.values || {})[field.id];
      var input = tvInput(field, previous, ctx.team), edit = tvEditState(previous);
      input.addEventListener("change", function () {
        if (!tvValidInput(input, field)) return;
        var value = tvInputValue(input, field);
        function showSaved(saved) {
          if (field.type === "checkbox") input.checked = saved === true;
          else input.value = saved == null ? "" : saved;
        }
        tvCommit(instance, edit, value, function () { return ctx.onEdit(row.id, field.id, value); }, showSaved, function (saved) {
          if (tvInputValue(input, field) === value) showSaved(saved);
        }, field.id);
      });
      cell.appendChild(input); tr.appendChild(cell);
    });
    body.appendChild(tr);
  });
  table.appendChild(body); wrap.appendChild(table); el.appendChild(wrap);
  if (!(ctx.rows || []).length) tvEmpty(el, ctx);
}

// "No records yet." or, when a search hides every record, "No records match."
function tvEmptyText(ctx) { return ctx && ctx.emptyText || T.tmEmpty; }

function tvEmpty(el, ctx) {
  var empty = document.createElement("p"); empty.className = "tv-empty"; empty.textContent = tvEmptyText(ctx); el.appendChild(empty);
}

// Choice columns sort in the order their choices are listed, with blanks last.
function tvChoiceSorter(field) {
  function place(value) {
    var index = (field.options || []).findIndex(function (o) { return o.id === value; });
    return index < 0 ? (field.options || []).length : index;
  }
  return function (a, b) { return place(a) - place(b); };
}

function tvRenderBoard(el, ctx, instance) {
  var field = tvViewField(ctx.tracker, "board");
  if (!field) return tvRenderTable(el, ctx, instance);
  var board = document.createElement("div"); board.className = "tv-board";
  var options = (field.options || []).map(function (o) { return {id: o.id, label: o.label, color: o.color}; });
  options.push({id: "", label: T.tmNoStatus, color: "grey"});
  var rowGroups = {}, lists = {}, moves = new Map();
  options.forEach(function (option) { rowGroups[option.id] = []; });
  tvRows(ctx).forEach(function (row) {
    var value = (row.values || {})[field.id];
    rowGroups[Object.prototype.hasOwnProperty.call(rowGroups, value) ? value : ""].push(row);
  });
  options.forEach(function (option) {
    var column = document.createElement("section"); column.className = "tv-board-column";
    var heading = document.createElement("h3");
    heading.className = "tv-board-heading tv-choice-" + (tvColorNames.indexOf(option.color) >= 0 ? option.color : "grey");
    var label = document.createElement("span"); label.textContent = option.label; heading.appendChild(label);
    var count = document.createElement("span"); count.className = "tv-count"; count.textContent = rowGroups[option.id].length;
    heading.appendChild(count); column.appendChild(heading);
    var list = document.createElement("div"); list.className = "tv-board-list"; list.dataset.value = option.id;
    list.setAttribute("aria-label", option.label); lists[option.id] = list;
    rowGroups[option.id].forEach(function (row) {
      var card = document.createElement("article"); card.className = "tv-board-card"; card.dataset.rowId = row.id;
      moves.set(row.id, tvEditState(option.id));
      var open = document.createElement("button"); open.type = "button"; open.className = "tv-card-title";
      open.textContent = tvTitle(ctx, row); open.addEventListener("click", function () { ctx.onOpen(row.id); });
      card.appendChild(open);
      (ctx.tracker.fields || []).slice(1).filter(function (f) {
        return f.id !== field.id && f.type !== "longtext" && (row.values || {})[f.id] !== "" && (row.values || {})[f.id] != null;
      }).slice(0, 3).forEach(function (f) {
        var line = document.createElement("div"); line.className = "tv-card-field";
        var name = document.createElement("span"); name.className = "tv-card-field-name"; name.textContent = f.name;
        var value = document.createElement("span"); value.innerHTML = tvCellHtml(f, (row.values || {})[f.id]);
        line.appendChild(name); line.appendChild(value); card.appendChild(line);
      });
      var select = document.createElement("select"); select.className = "tv-board-move";
      select.setAttribute("aria-label", T.tmMoveTo(tvTitle(ctx, row)));
      options.forEach(function (entry) {
        var opt = document.createElement("option"); opt.value = entry.id; opt.textContent = entry.label; select.appendChild(opt);
      });
      select.value = option.id;
      select.addEventListener("change", function () {
        var next = select.value;
        lists[next].appendChild(card); updateCounts();
        function showSaved(saved) {
          lists[saved].appendChild(card); select.value = saved; updateCounts();
        }
        tvCommit(instance, moves.get(row.id), next, function () { return ctx.onMove(row.id, field.id, next); }, showSaved, showSaved, field.id);
      });
      card.appendChild(select); list.appendChild(card);
    });
    column.appendChild(list);
    var add = document.createElement("button"); add.type = "button"; add.className = "tv-board-add"; add.textContent = "+ " + T.tmAdd;
    add.addEventListener("click", function () { var values = {}; values[field.id] = option.id; ctx.onAdd(values); });
    column.appendChild(add); board.appendChild(column);
  });
  function updateCounts() {
    options.forEach(function (o) {
      var list = lists[o.id], count = list.parentNode.querySelector(".tv-count");
      if (count) count.textContent = list.children.length;
    });
  }
  el.appendChild(board);
  if (typeof Sortable !== "undefined") options.forEach(function (option) {
    try {
      var sortable = new Sortable(lists[option.id], {group: "tracker-" + ctx.tracker.id, animation: 150,
        draggable: ".tv-board-card", filter: "select,input,a", preventOnFilter: false,
        delay: 180, delayOnTouchOnly: true, touchStartThreshold: 5,
        onAdd: function (event) {
          var card = event.item, select = card.querySelector(".tv-board-move");
          var next = event.to.dataset.value;
          if (select) select.value = next; updateCounts();
          function showSaved(saved) {
            lists[saved].appendChild(card); if (select) select.value = saved; updateCounts();
          }
          tvCommit(instance, moves.get(card.dataset.rowId), next, function () { return ctx.onMove(card.dataset.rowId, field.id, next); }, showSaved, showSaved, field.id);
        }});
      instance.destroyers.push(function () { sortable.destroy(); });
    } catch (ignored) { /* The move selector remains available. */ }
  });
}

function tvCalendarDate(event) {
  if (event.startStr) return String(event.startStr).slice(0, 10);
  if (event.start && typeof event.start.toISOString === "function") return event.start.toISOString().slice(0, 10);
  return event.start ? String(event.start).slice(0, 10) : "";
}

function tvRenderCalendar(el, ctx, instance) {
  var field = tvViewField(ctx.tracker, "calendar");
  if (!field) return tvRenderTable(el, ctx, instance);
  if (typeof FullCalendar === "undefined" || !FullCalendar.Calendar) return tvFallbackCalendar(el, ctx, instance, field);
  var calendarEl = document.createElement("div"); calendarEl.className = "tv-calendar"; el.appendChild(calendarEl);
  var phone = typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches;
  var rows = tvRows(ctx), moves = new Map();
  rows.forEach(function (row) { moves.set(row.id, tvEditState((row.values || {})[field.id] || "")); });
  try {
    var calendar = new FullCalendar.Calendar(calendarEl, {initialView: phone ? "listMonth" : "dayGridMonth",
      height: "auto", headerToolbar: {left: "prev,next today", center: "title", right: phone ? "listMonth,dayGridMonth" : "dayGridMonth,listMonth"},
      buttonText: {today: T.tmToday, month: T.tmMonth, list: T.tmList}, buttonHints: {prev: T.tmPrevious, next: T.tmNext, today: T.tmToday},
      allDayText: T.tmAllDay, noEventsText: tvEmptyText(ctx), moreLinkText: function (n) { return T.tmMore(n); },
      editable: true, eventDurationEditable: false, dayMaxEvents: true, eventOrder: "sort,title",
      events: rows.filter(function (row) { return (row.values || {})[field.id]; }).map(function (row) {
        return {id: row.id, title: tvTitle(ctx, row), start: row.values[field.id], allDay: true, sort: row.sort || 0};
      }),
      eventClick: function (info) { if (info.jsEvent) info.jsEvent.preventDefault(); ctx.onOpen(info.event.id); },
      dateClick: function (info) { var values = {}; values[field.id] = info.dateStr.slice(0, 10); ctx.onAdd(values); },
      eventDrop: function (info) {
        var value = tvCalendarDate(info.event);
        if (!moves.has(info.event.id)) moves.set(info.event.id, tvEditState(tvCalendarDate(info.oldEvent || {})));
        tvCommit(instance, moves.get(info.event.id), value, function () { return ctx.onMove(info.event.id, field.id, value); }, function (saved) {
          if (info.event.setStart) info.event.setStart(saved);
          else info.revert();
        }, function (saved) { if (saved !== value && info.event.setStart) info.event.setStart(saved); }, field.id);
      }});
    instance.destroyers.push(function () { calendar.destroy(); });
    calendar.render();
    tvUndated(el, ctx, field);
  } catch (error) {
    instance.destroyers.forEach(function (destroy) { try { destroy(); } catch (ignored) {} });
    instance.destroyers = []; el.innerHTML = "";
    tvFallbackCalendar(el, ctx, instance, field);
  }
}

function tvRecordButton(ctx, row) {
  var button = document.createElement("button"); button.type = "button"; button.className = "tv-calendar-record";
  button.textContent = tvTitle(ctx, row); button.addEventListener("click", function () { ctx.onOpen(row.id); });
  return button;
}

function tvUndated(el, ctx, field) {
  var rows = tvRows(ctx).filter(function (row) { return !(row.values || {})[field.id]; });
  if (!rows.length) return;
  var section = document.createElement("section"); section.className = "tv-undated";
  var heading = document.createElement("h3"); heading.textContent = T.tmNoDate; section.appendChild(heading);
  rows.forEach(function (row) { section.appendChild(tvRecordButton(ctx, row)); }); el.appendChild(section);
}

function tvFallbackCalendar(el, ctx, instance, field) {
  var controls = document.createElement("div"); controls.className = "tv-calendar-add";
  var day = tvInput(field, "", ctx.team), add = document.createElement("button");
  add.type = "button"; add.className = "secondary"; add.textContent = "+ " + T.tmAdd; add.disabled = true;
  day.addEventListener("change", function () { add.disabled = !day.value; });
  add.addEventListener("click", function () { if (day.value) { var values = {}; values[field.id] = day.value; ctx.onAdd(values); } });
  controls.appendChild(day); controls.appendChild(add); el.appendChild(controls);
  var dates = {}, groups = new Map();
  tvRows(ctx).forEach(function (row) {
    var date = (row.values || {})[field.id] || ""; (dates[date] || (dates[date] = [])).push(row);
  });
  function dateCompare(a, b) { return a === b ? 0 : !a ? 1 : !b ? -1 : a.localeCompare(b); }
  function groupFor(date) {
    if (groups.has(date)) return groups.get(date);
    var section = document.createElement("section"); section.className = date ? "tv-calendar-day" : "tv-undated";
    var heading = document.createElement("h3"); heading.textContent = date || T.tmNoDate; section.appendChild(heading);
    var next = Array.from(groups.keys()).sort(dateCompare).find(function (key) { return dateCompare(key, date) > 0; });
    el.insertBefore(section, groups.get(next) || null); groups.set(date, section);
    return section;
  }
  function regroup(line, saved) {
    var old = line.parentNode;
    groupFor(saved).appendChild(line);
    if (old.children.length === 1) {
      groups.forEach(function (section, key) { if (section === old) groups.delete(key); });
      old.parentNode.removeChild(old);
    }
  }
  Object.keys(dates).sort(dateCompare).forEach(function (date) {
    var section = groupFor(date);
    dates[date].forEach(function (row) {
      var line = document.createElement("div"); line.className = "tv-calendar-line";
      line.appendChild(tvRecordButton(ctx, row));
      var input = tvInput(field, date, ctx.team), edit = tvEditState(date);
      input.addEventListener("change", function () {
        var next = input.value;
        tvCommit(instance, edit, next, function () { return ctx.onMove(row.id, field.id, next); }, function (saved) {
          input.value = saved; regroup(line, saved);
        }, function (saved) {
          if (input.value === next) input.value = saved;
          regroup(line, saved);
        }, field.id);
      });
      line.appendChild(input); section.appendChild(line);
    });
  });
  if (!(ctx.rows || []).length) tvEmpty(el, ctx);
}

function tvDestroy(el) {
  var instance = tvInstances.get(el);
  if (instance) {
    instance.alive = false;
    instance.destroyers.forEach(function (destroy) { try { destroy(); } catch (ignored) {} });
    tvInstances.delete(el);
  }
  el.innerHTML = "";
}

function tvRender(el, view, ctx) {
  tvDestroy(el);
  var instance = {alive: true, destroyers: []}; tvInstances.set(el, instance);
  el.classList.add("tv-view");
  if (view === "board") tvRenderBoard(el, ctx, instance);
  else if (view === "calendar") tvRenderCalendar(el, ctx, instance);
  else tvRenderTable(el, ctx, instance);
}
