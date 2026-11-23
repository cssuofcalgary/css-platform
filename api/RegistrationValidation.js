/** Checks shared by event registration, membership signup and attendee corrections. */
function emailProblem_(email) {
  email = String(email || "").trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}$/.test(email)) return "That email doesn't look right.";
  const domain = email.split("@")[1];
  const corrections = {
    "gnail.com": "gmail.com", "gmial.com": "gmail.com", "gamil.com": "gmail.com",
    "gmaill.com": "gmail.com", "gmai.com": "gmail.com", "gmail.con": "gmail.com", "gmail.cmo": "gmail.com",
    "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com",
    "outlok.com": "outlook.com", "outlook.con": "outlook.com",
    "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com", "ucalgary.con": "ucalgary.ca"
  };
  if (Object.prototype.hasOwnProperty.call(corrections, domain)) {
    return "Check your email address: did you mean " + corrections[domain] + " instead of " + domain + "?";
  }
  return "";
}

/** Optional plain-text notes: preserve line breaks and prevent spreadsheet formula input. */
function registrationNote_(value, max) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim().replace(/^[=+\-@'\s]+/, "").slice(0, max || 1000);
}
