/**
 * CSS Platform API — emails.
 *
 * Sent from the CSS Gmail account. A regular Gmail account can send about 100
 * emails a day from Apps Script, so every send first checks what's left and
 * skips (returns false) instead of failing the whole request.
 *
 * Every email uses the same paper-ticket look as the member pass email: sage header with the
 * CSS banner, cream card, dashed dividers, pandas, and a signature. Change the look in
 * emailShell_() below and all emails follow. The words, signature and button colour are
 * editable from the Exec Portal (see EmailTemplates.js).
 */

const MAIL_FROM_NAME = "Chinese Students' Society (UCalgary)";

// Pictures: the member portal's own files (Vercel), plus the mountain background from Drive
const MAIL_IMG = {
  background: "https://lh3.googleusercontent.com/d/1rKDJhFtVh7aHRrP870GzjXzeZ1X9s6pu",
  banner: "https://member.ucalgarycss.ca/assets/banner_transparent.png",
  topPanda: "https://member.ucalgarycss.ca/assets/top_panda.png",
  bottomPanda: "https://member.ucalgarycss.ca/assets/bottom_panda.png"
};
const MAIL_SERIF = "Georgia,'Times New Roman',serif";
const MAIL_MONO = "monospace,'Courier New',Courier";

/** Addresses at example.com/.org/.net are for testing: never actually emailed. */
function isTestAddress_(email) {
  return /@example\.(com|org|net)$/i.test(String(email || ""));
}

function canSendMail_(to) {
  if (isTestAddress_(to)) return false;
  try { return MailApp.getRemainingDailyQuota() > 0; } catch (e) { return false; }
}

/**
 * Which emails an event sends (set in the event editor, "Emails"). A never-chosen setting uses the defaults:
 *   registration = a "we got your registration" email after signing up (off),
 *   tickets      = the ticket email once payment is confirmed, or straight away for a free event (on),
 *   reminders    = the Payments tab's "Send reminders" button works for this event (off).
 * Turning one off is a choice, not a failure: nothing is queued for later.
 */
function eventMails_(event) {
  return {
    registration: !!(event && event.mailRegistration),
    tickets: !event || event.mailTickets !== false,
    reminders: !!(event && event.mailReminders)
  };
}

/** What a ticket's emailedAt says when its event doesn't email tickets. Not "waiting": nothing will be sent later. */
const TICKET_EMAIL_OFF_NOTE = "not emailed (turned off for this event)";

// ---- The shared look ------------------------------------------------------------------

/**
 * Wraps content in the CSS email look.
 * o = { preheader, title, subtitle, body (HTML), button: {label, url} (optional), footerNote (optional) }
 */
function emailShell_(o) {
  const brand = emailBrand_();
  const contact = getConfig_();
  const links = [["Website", "https://ucalgarycss.ca/"], ["Instagram", contact.instagramUrl], ["Events", "https://events.ucalgarycss.ca/"]];
  const linkHtml = links.map(function (l) {
    return "<a href=\"" + esc_(l[1]) + "\" style=\"font-family:" + MAIL_MONO + ";font-size:11px;font-weight:700;letter-spacing:0.5px;color:#4c6b47;text-decoration:none;margin-right:16px;text-transform:uppercase;\">" + l[0] + "</a>";
  }).join("");

  return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" +
    "<meta name=\"color-scheme\" content=\"light only\"><meta name=\"supported-color-schemes\" content=\"light only\">" +
    "<style>@media only screen and (max-width:600px){.outer{padding:18px 10px 28px !important}.pad{padding-left:20px !important;padding-right:20px !important}}" +
    "[data-ogsc] body,[data-ogsc] .bg{background-color:#ded6c0 !important}[data-ogsc] .card{background-color:#f3ecda !important}</style></head>" +
    "<body style=\"margin:0;padding:0;background-color:#ded6c0;font-family:" + MAIL_SERIF + ";\" bgcolor=\"#ded6c0\">" +
    "<div style=\"display:none;font-size:1px;color:#ded6c0;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;\">" + esc_(o.preheader || "") + "</div>" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" bgcolor=\"#ded6c0\" class=\"bg\" background=\"" + MAIL_IMG.background + "\" " +
    "style=\"background-color:#ded6c0;background-image:url('" + MAIL_IMG.background + "');background-size:cover;background-position:center;width:100%;\"><tr>" +
    "<td align=\"center\" class=\"outer\" style=\"padding:36px 16px 48px;\">" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" align=\"center\" style=\"max-width:560px;width:100%;border-collapse:collapse;\">" +

    // green top edge + header with the banner
    "<tr><td bgcolor=\"#4c6b47\" style=\"height:6px;background-color:#4c6b47;font-size:0;line-height:0;border-radius:6px 6px 0 0;\">&nbsp;</td></tr>" +
    "<tr><td bgcolor=\"#4c6b47\" style=\"background-color:#4c6b47;padding:18px 24px;\" align=\"center\">" +
    "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" align=\"center\"><tr>" +
    "<td bgcolor=\"#f3ecda\" style=\"background-color:#f3ecda;padding:10px 24px;border-radius:100px;border:1px solid #c9b57e;\">" +
    "<img src=\"" + MAIL_IMG.banner + "\" width=\"210\" alt=\"Chinese Students' Society\" style=\"display:block;border:0;height:auto;max-width:100%;\"></td></tr></table></td></tr>" +

    // card body
    "<tr><td bgcolor=\"#f3ecda\" class=\"card pad\" style=\"background-color:#f3ecda;padding:28px 32px 22px;border-left:1px solid #e7ddc0;border-right:1px solid #e7ddc0;\" align=\"center\">" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td align=\"right\" style=\"padding-bottom:4px;line-height:0;font-size:0;\">" +
    "<img src=\"" + MAIL_IMG.topPanda + "\" width=\"70\" alt=\"\" style=\"display:inline-block;border:0;height:auto;\"></td></tr></table>" +
    "<p style=\"margin:0 0 6px;font-family:" + MAIL_MONO + ";font-size:11px;font-weight:700;letter-spacing:2px;color:#a8822e;text-transform:uppercase;text-align:center;\">Chinese Students' Society &middot; University of Calgary</p>" +
    "<h1 style=\"margin:0 0 8px;font-family:" + MAIL_SERIF + ";font-size:25px;font-weight:700;color:#2a2520;line-height:1.25;text-align:center;\">" + o.title + "</h1>" +
    (o.subtitle ? "<p style=\"margin:0 0 20px;font-family:" + MAIL_SERIF + ";font-style:italic;font-size:16px;color:#6b6153;line-height:1.55;text-align:center;\">" + o.subtitle + "</p>" : "<p style=\"margin:0 0 12px;\">&nbsp;</p>") +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin-bottom:20px;\"><tr><td style=\"border-top:2px dashed #cdb877;font-size:0;line-height:0;\">&nbsp;</td></tr></table>" +
    "<div style=\"text-align:left;font-family:" + MAIL_SERIF + ";font-size:15px;color:#2a2520;line-height:1.65;\">" + o.body + "</div>" +
    (o.button ? "<div style=\"margin-top:22px;text-align:center;\">" + mailButton_(o.button.label, o.button.url) + "</div>" : "") +
    "</td></tr>" +

    // tear line + signature
    "<tr><td bgcolor=\"#f3ecda\" class=\"pad\" style=\"background-color:#f3ecda;padding:0 32px;border-left:1px solid #e7ddc0;border-right:1px solid #e7ddc0;\">" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td style=\"border-top:2px dashed #cdb877;font-size:0;line-height:0;\">&nbsp;</td></tr></table></td></tr>" +
    "<tr><td bgcolor=\"#f3ecda\" class=\"pad\" style=\"background-color:#f3ecda;padding:22px 32px 30px;border-left:1px solid #e7ddc0;border-right:1px solid #e7ddc0;\">" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td style=\"vertical-align:bottom;\">" +
    "<p style=\"margin:0;font-family:" + MAIL_SERIF + ";font-size:14px;color:#6b6153;line-height:1.65;\"><strong style=\"color:#2a2520;font-family:" + MAIL_MONO + ";font-size:13px;\">" + mailEdit_("signer", esc_(brand.signerName)) + "</strong><br>" + mailEdit_("role", esc_(brand.signerRole)) + "<br>University of Calgary</p>" +
    "<p style=\"margin:12px 0 0;\">" + linkHtml + "</p></td>" +
    "<td align=\"right\" style=\"vertical-align:bottom;width:85px;padding-left:16px;\"><img src=\"" + MAIL_IMG.bottomPanda + "\" width=\"80\" alt=\"\" style=\"display:block;border:0;height:auto;\"></td></tr></table></td></tr>" +
    "<tr><td bgcolor=\"#f3ecda\" style=\"height:6px;background-color:#f3ecda;border-bottom:3px solid #a8822e;border-left:1px solid #e7ddc0;border-right:1px solid #e7ddc0;border-radius:0 0 6px 6px;font-size:0;line-height:0;\">&nbsp;</td></tr>" +
    "</table>" +
    "<p style=\"margin:18px 0 0;font-family:" + MAIL_MONO + ";font-size:10px;color:#4a4236;text-align:center;letter-spacing:1px;text-transform:uppercase;\">Questions? Just reply to this email.</p>" +
    (o.footerNote ? "<p style=\"margin:8px 0 0;font-family:" + MAIL_SERIF + ";font-size:12px;color:#4a4236;text-align:center;\">" + o.footerNote + "</p>" : "") +
    "</td></tr></table></body></html>";
}

/** The chestnut call-to-action button. */
function mailButton_(label, url) {
  const c = emailBrand_().buttonColor;
  return "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" align=\"center\"><tr>" +
    "<td align=\"center\" bgcolor=\"" + c + "\" style=\"border-radius:4px;background-color:" + c + ";\">" +
    "<a href=\"" + esc_(url) + "\" style=\"display:inline-block;padding:14px 30px;font-family:" + MAIL_MONO + ";font-size:13px;font-weight:700;letter-spacing:1.5px;color:#f3ecda;text-decoration:none;text-transform:uppercase;border-radius:4px;background-color:" + c + ";border:1px solid " + c + ";\">" +
    label + " &rarr;</a></td></tr></table>";
}

/** A dashed cream box for details (payment info, a ticket…). */
function mailBox_(inner) {
  return "<div style=\"background:#fbf7ea;border:2px dashed #a8822e;border-radius:8px;padding:12px 16px;margin:12px 0;\">" + inner + "</div>";
}

/** Label / value lines inside a box. rows = [[label, valueHtml], …] */
function mailRows_(rows) {
  return "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"font-size:15px;\">" + rows.map(function (r) {
    return "<tr><td style=\"padding:4px 16px 4px 0;font-family:" + MAIL_MONO + ";font-size:11px;letter-spacing:0.5px;color:#6b6153;text-transform:uppercase;vertical-align:top;\">" + r[0] +
      "</td><td style=\"padding:4px 0;font-weight:700;color:#2a2520;\">" + r[1] + "</td></tr>";
  }).join("") + "</table>";
}

function mailPara_(html) {
  return "<p style=\"margin:0 0 14px;\">" + html + "</p>";
}

function whenWhereRows_(event) {
  return [[emailLabel_("when"), esc_(eventWhenText_(event))], [emailLabel_("where"), esc_(event.location || "TBA")]];
}

function sendStyled_(to, subject, html, plain) {
  MailApp.sendEmail({ to: to, subject: subject, body: plain, htmlBody: html, name: MAIL_FROM_NAME, replyTo: getConfig_().etransferEmail });
}

// ---- The emails --------------------------------------------------------------------
// Each email has a build function (returns { subject, html, plain }) and a send function.
// The words (subject, title, subtitle, intro, closing) come from EmailTemplates.js, so the admin
// can change them in the portal; the layout and the detail boxes stay here.

function paymentBox_(order, config) {
  return mailBox_(mailRows_([
    [emailLabel_("amount"), "<span style=\"font-size:18px;\">" + moneyText_(order.total) + "</span> " + emailLabel_("exactly")],
    [emailLabel_("sendTo"), esc_(config.etransferEmail)],
    [emailLabel_("message"), "<span style=\"font-size:22px;letter-spacing:2px;\">" + esc_(order.code) + "</span>"]
  ]));
}

/** Fill-ins shared by the order emails. */
function orderVars_(event, order, tickets) {
  return {
    name: String(order.payerName || (tickets[0] && tickets[0].name) || ""),
    event: event.name, code: order.code, amount: moneyText_(order.total),
    when: eventWhenText_(event), where: event.location || "TBA"
  };
}

function buildRegistrationEmail_(event, order, tickets) {
  const config = getConfig_();
  const isFree = order.status === "paid";
  const t = mailText_(isFree ? "registrationFree" : "registration", orderVars_(event, order, tickets));
  const people = tickets.map(function (x) {
    return "<tr><td style=\"padding:3px 14px 3px 0;\">" + esc_(x.name) + "</td><td style=\"padding:3px 14px 3px 0;color:#6b6153;\">" + esc_(x.ticketType) +
      "</td><td style=\"padding:3px 0;\" align=\"right\">" + moneyText_(x.price) + "</td></tr>";
  }).join("");
  const body = t.intro + (isFree ? "" : paymentBox_(order, config) + t.closing) +
    mailBox_("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"font-size:15px;\">" + people + "</table>") +
    mailBox_(mailRows_(whenWhereRows_(event))) + (isFree ? t.closing : "");
  return {
    subject: t.subject,
    html: emailShell_({ preheader: isFree ? "You're registered for " + event.name : "Send your e-transfer to confirm your spot for " + event.name, title: t.title, subtitle: t.subtitle, body: body }),
    plain: isFree ? "You're registered for " + event.name + "." : "Send " + moneyText_(order.total) + " by Interac e-transfer to " + config.etransferEmail + " with the message " + order.code + "."
  };
}

/** To the payer, right after registering: what to send, where, and the payment code. */
function sendRegistrationEmail_(event, order, tickets) {
  if (!canSendMail_(order.payerEmail)) return false;
  try {
    const mail = buildRegistrationEmail_(event, order, tickets);
    sendStyled_(order.payerEmail, mail.subject, mail.html, mail.plain);
    return true;
  } catch (e) {
    console.error("Registration email failed: " + e.message); rememberError_("email", e);
    return false;
  }
}

function buildReminderEmail_(event, order, tickets) {
  const config = getConfig_();
  const t = mailText_("reminder", orderVars_(event, order, tickets));
  const people = tickets.map(function (x) { return esc_(x.name) + " (" + esc_(x.ticketType) + ")"; }).join(", ");
  const body = t.intro + paymentBox_(order, config) + mailBox_(mailRows_([["For", people]].concat(whenWhereRows_(event)))) + t.closing;
  return {
    subject: t.subject,
    html: emailShell_({ preheader: "Your spot for " + event.name + " isn't confirmed yet", title: t.title, subtitle: t.subtitle, body: body }),
    plain: "Your spot for " + event.name + " isn't confirmed yet. Send " + moneyText_(order.total) + " to " + config.etransferEmail + " with the message " + order.code + "."
  };
}

/** To the payer of an order that hasn't been paid yet: a gentle nudge with the payment details again. */
function sendReminderEmail_(event, order, tickets) {
  if (!canSendMail_(order.payerEmail)) return false;
  try {
    const mail = buildReminderEmail_(event, order, tickets);
    sendStyled_(order.payerEmail, mail.subject, mail.html, mail.plain);
    return true;
  } catch (e) {
    console.error("Reminder email failed for " + order.code + ": " + e.message); rememberError_("email", e);
    return false;
  }
}

function buildTicketEmail_(event, ticket) {
  const link = ticketLink_(ticket);
  const qr = "https://quickchart.io/qr?size=320&margin=2&text=" + encodeURIComponent(link);
  const t = mailText_("ticket", { name: ticket.name, event: event.name, when: eventWhenText_(event), where: event.location || "TBA" });
  const body = t.intro +
    "<div style=\"background:#ffffff;border:2px dashed #a8822e;border-radius:8px;padding:16px;text-align:center;margin:0 0 14px;\">" +
    "<img src=\"" + qr + "\" width=\"220\" height=\"220\" alt=\"Your ticket QR code\" style=\"display:block;margin:0 auto 10px;\">" +
    "<div style=\"font-size:20px;font-weight:700;color:#2a2520;\">" + esc_(ticket.name) + "</div>" +
    "<div style=\"font-family:" + MAIL_MONO + ";font-size:11px;letter-spacing:0.5px;color:#6b6153;margin-top:4px;\">" + esc_(ticket.ticketType) + " &middot; " + esc_(ticket.id) + "</div></div>" +
    mailBox_(mailRows_(whenWhereRows_(event))) + t.closing;
  return {
    subject: t.subject,
    html: emailShell_({ preheader: "Your ticket for " + event.name + " is ready", title: t.title, subtitle: t.subtitle, body: body, button: { label: "Open my ticket", url: link } }),
    plain: "Your ticket for " + event.name + ": " + link
  };
}

/** To each person once their order is paid: their own ticket with a QR code and a link to the ticket page. */
function sendTicketEmail_(event, ticket) {
  if (!canSendMail_(ticket.email)) return false;
  try {
    const mail = buildTicketEmail_(event, ticket);
    sendStyled_(ticket.email, mail.subject, mail.html, mail.plain);
    return true;
  } catch (e) {
    console.error("Ticket email failed for " + ticket.id + ": " + e.message); rememberError_("email", e);
    return false;
  }
}

function buildMyTicketsEmail_(items, allLink) {
  const t = mailText_("findTickets", { event: items.length === 1 ? items[0].event.name : "your events" });
  const blocks = items.map(function (x) {
    return mailBox_(
      "<div style=\"font-size:17px;font-weight:700;color:#2a2520;\">" + esc_(x.event.name) + "</div>" +
      mailRows_(whenWhereRows_(x.event).concat([["Ticket", esc_(x.ticket.name) + " &middot; " + esc_(x.ticket.ticketType)]])) +
      "<div style=\"margin-top:10px;\">" + mailButton_("Open ticket", ticketLink_(x.ticket)) + "</div>");
  }).join("");
  const plain = "Your CSS tickets:\n" + items.map(function (x) { return x.event.name + ": " + ticketLink_(x.ticket); }).join("\n");
  return {
    subject: t.subject,
    html: emailShell_({
      preheader: "Your ticket link" + (items.length === 1 ? "" : "s"), title: t.title, subtitle: t.subtitle,
      body: t.intro + blocks + t.closing,
      button: allLink ? { label: "See all my tickets", url: allLink } : null,
      footerNote: "If that wasn't you, you can ignore this email."
    }),
    plain: plain + (allLink ? " All your tickets: " + allLink : "")
  };
}

/** To one address: a link to every upcoming ticket found for it (the "Find my tickets" page). */
function sendMyTicketsEmail_(to, items, allLink) {
  if (!canSendMail_(to)) return false;
  try {
    const mail = buildMyTicketsEmail_(items, allLink);
    sendStyled_(to, mail.subject, mail.html, mail.plain);
    return true;
  } catch (e) {
    console.error("Find-my-tickets email failed: " + e.message); rememberError_("email", e);
    return false;
  }
}

function buildMyPassEmail_(member, link) {
  const t = mailText_("findPass", { name: member.name });
  return {
    subject: t.subject,
    html: emailShell_({
      preheader: "Your CSS member pass link", title: t.title, subtitle: t.subtitle,
      body: t.intro + t.closing,
      button: { label: "Open my member pass", url: link },
      footerNote: "If that wasn't you, you can ignore this email."
    }),
    plain: "Your CSS member pass: " + link
  };
}

/** To a member: a link to their digital pass (the member portal), from the "Find my pass" page. */
function sendMyPassEmail_(to, member, link) {
  if (!canSendMail_(to)) return false;
  try {
    const mail = buildMyPassEmail_(member, link);
    sendStyled_(to, mail.subject, mail.html, mail.plain);
    return true;
  } catch (e) {
    console.error("Find-my-pass email failed: " + e.message); rememberError_("email", e);
    return false;
  }
}

// ---- Helpers ---------------------------------------------------------------------------

function eventWhenText_(event) {
  const date = Utilities.formatDate(new Date(event.date + "T12:00:00"), "America/Edmonton", "EEEE, MMMM d, yyyy");
  const times = [event.startTime, event.endTime].filter(Boolean).map(timeText_).join(" – ");
  return times ? date + ", " + times : date;
}

function timeText_(hhmm) {
  const parts = String(hhmm).split(":").map(Number);
  const h = parts[0], m = parts[1] || 0;
  return ((h % 12) || 12) + ":" + (m < 10 ? "0" : "") + m + (h < 12 ? " a.m." : " p.m.");
}

function moneyText_(amount) {
  const n = Number(amount) || 0;
  return n === 0 ? "Free" : "$" + (n % 1 ? n.toFixed(2) : String(n));
}

function esc_(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
