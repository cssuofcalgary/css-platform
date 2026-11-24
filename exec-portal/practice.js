// CSS Exec Portal — practice mode for event day (Events tab → "Practice event").
// Makes a clearly fake event with fake attendees, shows each one's QR code with what scanning it should do, prints it,
// and removes it all again. QR codes are drawn here with the same library as the Join QR (no outside service).

const practiceState = { sheet: null, busy: false };
const PRACTICE_COLORS = { GREEN: "#3f7a45", ORANGE: "#b9650a", RED: "#a12b2b" };

/** One QR code as a PNG data address (always black on white, so phones can scan it from a screen or paper). */
function practiceQr(text) {
  if (typeof QRCode === "undefined") return "";
  const holder = document.createElement("div");
  new QRCode(holder, { text, width: 360, height: 360, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
  const canvas = holder.querySelector("canvas");
  if (!canvas) return "";
  const padded = document.createElement("canvas");
  padded.width = canvas.width + 64;
  padded.height = canvas.height + 64;
  const drawing = padded.getContext("2d");
  drawing.fillStyle = "#ffffff";
  drawing.fillRect(0, 0, padded.width, padded.height);
  drawing.drawImage(canvas, 32, 32);
  return padded.toDataURL("image/png");
}

function practiceDialog() {
  let dialog = $("practice-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "practice-dialog";
  dialog.className = "edit-dialog practice-dialog";
  dialog.setAttribute("aria-labelledby", "practice-title");
  dialog.innerHTML = `
    <h2 id="practice-title" tabindex="-1">${escapeHtml(T.practiceTitle)}</h2>
    <ol class="practice-steps">${T.practiceSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
    <p id="practice-counts" class="muted small"></p>
    <div id="practice-cards" class="practice-cards"></div>
    <p id="practice-error" class="error" role="alert" hidden></p>
    <div class="button-row">
      <button type="button" id="practice-print" class="secondary">${escapeHtml(T.practicePrint)}</button>
      <button type="button" id="practice-remove" class="secondary danger">${escapeHtml(T.practiceRemove)}</button>
      <button type="button" id="practice-close" class="primary">${escapeHtml(T.close)}</button>
    </div>`;
  document.body.appendChild(dialog);
  $("practice-close").addEventListener("click", () => dialog.close());
  $("practice-print").addEventListener("click", printPracticeSheet);
  $("practice-remove").addEventListener("click", removePracticeEvent);
  return dialog;
}

function practiceCardsHtml(sheet, forPrint) {
  return sheet.cards.map((c) => {
    const img = c.qr ? `<img src="${c.qr}" alt="">` : `<p class="error">${escapeHtml(T.joinQrFailed)}</p>`;
    return `<div class="practice-card" style="border-color:${PRACTICE_COLORS[c.expect]}">
      <div class="practice-n">#${c.n}</div>${img}
      <b>${escapeHtml(c.name)}</b>
      <small>${escapeHtml([c.ticketType, c.ticketId].filter(Boolean).join(" · "))}</small>
      <span class="practice-expect" style="background:${PRACTICE_COLORS[c.expect]}">${escapeHtml(T.practiceExpect[c.expect])}</span>
      <small>${escapeHtml(c.note)}</small>
    </div>`;
  }).join("") + (forPrint ? "" : "");
}

function showPracticeSheet(sheet) {
  sheet.cards.forEach((c) => { if (!c.qr) c.qr = practiceQr(c.link); });
  practiceState.sheet = sheet;
  const dialog = practiceDialog();
  const n = (k) => sheet.cards.filter((c) => c.expect === k).length;
  $("practice-counts").textContent = T.practiceCounts(n("GREEN"), n("ORANGE"), n("RED"));
  $("practice-cards").innerHTML = practiceCardsHtml(sheet, false);
  $("practice-error").textContent = sheet.archived ? T.practiceArchived : "";
  $("practice-error").hidden = !sheet.archived;
  $("practice-print").disabled = !!sheet.archived;
  $("practice-remove").disabled = false;
  if (!dialog.open) {
    dialog.showModal();
    $("practice-title").focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }
}

async function openPractice() {
  if (practiceState.busy) return;
  practiceState.busy = true;
  try {
    let reply = await api("practiceSheet");
    if (reply.ok && !reply.exists) {
      if (!(await askConfirm(T.practiceConfirm, T.practiceCreate))) return;
      reply = await api("createPracticeEvent");
      if (reply.ok) { eventsState.loaded = false; loadEvents(); }
    }
    if (!reply.ok) {
      if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
      return showToast(errorText(reply));
    }
    showPracticeSheet(reply);
  } finally { practiceState.busy = false; }
}

async function removePracticeEvent() {
  if (!(await askConfirm(T.practiceRemoveConfirm, T.practiceRemove))) return;
  $("practice-remove").disabled = true;
  const reply = await api("removePracticeEvent");
  if (!reply.ok) {
    $("practice-remove").disabled = false;
    if (reply.error === "NOT_LOGGED_IN") { $("practice-dialog").close(); signOutLocally(); return showLogin(errorText(reply)); }
    $("practice-error").textContent = errorText(reply);
    $("practice-error").hidden = false;
    return;
  }
  $("practice-dialog").close();
  practiceState.sheet = null;
  eventsState.loaded = false;
  loadEvents();
  showToast(T.practiceRemoved, "success");
}

/** Prints only the sheet (a hidden frame, like the Join QR), so it can be handed to volunteers or laid on a table. */
function printPracticeSheet() {
  const sheet = practiceState.sheet;
  if (!sheet) return;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><title>${escapeHtml(T.practiceTitle)}</title><style>
    @page{margin:10mm}body{font:13px system-ui,sans-serif;color:#000;background:#fff;margin:0}
    h1{font-size:20px;margin:0 0 6px}ol{margin:0 0 10px;padding-left:20px}
    .practice-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .practice-card{border:3px solid;border-radius:8px;padding:8px;text-align:center;break-inside:avoid;display:grid;gap:3px;justify-items:center}
    .practice-card img{width:120px;height:120px}.practice-n{font:700 15px monospace}small{color:#333}
    .practice-expect{color:#fff;font:700 11px monospace;border-radius:4px;padding:3px 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  </style></head><body><h1>${escapeHtml(T.practiceTitle)}</h1><ol>${T.practiceSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
  <div class="practice-cards">${practiceCardsHtml(sheet, true)}</div></body></html>`);
  doc.close();
  const imgs = [...doc.images];
  const go = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); };
  Promise.all(imgs.map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))).then(go);
}

(function addPracticeButton() {
  const add = $("new-event-button");
  if (!add || $("practice-button")) return;
  const btn = document.createElement("button");
  btn.id = "practice-button";
  btn.type = "button";
  btn.className = "secondary small-button";
  btn.textContent = T.practiceButton;
  btn.addEventListener("click", openPractice);
  add.before(btn);
})();
