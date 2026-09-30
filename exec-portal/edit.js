// CSS Exec Portal — the "Edit person" panel (used from Payments and from the attendee list).
// Every exec can fix a name or email. Admins also get UCID, member ID, ticket type, answers,
// the help-desk flag and the order's payer details. Only what really changed is sent.

const editState = { ctx: null, onSaved: null };

/**
 * ctx = { ticket: {id, name, email, ucid, memberId, ticketType, answers, flag},
 *         order:  {id, code, payerName, payerEmail, etransferName, notes},
 *         event:  {ticketTypes, questions} }
 */
function openEditDialog(ctx, onSaved) {
  editState.ctx = ctx;
  editState.onSaved = onSaved;
  const { ticket, order, event } = ctx;
  const isAdmin = state.role === "admin";

  $("edit-who").textContent = `${ticket.ticketType} · ${order.code || ""}`;
  $("ed-name").value = ticket.name || "";
  $("ed-email").value = ticket.email || "";
  $("edit-admin").hidden = !isAdmin;
  $("edit-locked").hidden = isAdmin;

  if (isAdmin) {
    $("ed-ucid").value = ticket.ucid || "";
    $("ed-member").value = ticket.memberId || "";
    $("ed-flag").value = ticket.flag || "";
    const types = event.ticketTypes || [];
    const current = types.find((t) => t.name === ticket.ticketType);
    // A ticket whose type was since renamed or removed stays selectable as "(as booked)".
    $("ed-type").innerHTML = (current ? "" : `<option value="">${escapeHtml(ticket.ticketType)} (as booked)</option>`) +
      types.map((t) => `<option value="${escapeHtml(t.id)}" ${current && t.id === current.id ? "selected" : ""}>${escapeHtml(t.name)} · ${money(t.price)}</option>`).join("");
    $("ed-answers").innerHTML = (event.questions || []).map((q, i) => {
      const value = (ticket.answers || {})[q.label] || "";
      const input = q.type === "choice"
        ? `<select data-q="${i}"><option value=""></option>${(q.options || []).map((o) =>
            `<option ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>`
        : `<input data-q="${i}" maxlength="300" value="${escapeHtml(value)}">`;
      return `<label>${escapeHtml(q.label)}</label>${input}`;
    }).join("");
    $("ed-order-title").textContent = T.editOrderTitle(order.code || "");
    $("ed-payer-name").value = order.payerName || "";
    $("ed-payer-email").value = order.payerEmail || "";
    $("ed-etransfer").value = order.etransferName || "";
    $("ed-notes").value = order.notes || "";
  }

  setEditError("");
  setEditBusy(false);
  $("edit-dialog").showModal();
  $("ed-name").focus();
}

/** Only the fields whose value differs from what the person has now. */
function collectEditChanges() {
  const { ticket, order, event } = editState.ctx;
  const changes = {}, orderChanges = {};
  const diff = (target, key, value, before) => { if (String(value).trim() !== String(before ?? "").trim()) target[key] = value; };

  diff(changes, "name", $("ed-name").value, ticket.name);
  diff(changes, "email", $("ed-email").value, ticket.email);
  if (state.role === "admin") {
    diff(changes, "ucid", $("ed-ucid").value, ticket.ucid);
    diff(changes, "memberId", $("ed-member").value, ticket.memberId);
    diff(changes, "flag", $("ed-flag").value, ticket.flag);
    const current = (event.ticketTypes || []).find((t) => t.name === ticket.ticketType);
    const picked = $("ed-type").value;
    if (picked && (!current || picked !== current.id)) changes.ticketTypeId = picked;

    const answers = {};
    document.querySelectorAll("#ed-answers [data-q]").forEach((input) => {
      const q = event.questions[Number(input.dataset.q)];
      if (input.value.trim() !== String((ticket.answers || {})[q.label] || "").trim()) answers[q.label] = input.value;
    });
    if (Object.keys(answers).length) changes.answers = answers;

    diff(orderChanges, "payerName", $("ed-payer-name").value, order.payerName);
    diff(orderChanges, "payerEmail", $("ed-payer-email").value, order.payerEmail);
    diff(orderChanges, "etransferName", $("ed-etransfer").value, order.etransferName);
    diff(orderChanges, "notes", $("ed-notes").value, order.notes);
  }
  return { changes, orderChanges };
}

async function onEditSubmit(event) {
  event.preventDefault();
  const { changes, orderChanges } = collectEditChanges();
  if (!Object.keys(changes).length && !Object.keys(orderChanges).length) return setEditError(T.editNothing);

  setEditBusy(true);
  const reply = await api("updateTicket", {
    ticketId: editState.ctx.ticket.id, changes, orderChanges,
    siteUrl: new URL(PUBLIC_SITE_URL, location.href).href
  });
  if (!reply.ok) {
    setEditBusy(false);
    if (reply.error === "NOT_LOGGED_IN") { $("edit-dialog").close(); return handleEventError(reply, $("edit-error")); }
    return setEditError(errorText(reply));
  }
  $("edit-dialog").close();
  const message = [T.edited(reply.emailsSent), reply.total && reply.total.was !== reply.total.now
    ? T.editedTotal(reply.total.was, reply.total.now, reply.orderStatus) : ""].filter(Boolean).join(" ");
  if (editState.onSaved) editState.onSaved(message);
}

function setEditBusy(busy) {
  $("edit-save").disabled = busy;
  $("edit-save").textContent = busy ? T.editSaving : T.editSave;
}

function setEditError(text) {
  $("edit-error").textContent = text;
  $("edit-error").hidden = !text;
}

$("edit-form").addEventListener("submit", onEditSubmit);
$("edit-cancel").addEventListener("click", () => $("edit-dialog").close());
