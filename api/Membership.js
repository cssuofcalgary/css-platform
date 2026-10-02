/**
 * CSS Platform API — joining the club (replaces the Google Form).
 *
 * A student signs up on the public page; the sign-up becomes one new row on the Membership sheet, in the same
 * columns the old form used, so the sheet, the member search and the old tools all keep working. An exec marks it
 * paid from the Members tab, which flips "Paid Status" and emails the member their pass.
 *
 * This is the only code that WRITES to the Membership sheet (the sheet access itself lives in Store.js).
 */

const MEMBERSHIP_FEE = 12;
const MEMBERSHIP_YEAR = "2026/2027";
const MEMBER_PAID_STATUS = "PAID";
const MEMBER_METHODS = { etransfer: "E-transfer", cash: "Cash" };
const MEMBER_STATUS_WAITING = { etransfer: "Awaiting E-transfer", cash: "Awaiting Cash" };
const MEMBER_SIGNUP_BURST = 40;   // sign-ups from everyone together, per 10 minutes (keeps bots from filling the sheet)

// ---- Checking what was typed -------------------------------------------------------------

/** One line of text for a sheet cell: no control characters, and never something Sheets could read as a formula. */
function memberText_(value, max) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^[=+\-@'\s]+/, "")
    .slice(0, max);
}

function cleanMemberInput_(input) {
  input = input || {};
  const name = memberText_(input.name, 80);
  const ucid = String(input.ucid || "").replace(/\s+/g, "");
  const email = String(input.email || "").trim().toLowerCase();
  const method = String(input.method || "").toLowerCase();

  if (name.length < 2 || name.indexOf(" ") === -1) throw new ApiError_("BAD_REQUEST", "Please enter your full name (first and last).");
  if (!/^\d{8}$/.test(ucid)) throw new ApiError_("BAD_REQUEST", "Your UCID is the 8-digit student number on your UCard.");
  if (email.length > 120 || !/^[a-z0-9][a-z0-9._%+'-]*@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email)) throw new ApiError_("BAD_REQUEST", "That email doesn't look right.");
  if (!MEMBER_METHODS[method]) throw new ApiError_("BAD_REQUEST", "Choose how you are paying: e-transfer or cash.");

  const clean = { name: name, ucid: ucid, email: email, method: method, when: "", where: "", who: "" };
  if (method === "cash") {
    const when = String(input.when || "").trim();
    if (when && !/^\d{4}-\d{2}-\d{2}$/.test(when)) throw new ApiError_("BAD_REQUEST", "That payment date doesn't look right.");
    clean.when = when || Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");
    clean.where = memberText_(input.where, 120);
    clean.who = memberText_(input.who, 80);
  }
  return clean;
}

/** Same person if the UCID or the email matches. */
function sameMember_(member, clean) {
  return (member.ucid && String(member.ucid).replace(/\D/g, "") === clean.ucid) ||
    (member.email && String(member.email).toLowerCase() === clean.email);
}

function methodKey_(text) {
  return /cash/i.test(String(text || "")) ? "cash" : "etransfer";
}

function memberSignupThrottle_(clean) {
  const cache = CacheService.getScriptCache();
  const total = parseInt(cache.get("member_signup_total") || "0", 10);
  if (total >= MEMBER_SIGNUP_BURST) throw new ApiError_("TOO_MANY_TRIES", "A lot of people are signing up right now. Please try again in a few minutes.");
  const key = "member_signup_" + clean.ucid;
  const tries = parseInt(cache.get(key) || "0", 10);
  if (tries >= 5) throw new ApiError_("TOO_MANY_TRIES", "Too many tries with that UCID. Please wait 10 minutes.");
  cache.put("member_signup_total", String(total + 1), 600);
  cache.put(key, String(tries + 1), 600);
}

// ---- Public: sign up --------------------------------------------------------------------

/**
 * Inside the lock: adds the sign-up as a new row, or returns the member who is already on the sheet (same UCID or email).
 * Returns { existing: member } or { memberId }.
 */
function addMemberRowLocked_(clean) {
  const book = openMemberSheet_();
  const existing = book.members.filter(function (m) { return sameMember_(m, clean); });
  const paid = existing.filter(function (m) { return m.paid; })[0];
  if (existing.length) return { existing: paid || existing[0] };

  const memberId = nextMemberId_(book);
  appendMemberRow_(book, {
    signedUp: new Date(), name: clean.name, ucid: clean.ucid, email: clean.email, memberId: memberId,
    paid: MEMBER_STATUS_WAITING[clean.method], mailStatus: "Pending",
    paymentMethod: MEMBER_METHODS[clean.method], paymentWhen: clean.when, paymentWhere: clean.where, paymentWho: clean.who
  });
  return { memberId: memberId };
}

/** Public (no login). Adds one row to the Membership sheet, or tells the person where they stand if they already have one. */
function publicRegisterMember_(input) {
  if (input && input.website) throw new ApiError_("BAD_REQUEST", "Please try again.");   // hidden field only bots fill in
  const clean = cleanMemberInput_(input);
  memberSignupThrottle_(clean);

  const done = withIntakeLock_(function () { return addMemberRowLocked_(clean); });
  if (done.existing && done.existing.paid) throw new ApiError_("ALREADY_MEMBER", "You are already an active CSS member for " + MEMBERSHIP_YEAR + "!");

  if (done.memberId) log_("public", "member.signup", done.memberId, { method: clean.method });
  const reply = { ok: true, name: done.existing ? done.existing.name : clean.name, method: done.existing ? methodKey_(done.existing.payment.method) : clean.method,
    fee: MEMBERSHIP_FEE, year: MEMBERSHIP_YEAR, etransferEmail: getConfig_().etransferEmail, site: siteInfo_() };
  if (done.existing) reply.existing = true; else reply.memberId = done.memberId;   // someone already signed up and unpaid gets no ID back
  return reply;
}

/**
 * Exec adds a member by hand (a sign-up at the table, or someone who paid before the form existed). Any exec (checked by
 * the caller). With paidNow the payment is confirmed in the same step: marked PAID and the pass is emailed.
 */
function addMember_(session, input, paidNow) {
  input = input || {};
  if (input.method === "cash" && !String(input.who || "").trim()) input.who = session.name;   // the exec adding it took the cash
  const clean = cleanMemberInput_(input);

  const done = withIntakeLock_(function () { return addMemberRowLocked_(clean); });
  if (done.existing) {
    throw new ApiError_(done.existing.paid ? "ALREADY_MEMBER" : "ALREADY_SIGNED_UP",
      done.existing.name + (done.existing.paid ? " is already a paid member (" + done.existing.memberId + ")." : " has already signed up and is waiting on payment. Search for them and tap Mark paid."));
  }
  log_(session.name, "member.add", done.memberId, { name: clean.name, method: clean.method, paidNow: paidNow ? 1 : 0 });
  if (!paidNow) return { ok: true, memberId: done.memberId };
  const paid = markMemberPaid_(session, done.memberId);
  return { ok: true, memberId: done.memberId, paid: true, emailed: paid.emailed };
}

/** "CSS" + the row number + 4 random digits: the same look the old Generate-IDs button made, and never a repeat. */
function nextMemberId_(book) {
  const used = {};
  book.members.forEach(function (m) { if (m.memberId) used[m.memberId] = true; });
  const row = String(book.lastRow).padStart(3, "0");   // the new row is lastRow + 1, so the old sheet's "row - 1" is lastRow
  for (let i = 0; i < 50; i++) {
    const id = "CSS" + row + (1000 + Math.floor(Math.random() * 9000));
    if (!used[id]) return id;
  }
  return "CSS" + row + String(Date.now()).slice(-5);
}

// ---- Exec: confirm the payment ----------------------------------------------------------

/** Marks one member paid, emails them their pass, and logs who confirmed it. Any exec (checked by the caller). */
function markMemberPaid_(session, memberId) {
  const id = String(memberId || "").trim().toUpperCase();
  if (!id) throw new ApiError_("BAD_REQUEST", "Which member?");

  const result = withIntakeLock_(function () {
    const book = openMemberSheet_();
    const member = book.members.filter(function (m) { return m.memberId === id; })[0];
    if (!member) throw new ApiError_("NOT_FOUND", "No member with that ID.");
    if (member.paid) return { already: true, member: member };
    setMemberCells_(book, member, { paid: MEMBER_PAID_STATUS });
    member.paid = true; member.status = MEMBER_PAID_STATUS;
    return { member: member };
  });
  if (result.already) return { ok: true, already: true, member: result.member };

  const member = result.member;
  const emailed = !!member.email && sendMemberWelcomeEmail_(member);
  if (emailed) { member.cardSent = true; withIntakeLock_(function () {
    const book = openMemberSheet_();   // read again: the row may have moved while the email was going out
    const fresh = book.members.filter(function (x) { return x.memberId === member.memberId; })[0];
    if (fresh) setMemberCells_(book, fresh, { mailStatus: "Sent" });
  }); }

  log_(session.name, "member.paid", member.memberId, { name: member.name, method: member.payment.method, emailed: emailed ? 1 : 0 });
  return { ok: true, marked: true, emailed: emailed, member: member };
}

function sendMemberWelcomeEmail_(member) {
  const to = String(member.email).toLowerCase();
  if (!canSendMail_(to)) return false;
  try {
    const t = mailText_("memberWelcome", { name: member.name, year: MEMBERSHIP_YEAR });
    sendStyled_(to, t.subject, emailShell_({
      preheader: "Your CSS membership is confirmed", title: t.title, subtitle: t.subtitle,
      body: t.intro + t.closing,
      button: { label: "Open my member pass", url: memberPassLink_(member) },
      footerNote: "Save the pass to your phone's home screen: it works offline at the door."
    }), "Your CSS membership is confirmed. Your member pass: " + memberPassLink_(member));
    return true;
  } catch (e) {
    console.error("Member welcome email failed: " + e.message); rememberError_("email", e);
    return false;
  }
}

// ---- Exec: who is waiting on a payment --------------------------------------------------

const PENDING_PAGE_DEFAULT = 20;

/** Sign-ups waiting on a payment (online sign-ups and unpaid "Add member"), newest first, a page at a time. */
function listPendingMembers_(offset, limit) {
  let all = loadMembers_();
  if (all.length && all[0].row === undefined) { forgetMembers_(); all = loadMembers_(); }   // a copy cached before this feature existed has no row numbers
  const waiting = all.filter(function (m) { return m.memberId && !m.paid && /^awaiting/i.test(m.status || ""); })
    .sort(function (a, b) { return b.row - a.row; });   // new rows go at the bottom of the sheet, so a higher row is newer
  const from = Math.max(0, parseInt(offset, 10) || 0);
  const size = Math.min(100, Math.max(1, parseInt(limit, 10) || PENDING_PAGE_DEFAULT));
  return { ok: true, members: waiting.slice(from, from + size), total: waiting.length, hasMore: from + size < waiting.length };
}

// ---- Exec: resend the pass, edit a member -----------------------------------------------

/** Emails a paid member their pass link again (lost email, new phone). Any exec (checked by the caller). */
function resendMemberPass_(session, memberId) {
  const member = findMemberById_(loadMembers_(), memberId);
  if (!member) throw new ApiError_("NOT_FOUND", "No member with that ID.");
  if (!member.email) throw new ApiError_("BAD_REQUEST", "This member has no email address on file.");
  if (!sendMemberWelcomeEmail_(member)) throw new ApiError_("EMAIL_FAILED", "Email failed to send. Check email allowance.");
  log_(session.name, "member.resendPass", member.memberId, { name: member.name, email: member.email });
  return { ok: true, emailed: true };
}

/**
 * Exec edits a member's name, email, UCID and paid status. Any exec (checked by the caller). The Paid Status cell is only
 * touched when paid actually changes (so "Awaiting Cash" isn't overwritten by an edit of the email). Flipping to paid emails the pass.
 */
function updateMember_(session, input) {
  input = input || {};
  const id = String(input.memberId || "").trim().toUpperCase();
  if (!id) throw new ApiError_("BAD_REQUEST", "Which member?");
  const name = memberText_(input.name, 80);
  const email = String(input.email || "").trim().toLowerCase();
  const ucid = String(input.ucid || "").replace(/\s+/g, "");
  if (name.length < 2) throw new ApiError_("BAD_REQUEST", "Please enter the member's name.");
  if (email && (email.length > 120 || !/^[a-z0-9][a-z0-9._%+'-]*@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email))) throw new ApiError_("BAD_REQUEST", "That email doesn't look right.");
  if (ucid && !/^\d{8}$/.test(ucid)) throw new ApiError_("BAD_REQUEST", "The UCID is the 8-digit student number on the UCard.");
  const paid = !!input.paid;

  const result = withIntakeLock_(function () {
    const book = openMemberSheet_();   // fresh read: the row number must be current
    const member = book.members.filter(function (m) { return m.memberId === id; })[0];
    if (!member) throw new ApiError_("NOT_FOUND", "No member with that ID.");
    const clash = book.members.filter(function (m) {
      return m.memberId !== id && ((ucid && String(m.ucid).replace(/\D/g, "") === ucid) || (email && String(m.email).toLowerCase() === email));
    })[0];
    if (clash) throw new ApiError_("DUPLICATE", "Another member (" + clash.name + ", " + clash.memberId + ") already has that UCID or email.");

    const changes = { name: name, email: email, ucid: ucid };
    const flippedToPaid = paid && !member.paid;
    if (paid !== member.paid) changes.paid = paid ? MEMBER_PAID_STATUS : "UNPAID";
    setMemberCells_(book, member, changes);
    member.name = name; member.email = email; member.ucid = ucid;
    if (paid !== member.paid) { member.paid = paid; member.status = changes.paid; }
    return { member: member, flippedToPaid: flippedToPaid };
  });

  const member = result.member;
  let emailed = false;
  if (result.flippedToPaid && member.email) {
    emailed = sendMemberWelcomeEmail_(member);
    if (emailed) {
      member.cardSent = true;
      withIntakeLock_(function () {
        const book = openMemberSheet_();   // read again: the row may have moved while the email went out
        const fresh = book.members.filter(function (x) { return x.memberId === member.memberId; })[0];
        if (fresh) setMemberCells_(book, fresh, { mailStatus: "Sent" });
      });
    }
  }
  forgetMembers_();
  log_(session.name, "member.update", member.memberId, { name: name, paid: paid, emailed: emailed ? 1 : 0 });
  return { ok: true, member: member, emailed: emailed };
}
