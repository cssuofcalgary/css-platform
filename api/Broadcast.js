/**
 * CSS Platform API — email everyone registered for an event.
 *
 * An exec writes a subject and a message (venue change, reminder, thank-you) and picks who gets it:
 * everyone with a ticket, only people who have paid, or only people who haven't paid yet.
 * Each person gets their own copy in the same look as every other email. The message can use
 * {name} {event} {when} {where}. A dry run counts the people and shows the email first.
 * One address gets one email even if it holds several tickets. Test addresses (@example.com) are skipped.
 */

const BROADCAST_AUDIENCES = { all: ["paid", "awaiting"], paid: ["paid"], awaiting: ["awaiting"] };
const BROADCAST_QUOTA_SPARE = 10;   // keep some of today's emails for tickets and find-my-tickets

function emailAttendees_(session, eventId, audience, subject, message, dryRun) {
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  const statuses = BROADCAST_AUDIENCES[audience];
  if (!statuses) throw new ApiError_("BAD_REQUEST", "Pick who should get it.");
  const title = String(subject || "").replace(/\r|\n/g, " ").trim().slice(0, 150);
  const text = String(message || "").replace(/\r/g, "").trim().slice(0, 3000);
  if (!title) throw new ApiError_("BAD_REQUEST", "Type a subject.");
  if (!text) throw new ApiError_("BAD_REQUEST", "Type a message.");

  // One entry per address
  const seen = {};
  const people = [];
  readRows_("Tickets").forEach(function (t) {
    const email = String(t.email || "").trim().toLowerCase();
    if (t.eventId !== eventId || statuses.indexOf(t.status) === -1 || !email || seen[email]) return;
    seen[email] = true;
    people.push({ email: email, name: t.name });
  });
  const real = people.filter(function (p) { return !isTestAddress_(p.email); });

  let quota = 0;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { /* unknown */ }

  if (dryRun) {
    const sample = broadcastEmail_(event, title, text, (real[0] || people[0] || { name: "Alex" }).name);
    return { ok: true, people: people.length, toEmail: real.length, testAddresses: people.length - real.length, emailsLeftToday: quota, previewSubject: sample.subject, previewHtml: sample.html };
  }
  if (!real.length) throw new ApiError_("BAD_REQUEST", "Nobody to email with that choice.");
  if (real.length > quota - BROADCAST_QUOTA_SPARE) {
    throw new ApiError_("BAD_REQUEST", "That's " + real.length + " emails but only " + quota + " are left today (some are kept back for tickets). Try tomorrow, or pick fewer people.");
  }

  // The same message to the same group can't go out twice within 10 minutes (double taps)
  const fingerprint = [eventId, audience, title, text].join("|");
  withLock_(function () {
    const props = PropertiesService.getScriptProperties();
    let last = null;
    try { last = JSON.parse(props.getProperty("BROADCAST_LAST") || "null"); } catch (e) { /* none */ }
    if (last && last.fingerprint === fingerprint && Date.now() - last.time < 600000) {
      throw new ApiError_("BAD_REQUEST", "That exact email was just sent. Wait a few minutes if you really want to send it again.");
    }
    props.setProperty("BROADCAST_LAST", JSON.stringify({ fingerprint: fingerprint, time: Date.now() }));
  });

  let sent = 0, failed = 0;
  real.forEach(function (p) {
    const mail = broadcastEmail_(event, title, text, p.name);
    try {
      sendStyled_(p.email, mail.subject, mail.html, mail.plain);
      sent++;
    } catch (e) {
      failed++;
      console.error("Broadcast email failed: " + e.message);
    }
  });
  log_(session.name, "event.email", eventId, { audience: audience, sent: sent, failed: failed, subject: title });
  return { ok: true, sent: sent, failed: failed, testAddresses: people.length - real.length };
}

function broadcastEmail_(event, subject, message, name) {
  const vars = { name: name || "there", event: event.name, when: eventWhenText_(event), where: event.location || "TBA" };
  const plain = fillText_(message, vars);
  return {
    subject: fillText_(subject, vars).replace(/\*\*/g, ""),
    html: emailShell_({
      preheader: plain.slice(0, 90).replace(/\s+/g, " "),
      title: mailInline_(fillText_(subject, vars)),
      subtitle: mailInline_(event.name),
      body: mailParas_(plain, "")
    }),
    plain: plain
  };
}
