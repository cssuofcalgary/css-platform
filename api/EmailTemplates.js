/**
 * CSS Platform API — editable email wording (admin only, from the Exec Portal → Settings → Emails).
 *
 * The LOOK of every email stays in Mail.js (emailShell_). What an admin can change here is the words:
 * for each email, its subject, title, subtitle, opening text and closing text, plus the signature
 * (name and role) and the button colour. Anything left blank uses the default below, so "reset" simply
 * means clearing a field.
 *
 * Text can use fill-ins like {name} {event} {code} {amount} {when} {where}; **double stars** make bold;
 * a blank line starts a new paragraph.
 */

const EMAIL_FIELDS = ["subject", "title", "subtitle", "intro", "closing"];

const EMAIL_KINDS = {
  registration: {
    label: "Registration received (payment needed)",
    when: "Sent to the person who registers for an event that costs money, with the e-transfer details.",
    placeholders: ["name", "event", "code", "amount", "when", "where"],
    defaults: {
      subject: "Registration received: {event} ({code})",
      title: "Thanks for registering!",
      subtitle: "{event}",
      intro: "To confirm your spot, send an **Interac e-transfer**:",
      closing: "If your bank doesn't allow a message, that's OK, we'll match it by name. Your spot is confirmed once payment is received, and each person then gets their own ticket by email."
    }
  },
  registrationFree: {
    label: "Registered (free event)",
    when: "Sent when someone registers for a free event, so there is nothing to pay.",
    placeholders: ["name", "event", "when", "where"],
    defaults: {
      subject: "You're registered: {event}",
      title: "You're registered!",
      subtitle: "{event}",
      intro: "You're registered for **{event}**. It's free, so there's nothing to pay.",
      closing: ""
    }
  },
  reminder: {
    label: "Payment reminder",
    when: "Sent by Finance's \"Send reminders\" to people who haven't paid after a couple of days.",
    placeholders: ["name", "event", "code", "amount", "when", "where"],
    defaults: {
      subject: "Reminder: payment needed for {event} ({code})",
      title: "Friendly reminder",
      subtitle: "{event}",
      intro: "Just a reminder: your spot for **{event}** isn't confirmed yet, because we haven't received your e-transfer.",
      closing: "Already sent it? Thank you! It can take us a day to match it, so no need to send it again. Can't make it anymore? Just reply and we'll free up your spot."
    }
  },
  ticket: {
    label: "Ticket (after payment)",
    when: "Sent to each person once their order is paid, with their QR code.",
    placeholders: ["name", "event", "when", "where"],
    defaults: {
      subject: "Your ticket: {event}",
      title: "You're in!",
      subtitle: "Here's your ticket for **{event}**.",
      intro: "",
      closing: "Show the QR code at the door. A screenshot works too. This ticket is just for you; each friend gets their own."
    }
  },
  findTickets: {
    label: "Find my tickets",
    when: "Sent when someone uses \"Find my tickets\" on the website.",
    placeholders: [],
    defaults: {
      subject: "Your CSS tickets",
      title: "Here are your tickets",
      subtitle: "You asked for these on our website.",
      intro: "Open a ticket to see its QR code for the door, or see them all in one place.",
      closing: ""
    }
  },
  findPass: {
    label: "Find my member pass",
    when: "Sent when a member asks for their pass link on the member portal.",
    placeholders: ["name"],
    defaults: {
      subject: "Your CSS member pass",
      title: "Your member pass",
      subtitle: "You asked for this on our website.",
      intro: "Hi {name}, here is the link to your CSS member pass. Save it to your home screen to use it at events and partner locations.",
      closing: ""
    }
  }
};

const EMAIL_SAMPLE = {
  name: "Alex Chen", event: "Mahjong Games Night", code: "MGN-4408", amount: "$16",
  when: "Wednesday, October 21, 2026, 6:00 p.m. – 9:00 p.m.", where: "MSC 1st Floor"
};

/** When set (a preview of unsaved edits), these override what is saved. */
let EMAIL_OVERRIDE_ = null;

function savedEmailFields_(key) {
  if (EMAIL_OVERRIDE_ && EMAIL_OVERRIDE_.key === key) return EMAIL_OVERRIDE_.fields;
  const row = readRows_("Emails").filter(function (r) { return r.id === key; })[0];
  return row || {};
}

/** The wording actually in use: saved text where there is any, the default where a field is blank. */
function emailFields_(key) {
  const kind = EMAIL_KINDS[key];
  const saved = savedEmailFields_(key);
  const out = {};
  EMAIL_FIELDS.forEach(function (f) {
    const v = String(saved[f] === undefined || saved[f] === null ? "" : saved[f]);
    out[f] = v.trim() === "-" ? "" : (v.trim() ? v : kind.defaults[f]);   // a lone "-" means "show nothing here"
  });
  return out;
}

/** {name} → value. Unknown fill-ins stay as typed, so a typo is visible in the preview. */
function fillText_(text, vars) {
  return String(text || "").replace(/\{(\w+)\}/g, function (all, k) {
    return vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : all;
  });
}

/** Filled-in wording for one email. Subject is plain text; the rest is HTML-safe (with **bold** and paragraphs). */
function mailText_(key, vars) {
  const f = emailFields_(key);
  return {
    subject: fillText_(f.subject, vars).replace(/\*\*/g, ""),
    title: mailInline_(fillText_(f.title, vars)),
    subtitle: mailInline_(fillText_(f.subtitle, vars)),
    intro: f.intro.trim() ? mailParas_(fillText_(f.intro, vars), "") : "",
    closing: f.closing.trim() ? mailParas_(fillText_(f.closing, vars), "color:#6b6153;") : ""
  };
}

function mailInline_(text) {
  return esc_(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/** Blank line = new paragraph, single line break = <br>. */
function mailParas_(text, style) {
  return String(text).split(/\n\s*\n/).map(function (p) {
    return "<p style=\"margin:0 0 14px;" + (style || "") + "\">" + mailInline_(p.trim()).replace(/\n/g, "<br>") + "</p>";
  }).join("");
}

// ---- Signature and colour ----------------------------------------------------------

const EMAIL_BRAND_DEFAULTS = { signerName: "Gordon Chen", signerRole: "President — Chinese Students' Society (CSS)", buttonColor: "#824a24" };

function emailBrand_() {
  const props = PropertiesService.getScriptProperties();
  const color = String(props.getProperty("EMAIL_BUTTON_COLOR") || "");
  return {
    signerName: String(props.getProperty("PRESIDENT_NAME") || EMAIL_BRAND_DEFAULTS.signerName),
    signerRole: String(props.getProperty("EMAIL_SIGNER_ROLE") || EMAIL_BRAND_DEFAULTS.signerRole),
    buttonColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : EMAIL_BRAND_DEFAULTS.buttonColor
  };
}

// ---- Admin actions -------------------------------------------------------------------

function getEmailTemplates_() {
  const kinds = Object.keys(EMAIL_KINDS).map(function (key) {
    const kind = EMAIL_KINDS[key];
    const saved = savedEmailFields_(key);
    const custom = {};
    EMAIL_FIELDS.forEach(function (f) { custom[f] = String(saved[f] || "").trim() ? String(saved[f]) : ""; });
    return { key: key, label: kind.label, when: kind.when, placeholders: kind.placeholders, defaults: kind.defaults, custom: custom };
  });
  return { ok: true, kinds: kinds, brand: emailBrand_(), brandDefaults: EMAIL_BRAND_DEFAULTS };
}

function cleanEmailFields_(fields) {
  const limits = { subject: 150, title: 100, subtitle: 200, intro: 1500, closing: 1500 };
  const out = {};
  EMAIL_FIELDS.forEach(function (f) {
    out[f] = String((fields || {})[f] === undefined || (fields || {})[f] === null ? "" : fields[f]).replace(/\r/g, "").trim().slice(0, limits[f]);
  });
  return out;
}

function saveEmailTemplate_(session, key, fields) {
  if (!EMAIL_KINDS[key]) throw new ApiError_("BAD_REQUEST", "Unknown email.");
  const clean = cleanEmailFields_(fields);
  withLock_(function () {
    const existing = readRows_("Emails").filter(function (r) { return r.id === key; })[0];
    const row = Object.assign({ id: key, updatedBy: session.name, updatedAt: new Date().toISOString() }, clean);
    if (existing) updateRow_("Emails", key, row, existing._row); else insertRow_("Emails", row);
    log_(session.name, "email.save", key, { customized: EMAIL_FIELDS.filter(function (f) { return clean[f]; }) });
  });
  return { ok: true };
}

function saveEmailBrand_(session, input) {
  input = input || {};
  const props = PropertiesService.getScriptProperties();
  const text = function (v, max) { return String(v === undefined || v === null ? "" : v).trim().slice(0, max); };
  const updates = {};
  if (input.signerName !== undefined) updates.PRESIDENT_NAME = text(input.signerName, 80);
  if (input.signerRole !== undefined) updates.EMAIL_SIGNER_ROLE = text(input.signerRole, 120);
  if (input.buttonColor !== undefined) {
    const c = text(input.buttonColor, 7);
    if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) throw new ApiError_("BAD_REQUEST", "The colour should look like #824a24.");
    updates.EMAIL_BUTTON_COLOR = c;
  }
  Object.keys(updates).forEach(function (k) { if (updates[k]) props.setProperty(k, updates[k]); else props.deleteProperty(k); });   // blank = back to default
  log_(session.name, "email.brand", "", { changed: Object.keys(updates).length });
  return { ok: true, brand: emailBrand_() };
}

/** Builds an email with sample data. `fields` (optional) previews edits that aren't saved yet. */
function buildEmailPreview_(key, fields) {
  if (!EMAIL_KINDS[key]) throw new ApiError_("BAD_REQUEST", "Unknown email.");
  EMAIL_OVERRIDE_ = fields ? { key: key, fields: cleanEmailFields_(fields) } : null;
  try {
    const event = { name: EMAIL_SAMPLE.event, date: "2026-10-21", startTime: "18:00", endTime: "21:00", location: EMAIL_SAMPLE.where };
    const ticket = { id: "TKT8K2M4Q7X", secret: "0123456789abcdef0123456789abcdef", name: EMAIL_SAMPLE.name, email: "alex@example.com", ticketType: "Member price", price: 4 };
    const order = { code: EMAIL_SAMPLE.code, total: 16, payerEmail: "alex@example.com", status: "awaiting" };
    switch (key) {
      case "registration": return buildRegistrationEmail_(event, order, [ticket, Object.assign({}, ticket, { name: "Sam Wong", ticketType: "Non-member", price: 9 })]);
      case "registrationFree": return buildRegistrationEmail_(event, Object.assign({}, order, { status: "paid", total: 0 }), [Object.assign({}, ticket, { price: 0 })]);
      case "reminder": return buildReminderEmail_(event, order, [ticket]);
      case "ticket": return buildTicketEmail_(event, ticket);
      case "findTickets": return buildMyTicketsEmail_([{ event: event, ticket: ticket }], "https://member.ucalgarycss.ca/");
      default: return buildMyPassEmail_({ name: EMAIL_SAMPLE.name }, "https://member.ucalgarycss.ca/");
    }
  } finally {
    EMAIL_OVERRIDE_ = null;
  }
}

function previewEmail_(key, fields) {
  const mail = buildEmailPreview_(key, fields);
  return { ok: true, subject: mail.subject, html: mail.html };
}

/** Sends the sample email to an address the admin types (a test). Never more than 5 a day. */
function sendTestEmail_(session, key, to, fields) {
  const address = String(to || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new ApiError_("BAD_REQUEST", "That email doesn't look right.");
  if (isTestAddress_(address)) throw new ApiError_("BAD_REQUEST", "Addresses ending in example.com are never emailed. Use a real one.");
  const props = PropertiesService.getScriptProperties();
  const dayKey = "EMAIL_TESTS_" + Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");
  const used = parseInt(props.getProperty(dayKey) || "0", 10);
  if (used >= 5) throw new ApiError_("TOO_MANY_TRIES", "That's 5 test emails today. Try again tomorrow, or use Preview.");
  if (!canSendMail_(address)) throw new ApiError_("SERVER_ERROR", "The daily email limit has been reached.");
  const mail = buildEmailPreview_(key, fields);
  sendStyled_(address, "[TEST] " + mail.subject, mail.html, mail.plain);
  props.setProperty(dayKey, String(used + 1));
  log_(session.name, "email.test", key, {});
  return { ok: true };
}
