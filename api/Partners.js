/**
 * CSS Platform API — partner deals (member perks).
 *
 * The list of partners and their offers lives in its own tab of the platform's data sheet ("Partners"), not in the
 * Membership sheet. Any exec can add, edit, switch on/off from the Exec Portal (Members tab → Partner deals); only the
 * admin can delete one. A member's pass page asks for the active list with its private pass link (memberId + key),
 * so the list is only shown to someone holding a real pass link.
 *
 * The first time the list is read, the starter list below (copied from the old Sponsors tab on Oct 1, 2026) is put in
 * once. After that the sheet is the truth: deleting every row does not bring the starter list back.
 */

const PARTNER_SEED = [
  { name: "甜韵集 Sweet Together", offer: "15% OFF", address: "328 Centre St S #138, Calgary, AB T2G 4X6" },
  { name: "Day Day Bistro", offer: "10% OFF", address: "6 Crowfoot Cir NW #101, Calgary, AB T3G 2T3" },
  { name: "YONNY 鱼你", offer: "10% OFF", address: "310 Centre St S, Calgary, AB T2G 5J8" },
  { name: "杨氏整复推拿按摩 Yang’s Chinese Wellness", offer: "10% OFF", address: "1318 Centre St N #101, Calgary, AB T2E 2R7" },
  { name: "桂林米粉 Li’s Bowl Guilin Rice Noodles", offer: "10% OFF", address: "303 Centre St S, Calgary, AB T2G 2B9" },
  { name: "云之南 South Silk Road Chinese Restaurant", offer: "Receive a complimentary serving of rose and brown sugar iced jelly or a can of soft drink.", address: "1130 10 Ave SW, Calgary, AB T2R 0B6" },
  { name: "Calan Beef Noodle", offer: "10% OFF", address: "2219 Centre St N, Calgary" }
];

function ensurePartnersSeeded_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("PARTNERS_SEEDED")) return;
  withLock_(function () {
    if (props.getProperty("PARTNERS_SEEDED")) return;
    if (!readRows_("Partners").length) {
      const now = new Date().toISOString();
      PARTNER_SEED.forEach(function (p, i) {
        insertRow_("Partners", { id: newId_("PA"), name: p.name, offer: p.offer, address: p.address, active: true, sort: i + 1, createdAt: now, createdBy: "starter list", updatedAt: now, updatedBy: "starter list" });
      });
    }
    props.setProperty("PARTNERS_SEEDED", new Date().toISOString());
  });
}

/** A yes/no cell: Sheets may hand back TRUE as a real true (read as "true") when a row was appended, so accept both spellings. */
function isOn_(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

function partnerView_(r) {
  return { id: r.id, name: r.name, offer: r.offer, address: r.address, active: isOn_(r.active), sort: Number(r.sort) || 0 };
}

function sortedPartners_() {
  return readRows_("Partners").map(partnerView_).sort(function (a, b) { return a.sort - b.sort || a.name.localeCompare(b.name); });
}

/** Exec: every partner, on or off. */
function listPartners_() {
  ensurePartnersSeeded_();
  return { ok: true, partners: sortedPartners_() };
}

/** Exec: add (no id) or change one. One line of text per field, nothing a spreadsheet could read as a formula. */
function savePartner_(session, input) {
  input = input || {};
  const name = memberText_(input.name, 120);
  const offer = memberText_(input.offer, 300);
  const address = memberText_(input.address, 200);
  if (!name) throw new ApiError_("BAD_REQUEST", "The partner needs a name.");
  if (!offer) throw new ApiError_("BAD_REQUEST", "Write the offer, for example 10% OFF.");
  const active = !!input.active;
  ensurePartnersSeeded_();
  return withLock_(function () {
    const now = new Date().toISOString();
    const rows = readRows_("Partners");
    if (input.id) {
      const row = rows.filter(function (r) { return r.id === input.id; })[0];
      if (!row) throw new ApiError_("NOT_FOUND", "That partner no longer exists.");
      updateRow_("Partners", row.id, { name: name, offer: offer, address: address, active: active, updatedAt: now, updatedBy: session.name }, row._row);
      log_(session.name, "partner.update", row.id, { name: name, active: active });
      return { ok: true, partner: partnerView_(Object.assign({}, row, { name: name, offer: offer, address: address, active: active ? "TRUE" : "FALSE" })) };
    }
    const sort = rows.reduce(function (m, r) { return Math.max(m, Number(r.sort) || 0); }, 0) + 1;
    const created = { id: newId_("PA"), name: name, offer: offer, address: address, active: active, sort: sort, createdAt: now, createdBy: session.name, updatedAt: now, updatedBy: session.name };
    insertRow_("Partners", created);
    log_(session.name, "partner.add", created.id, { name: name });
    return { ok: true, partner: partnerView_(Object.assign({}, created, { active: active ? "TRUE" : "FALSE" })) };
  });
}

/** Admin: remove a partner for good (switching it off is usually better). */
function deletePartner_(session, id) {
  return withLock_(function () {
    const row = readRows_("Partners").filter(function (r) { return r.id === id; })[0];
    if (!row) throw new ApiError_("NOT_FOUND", "That partner no longer exists.");
    deleteTabRows_({ sheet: table_("Partners"), header: headerFor_("Partners") }, { [String(row.id)]: true });
    delete DB_.rows["Partners"];
    bumpTableVersion_("Partners");
    log_(session.name, "partner.delete", row.id, { name: row.name });
    return { ok: true };
  });
}

/**
 * Public, for a member's pass page: the ACTIVE partners, but only with a valid pass link (memberId + key) of a paid member.
 * Opening the list is written to the Log (who looked), like the old "visits".
 */
function memberPartners_(req) {
  const memberId = String(req.memberId || "").trim().toUpperCase();
  if (!memberId || !linkKeyOk_("pass", memberId, req.k)) throw new ApiError_("NOT_FOUND", "Pass not found.");
  const member = findMemberById_(loadMembers_(), memberId);
  if (!member || !member.paid) throw new ApiError_("NOT_FOUND", "Pass not found.");
  ensurePartnersSeeded_();
  log_("Member: " + member.name, "partners.open", member.memberId, {});
  return {
    ok: true,
    partners: sortedPartners_().filter(function (p) { return p.active; })
      .map(function (p) { return { name: p.name, offer: p.offer, address: p.address }; })
  };
}
