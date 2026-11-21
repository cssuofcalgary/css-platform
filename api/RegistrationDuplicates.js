/** Registration identity checks shared by public signup, Finance and the door. */

/**
 * An ID identifies one attendee. An email can be shared by friends or a family,
 * so email alone is not enough: their full names must also match.
 */
function sameRegistrationPerson_(a, b) {
  a = a || {}; b = b || {};
  const ucid = function (p) { return String(p.ucid || "").replace(/\D/g, ""); };
  const memberId = function (p) { return String(p.memberId || "").trim().toUpperCase(); };
  const email = function (p) { return String(p.email || "").trim().toLowerCase(); };
  const aUcid = ucid(a), bUcid = ucid(b);
  const aMemberId = memberId(a), bMemberId = memberId(b);
  if (aUcid && bUcid && aUcid === bUcid) return true;
  if (aMemberId && bMemberId && aMemberId === bMemberId) return true;
  const aEmail = email(a), bEmail = email(b);
  const aName = normalizeName_(a.name), bName = normalizeName_(b.name);
  return !!(aEmail && aEmail === bEmail && aName && aName === bName);
}

/** Call inside the intake lock, with freshly read tickets, before writing anything. */
function assertNoDuplicateRegistration_(people, eventId, tickets) {
  people.forEach(function (person, index) {
    if (people.slice(0, index).some(function (other) { return sameRegistrationPerson_(person, other); })) {
      throw new ApiError_("BAD_REQUEST", person.name + " is listed more than once. Add each person only once.");
    }
    const already = tickets.some(function (ticket) {
      return ticket.eventId === eventId && (ticket.status === "awaiting" || ticket.status === "paid") && sameRegistrationPerson_(person, ticket);
    });
    if (already) {
      throw new ApiError_("ALREADY_REGISTERED", person.name + " already has a registration for this event. Open My tickets or contact CSS before registering again.");
    }
  });
}
