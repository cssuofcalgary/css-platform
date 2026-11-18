// Exec-only notes live in the platform data sheet, separate from the membership list.
// Keep member IDs and the membership year when moving that list into platform storage.

function notesMember_(memberId) {
  const member = findMemberById_(loadMembers_(), memberId);
  if (!member) throw new ApiError_("NOT_FOUND", "No member with that ID.");
  return member;
}

function listMemberNotes_(memberId) {
  const member = notesMember_(memberId);
  const year = membershipYear_();
  const notes = readRows_("MemberNotes").filter(function (n) { return n.memberId === member.memberId && n.year === year; })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return { ok: true, notes: notes };
}

function addMemberNote_(session, memberId, text) {
  const raw = String(text === undefined || text === null ? "" : text).trim();
  if (!raw || raw.length > 500) throw new ApiError_("BAD_REQUEST", "Enter a note of up to 500 characters.");
  const clean = memberText_(raw, 500);   // plain text, safe for a sheet cell
  if (!clean) throw new ApiError_("BAD_REQUEST", "Enter a note of up to 500 characters.");
  const note = withLock_(function () {
    const member = notesMember_(memberId);
    const entry = { id: Utilities.getUuid(), memberId: member.memberId, year: membershipYear_(), text: clean,
      createdBy: memberText_(session.name, 80), createdAt: new Date().toISOString() };
    insertRow_("MemberNotes", entry);
    return entry;
  });
  log_(session.name, "member.note", note.memberId, { noteId: note.id });
  return { ok: true, note: note };
}
