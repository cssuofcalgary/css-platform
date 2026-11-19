// Exec-only notes live in the platform data sheet, separate from the membership list.
// Keep member IDs and the membership year when moving that list into platform storage.

function notesMember_(memberId) {
  const member = findMemberById_(loadMembers_(), memberId);
  if (!member) throw new ApiError_("NOT_FOUND", "No member with that ID.");
  return member;
}

/** A note keeps its line breaks and a leading dash ("- called, will pay Fri"). Only a sheet formula is made harmless. */
function noteText_(value) {
  let text = String(value === undefined || value === null ? "" : value)
    .replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (/^[=+\-@]/.test(text)) text = "'" + text;   // Sheets shows it as typed instead of treating it as a formula
  return text;
}

function listMemberNotes_(memberId) {
  const member = notesMember_(memberId);
  const year = membershipYear_();
  const notes = readRows_("MemberNotes").filter(function (n) { return n.memberId === member.memberId && n.year === year && !n.removedAt; })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .map(function (n) { return { id: n.id, text: String(n.text || "").replace(/^'/, ""), createdBy: n.createdBy, createdAt: n.createdAt }; });
  return { ok: true, notes: notes };
}

function addMemberNote_(session, memberId, text) {
  const raw = String(text === undefined || text === null ? "" : text).trim();
  if (!raw || raw.length > 500) throw new ApiError_("BAD_REQUEST", "Enter a note of up to 500 characters.");
  const clean = noteText_(raw);
  if (!clean) throw new ApiError_("BAD_REQUEST", "Enter a note of up to 500 characters.");
  // Adding one row needs no lock: it never changes anything else (and the payments lock stays free for the door).
  const member = notesMember_(memberId);
  const note = { id: Utilities.getUuid(), memberId: member.memberId, year: membershipYear_(), text: clean,
    createdBy: memberText_(session.name, 80), createdAt: new Date().toISOString(), removedAt: "", removedBy: "" };
  insertRow_("MemberNotes", note);
  log_(session.name, "member.note", note.memberId, { noteId: note.id });
  return { ok: true, note: { id: note.id, text: raw, createdBy: note.createdBy, createdAt: note.createdAt } };
}

/** A note written by mistake: the person who wrote it, or the admin, can remove it. It is kept in the sheet, marked removed. */
function removeMemberNote_(session, noteId) {
  return withLock_(function () {
    delete DB_.rows["MemberNotes"];
    const note = readRows_("MemberNotes").filter(function (n) { return n.id === String(noteId || ""); })[0];
    if (!note || note.removedAt) throw new ApiError_("NOT_FOUND", "That note is no longer there.");
    if (session.role !== "admin" && note.createdBy !== memberText_(session.name, 80)) {
      throw new ApiError_("ADMIN_ONLY", "Only " + note.createdBy + " or the admin can remove this note.");
    }
    updateRow_("MemberNotes", note.id, { removedAt: new Date().toISOString(), removedBy: session.name }, note._row);
    log_(session.name, "member.noteRemoved", note.memberId, { noteId: note.id });
    return { ok: true };
  });
}
