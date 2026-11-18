// Shared notes for the open member. Ignore replies for a page that has since changed.
const noteState = { request: 0 };

async function loadMemberNotes(member) {
  const request = ++noteState.request;
  $("member-notes").hidden = !member.memberId;
  $("member-note-form").hidden = !member.memberId;
  $("member-note-text").value = "";
  $("member-note-text").disabled = false;
  $("member-note-save").disabled = false;
  $("member-note-save").textContent = T.memberNoteAdd;
  $("member-note-error").hidden = true;
  $("member-notes-list").innerHTML = "";
  $("member-notes-status").textContent = member.memberId ? T.pendingLoading : "";
  if (!member.memberId) return;
  const reply = await api("listMemberNotes", { memberId: member.memberId });
  if (request !== noteState.request || state.member !== member) return;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
    $("member-notes-status").textContent = errorText(reply);
    return;
  }
  renderMemberNotes(reply.notes);
}

function renderMemberNotes(notes) {
  $("member-notes-status").textContent = notes.length ? "" : T.memberNotesNone;
  $("member-notes-list").innerHTML = notes.map((n) => `<li>
    <p>${escapeHtml(n.text)}</p>
    <span class="muted small">${escapeHtml(T.memberNoteBy(n.createdBy, formatDate(n.createdAt)))}</span>
  </li>`).join("");
}

$("member-note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const member = state.member;
  if (!member?.memberId || $("member-note-save").disabled) return;
  const text = $("member-note-text").value;
  const request = noteState.request;
  $("member-note-save").disabled = true;
  $("member-note-text").disabled = true;
  $("member-note-save").textContent = T.memberNoteSaving;
  $("member-note-error").hidden = true;
  const reply = await api("addMemberNote", { memberId: member.memberId, text });
  if (request !== noteState.request || state.member !== member) return;
  $("member-note-save").disabled = false;
  $("member-note-text").disabled = false;
  $("member-note-save").textContent = T.memberNoteAdd;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
    $("member-note-error").textContent = errorText(reply);
    $("member-note-error").hidden = false;
    return;
  }
  await loadMemberNotes(member);
  showToast(T.memberNoteSaved, "success");
});
