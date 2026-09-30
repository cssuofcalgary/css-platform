// CSS "Find my tickets": tickets.html. Never shows tickets; the server emails the links.

const $ = (id) => document.getElementById(id);

async function api(action, details = {}) {
  try {
    const res = await fetch(API_URL, {
      signal: AbortSignal.timeout(30000),
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...details })
    });
    const data = await res.json();
    if (data && data.site) applySite(data.site);
    return data;
  } catch (err) {
    return { ok: false, error: "NETWORK" };
  }
}

function applySite(site) {
  if (!site) return;
  if (site.contactEmail) { $("contact-link").textContent = site.contactEmail; $("contact-link").href = "mailto:" + site.contactEmail; }
  if (/^https:\/\//.test(site.instagramUrl || "")) $("instagram-link").href = site.instagramUrl;
}

function show(text, isError) {
  const out = $("find-result");
  out.textContent = text;
  out.style.color = isError ? "var(--error)" : "";
  out.hidden = !text;
}

async function submit(form, details) {
  const buttons = document.querySelectorAll("#page button[type=submit]");
  const labels = [...buttons].map((b) => b.textContent);
  buttons.forEach((b) => { b.disabled = true; b.textContent = T.findSending; });
  show("");
  const reply = await api("findMyTickets", details);
  buttons.forEach((b, i) => { b.disabled = false; b.textContent = labels[i]; });
  if (!reply.ok) return show(reply.error === "NETWORK" || reply.error === "SERVER_ERROR" ? T.error : (reply.message || T.error), true);
  show(reply.maskedEmails && reply.maskedEmails.length ? T.findMasked(reply.maskedEmails.join(", ")) + " " + reply.message : reply.message);
}

// One box to start with. "Forgot" swaps it for the UCID + last name search.
$("forgot").addEventListener("click", () => {
  const forgotten = $("find-ucid").hidden;
  $("find-ucid").hidden = !forgotten;
  $("find-email").hidden = forgotten;
  $("forgot").textContent = forgotten ? T.findBack : T.findForgot;
  show("");
});

$("find-email").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = $("f-email").value.trim();
  if (!email) return show(T.findNeed, true);
  submit(e.target, { email });
});

$("find-ucid").addEventListener("submit", (e) => {
  e.preventDefault();
  const ucid = $("f-ucid").value.trim();
  const lastName = $("f-last").value.trim();
  if (!ucid || !lastName) return show(T.findNeed, true);
  submit(e.target, { ucid, lastName });
});

document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = T[el.dataset.t]; });
$("contact-link").textContent = CONTACT_EMAIL;
$("contact-link").href = "mailto:" + CONTACT_EMAIL;
$("instagram-link").href = INSTAGRAM_URL;
