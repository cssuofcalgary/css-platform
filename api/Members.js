/**
 * CSS Platform API — the Member model.
 *
 * Pure logic, no Google calls: turns spreadsheet rows into Member objects and
 * searches them. The rest of the platform only ever sees Member objects, so the
 * sheet layout can change (or move to a real database) without touching the pages.
 */

/** Which spreadsheet column feeds each Member field. Matched by header text, never by position. */
const MEMBER_COLUMNS = {
  name:          ["Full Name", "Name"],
  ucid:          ["UCID", "Student ID"],
  email:         ["Email", "Email Address"],
  memberId:      ["Member ID", "CSS Member ID"],
  paid:          ["Paid Status", "Paid"],
  mailStatus:    ["Mail Status"],
  signedUp:      ["Timestamp"],
  paymentMethod: ["Payment method"],
  paymentWhen:   ["When"],
  paymentWhere:  ["Where"],
  paymentWho:    ["Who"]
};

function normalizeHeader_(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Returns { field: columnIndex } for every Member field (-1 when the column is missing). */
function mapMemberColumns_(headerRow) {
  const normalized = headerRow.map(normalizeHeader_);
  const columns = {};
  Object.keys(MEMBER_COLUMNS).forEach(function (field) {
    columns[field] = -1;
    const candidates = MEMBER_COLUMNS[field];
    for (let i = 0; i < candidates.length; i++) {
      const index = normalized.indexOf(normalizeHeader_(candidates[i]));
      if (index !== -1) { columns[field] = index; break; }
    }
  });
  return columns;
}

function cellText_(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value === null || value === undefined ? "" : value).trim();
}

function isYes_(value) {
  if (value === true) return true;
  const text = cellText_(value).toUpperCase();
  return text === "TRUE" || text === "YES" || text === "Y" || text === "PAID" || text === "1" || text === "✓";
}

/** values = the whole tab as a 2D array (row 0 = headers). */
function rowsToMembers_(values) {
  if (!values || values.length < 2) return [];
  const columns = mapMemberColumns_(values[0]);
  const read = function (row, field) {
    return columns[field] === -1 ? "" : row[columns[field]];
  };

  const members = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const name = cellText_(read(row, "name"));
    if (!name) continue;

    members.push({
      memberId: cellText_(read(row, "memberId")).toUpperCase(),
      name: name,
      ucid: cellText_(read(row, "ucid")),
      email: cellText_(read(row, "email")),
      paid: isYes_(read(row, "paid")),
      cardSent: cellText_(read(row, "mailStatus")).toLowerCase() === "sent",
      signedUp: cellText_(read(row, "signedUp")),
      payment: {
        method: cellText_(read(row, "paymentMethod")),
        when: cellText_(read(row, "paymentWhen")),
        where: cellText_(read(row, "paymentWhere")),
        who: cellText_(read(row, "paymentWho"))
      }
    });
  }
  return members;
}

/**
 * Finds members by name, UCID, member ID or email. Best matches first.
 * Queries shorter than 2 characters return nothing.
 */
function searchMembers_(members, query, limit) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const digits = q.replace(/\D/g, "");

  const scored = [];
  members.forEach(function (m) {
    const name = m.name.toLowerCase();
    const id = m.memberId.toLowerCase();
    const email = m.email.toLowerCase();
    let score = 0;

    if (id && id === q) score = 100;
    else if (m.ucid && digits && m.ucid === digits && digits === q) score = 95;
    else if (email && email === q) score = 90;
    else if (name === q) score = 80;
    else if (words.every(function (w) { return name.indexOf(w) !== -1; })) {
      score = name.indexOf(words[0]) === 0 ? 70 : 60;
    }
    else if (id && id.indexOf(q) !== -1) score = 40;
    else if (m.ucid && digits.length >= 4 && digits === q && m.ucid.indexOf(digits) === 0) score = 40;
    else if (email && email.indexOf(q) !== -1) score = 30;

    if (score > 0) scored.push({ score: score, member: m });
  });

  scored.sort(function (a, b) {
    return b.score - a.score || a.member.name.localeCompare(b.member.name);
  });
  return scored.slice(0, limit || 25).map(function (s) { return s.member; });
}

function findMemberById_(members, memberId) {
  const id = String(memberId || "").trim().toUpperCase();
  if (!id) return null;
  for (let i = 0; i < members.length; i++) {
    if (members[i].memberId === id) return members[i];
  }
  return null;
}
