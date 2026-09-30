/**
 * CSS Platform API — emails.
 *
 * Sent from the CSS Gmail account. A regular Gmail account can send about 100
 * emails a day from Apps Script, so every send first checks what's left and
 * skips (returns false) instead of failing the whole request.
 */

const MAIL_FROM_NAME = "Chinese Students' Society (UCalgary)";

/** Addresses at example.com/.org/.net are for testing: never actually emailed. */
function isTestAddress_(email) {
  return /@example\.(com|org|net)$/i.test(String(email || ""));
}

function canSendMail_(to) {
  if (isTestAddress_(to)) return false;
  try { return MailApp.getRemainingDailyQuota() > 0; } catch (e) { return false; }
}

/** To the payer, right after registering: what to send, where, and the payment code. */
function sendRegistrationEmail_(event, order, tickets) {
  if (!canSendMail_(order.payerEmail)) return false;
  const config = getConfig_();
  const isFree = order.status === "paid";
  const rows = tickets.map(function (t) {
    return "<tr><td style=\"padding:4px 12px 4px 0\">" + esc_(t.name) + "</td><td style=\"padding:4px 12px 4px 0\">" +
      esc_(t.ticketType) + "</td><td style=\"padding:4px 0\" align=\"right\">" + moneyText_(t.price) + "</td></tr>";
  }).join("");

  const body = isFree
    ? "<p>You're registered for <b>" + esc_(event.name) + "</b>. It's free, so there's nothing to pay.</p>"
    : "<p>Thanks for registering for <b>" + esc_(event.name) + "</b>!</p>" +
      "<p style=\"font-size:16px\"><b>To confirm your spot, send an Interac e-transfer:</b></p>" +
      "<table style=\"font-size:16px;border-collapse:collapse\">" +
      "<tr><td style=\"padding:4px 16px 4px 0;color:#666\">Amount</td><td><b>" + moneyText_(order.total) + "</b> (exactly)</td></tr>" +
      "<tr><td style=\"padding:4px 16px 4px 0;color:#666\">Send to</td><td><b>" + esc_(config.etransferEmail) + "</b></td></tr>" +
      "<tr><td style=\"padding:4px 16px 4px 0;color:#666\">Message</td><td><b style=\"font-size:20px;letter-spacing:1px\">" + esc_(order.code) + "</b></td></tr>" +
      "</table>" +
      "<p style=\"color:#666\">If your bank doesn't allow a message, that's OK, we'll match it by name.<br>" +
      "Your spot is confirmed once payment is received. Each person then gets their own ticket by email.</p>";

  const html =
    "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#1c1917\">" +
    "<p style=\"color:#b91c1c;font-weight:bold;margin:0 0 12px\">Chinese Students' Society · University of Calgary</p>" +
    body +
    "<p style=\"margin-top:20px\"><b>Tickets in this registration</b></p><table style=\"border-collapse:collapse\">" + rows + "</table>" +
    "<p style=\"margin-top:20px\"><b>When:</b> " + esc_(eventWhenText_(event)) + "<br><b>Where:</b> " + esc_(event.location || "TBA") + "</p>" +
    "<p style=\"color:#666;font-size:13px;margin-top:24px\">Questions? Just reply to this email.</p></div>";

  try {
    MailApp.sendEmail({
      to: order.payerEmail,
      subject: (isFree ? "You're registered: " : "Registration received: ") + event.name + (isFree ? "" : " (" + order.code + ")"),
      htmlBody: html,
      name: MAIL_FROM_NAME,
      replyTo: config.etransferEmail
    });
    return true;
  } catch (e) {
    console.error("Registration email failed: " + e.message);
    return false;
  }
}

/** To each person once their order is paid: their own ticket with a QR code and a link to the ticket page. */
function sendTicketEmail_(event, ticket) {
  if (!canSendMail_(ticket.email)) return false;
  const link = ticketLink_(ticket);
  const qr = "https://quickchart.io/qr?size=320&margin=2&text=" + encodeURIComponent(link);
  const html =
    "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#1c1917\">" +
    "<p style=\"color:#b91c1c;font-weight:bold;margin:0 0 12px\">Chinese Students' Society · University of Calgary</p>" +
    "<h2 style=\"margin:0 0 4px\">You're in! 🎉</h2>" +
    "<p style=\"margin:0 0 16px\">Here's your ticket for <b>" + esc_(event.name) + "</b>.</p>" +
    "<div style=\"border:2px solid #b91c1c;border-radius:14px;padding:18px;text-align:center\">" +
    "<img src=\"" + qr + "\" width=\"240\" height=\"240\" alt=\"Your ticket QR code\" style=\"display:block;margin:0 auto 10px\">" +
    "<div style=\"font-size:20px;font-weight:bold\">" + esc_(ticket.name) + "</div>" +
    "<div style=\"color:#666\">" + esc_(ticket.ticketType) + " · " + esc_(ticket.id) + "</div></div>" +
    "<p style=\"margin:18px 0\"><b>When:</b> " + esc_(eventWhenText_(event)) + "<br><b>Where:</b> " + esc_(event.location || "TBA") + "</p>" +
    "<p><a href=\"" + esc_(link) + "\" style=\"background:#b91c1c;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block\">Open my ticket</a></p>" +
    "<p style=\"color:#666;font-size:14px\">Show the QR code at the door. A screenshot works too. This ticket is just for you; each friend gets their own.</p>" +
    "<p style=\"color:#666;font-size:13px;margin-top:24px\">Questions? Just reply to this email.</p></div>";
  try {
    MailApp.sendEmail({
      to: ticket.email,
      subject: "Your ticket: " + event.name,
      htmlBody: html,
      name: MAIL_FROM_NAME,
      replyTo: getConfig_().etransferEmail
    });
    return true;
  } catch (e) {
    console.error("Ticket email failed for " + ticket.id + ": " + e.message);
    return false;
  }
}

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
