/** Personal exec passwords. Settings unlocks separately, after signing in. */
const EXEC_BCRYPT_COST = 12;
const EXEC_SETUP_SECONDS = 600;

function execPasswordLibrary_() {
  // bcryptjs 3.0.3 (Bcrypt.js). Apps Script has neither WebCrypto nor Node's crypto module.
  bcrypt.setRandomFallback(function (length) {
    let hex = "";
    while (hex.length < length * 2) hex += Utilities.getUuid().replace(/-/g, "");
    const bytes = [];
    for (let i = 0; i < length; i++) bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
    return bytes;
  });
  return bcrypt;
}

// Passlib's bcrypt-sha256 v2 format: salt-keyed HMAC prevents bcrypt truncating long passwords.
// https://passlib.readthedocs.io/en/stable/lib/passlib.hash.bcrypt_sha256.html
function execPasswordInput_(password, salt) {
  return Utilities.base64Encode(Utilities.computeHmacSha256Signature(password, salt));
}

function hashExecPassword_(password) {
  const library = execPasswordLibrary_();
  const salt = library.genSaltSync(EXEC_BCRYPT_COST);
  const hashed = library.hashSync(execPasswordInput_(password, salt.slice(7)), salt);
  return "$bcrypt-sha256$v=2,t=2b,r=" + EXEC_BCRYPT_COST + "$" + hashed.slice(7, 29) + "$" + hashed.slice(29);
}

function verifyExecPassword_(password, stored) {
  if (!password) return false;
  const match = String(stored || "").match(/^\$bcrypt-sha256\$v=2,t=2b,r=(\d{1,2})\$([./A-Za-z0-9]{22})\$([./A-Za-z0-9]{31})$/);
  const library = execPasswordLibrary_();
  if (match) {
    const cost = Number(match[1]);
    if (cost < 4 || cost > 16) return false;
    const hash = "$2b$" + ("0" + cost).slice(-2) + "$" + match[2] + match[3];
    return library.compareSync(execPasswordInput_(password, match[2]), hash);
  }
  // Existing accounts keep working with their original bcrypt hashes.
  return !library.truncates(password) && library.compareSync(password, String(stored || ""));
}

function execLoginAttempt_(name) {
  const cache = CacheService.getScriptCache();
  const key = loginFailKey_(name);
  const failed = parseInt(cache.get(key) || "0", 10);
  if (failed >= MAX_FAILED_LOGINS) throw new ApiError_("TOO_MANY_TRIES", "Too many wrong passwords. Try again in 10 minutes.");
  return { cache: cache, key: key, failed: failed };
}

function execWrongPassword_(attempt) {
  attempt.cache.put(attempt.key, String(attempt.failed + 1), 600);
  throw new ApiError_("WRONG_PASSWORD", "That name and password don't match.");
}

function personalLogin_(password, name) {
  const config = getConfig_();
  if (!config.password) throw new ApiError_("SETUP_NEEDED", "The club password has not been set.");
  const who = memberText_(name, 60);
  if (!who) throw new ApiError_("NAME_NEEDED", "Pick your name.");
  const attempt = execLoginAttempt_(who);
  const typed = String(password || "");
  const person = taskTeamByName_(who);
  if (person && !isOn_(person.active)) return execWrongPassword_(attempt);
  if (person && person.passwordHash) {
    const expectedHash = person.passwordHash, expectedVersion = person.authVersion;
    if (!verifyExecPassword_(typed, person.passwordHash)) return execWrongPassword_(attempt);
    const reply = withLock_(function () {
      delete DB_.rows["Team"];
      const fresh = readRows_("Team").filter(function (p) { return p.id === person.id; })[0];
      if (!fresh || !isOn_(fresh.active) || fresh.passwordHash !== expectedHash || fresh.authVersion !== expectedVersion) return execWrongPassword_(attempt);
      return execSignInReply_(fresh);
    });
    attempt.cache.remove(attempt.key);
    return reply;
  }
  if (typed !== config.password) return execWrongPassword_(attempt);
  if (!person && peopleLocked_()) throw new ApiError_("PERSON_NOT_LISTED", "Your name isn't on the People list. Ask an admin to add you first.");
  const setupToken = Utilities.getUuid();
  attempt.cache.put("exec_setup_" + setupToken, JSON.stringify({ name: person ? person.name : who,
    personId: person ? person.id : "", authVersion: person ? String(person.authVersion || "") : "" }), EXEC_SETUP_SECONDS);
  attempt.cache.remove(attempt.key);
  return { ok: true, needsPasswordSetup: true, setupToken: setupToken, name: person ? person.name : who };
}

function finishExecSetup_(setupToken, password) {
  const cache = CacheService.getScriptCache();
  const key = "exec_setup_" + String(setupToken || "");
  const raw = setupToken && cache.get(key);
  if (!raw) throw new ApiError_("PASSWORD_SETUP_EXPIRED", "Sign in with the club password again to set your password.");
  const setup = JSON.parse(raw);
  const typed = typeof password === "string" ? password : "";
  if (!typed) throw new ApiError_("BAD_REQUEST", "Enter a password.");
  const hash = hashExecPassword_(typed);
  const reply = withLock_(function () {
    if (!cache.get(key)) throw new ApiError_("PASSWORD_SETUP_EXPIRED", "Sign in with the club password again.");
    delete DB_.rows["Team"];
    let person = taskTeamByName_(setup.name);
    if ((setup.personId && (!person || person.id !== setup.personId)) ||
        (person && (!isOn_(person.active) || person.passwordHash || String(person.authVersion || "") !== setup.authVersion))) {
      throw new ApiError_("PASSWORD_SETUP_EXPIRED", "Your sign-in details changed. Sign in again.");
    }
    if (!person) {
      if (peopleLocked_()) throw new ApiError_("PERSON_NOT_LISTED", "Your name isn't on the People list. Ask an admin to add you first.");
      person = teamInsert_(setup.name, "");
      log_(person.name, "person.added", person.id, { name: person.name, source: "sign-in" });
    }
    const changes = { passwordHash: hash, passwordSetAt: new Date().toISOString(), authVersion: Utilities.getUuid() };
    updateRow_("Team", person.id, changes, person._row);
    Object.assign(person, changes);
    cache.remove(key);
    log_(person.name, "person.passwordSet", person.id, { name: person.name });
    return execSignInReply_(person);
  });
  return reply;
}

function execSignInReply_(person) {
  return { ok: true, token: startSession_(person.name, "exec", person), name: person.name, role: "exec", membershipFee: getConfig_().membershipFee };
}

/** The gear unlocks settings for the already authenticated person; it never signs someone in. */
function unlockSettings_(session, password) {
  const attempt = execLoginAttempt_("settings_" + (session.personId || session.name));
  const expected = getConfig_().adminPassword;
  if (!expected || String(password || "") !== expected) return execWrongPassword_(attempt);
  attempt.cache.remove(attempt.key);
  const person = session.personId ? { id: session.personId, authVersion: session.personVersion } : null;
  return { ok: true, token: startSession_(session.name, "admin", person), name: session.name, role: "admin", membershipFee: getConfig_().membershipFee };
}

/** Called before any signed-in action. A reset, removal or deactivation invalidates the person's sessions. */
function checkExecAccountSession_(session) {
  if (session.role !== "exec" && !(session.role === "admin" && session.personId)) return;
  const person = session.personId
    ? readRows_("Team").filter(function (p) { return p.id === session.personId; })[0]
    : taskTeamByName_(session.name);
  const valid = session.personId
    ? person && isOn_(person.active) && person.passwordHash && person.authVersion === session.personVersion
    : (!person ? !peopleLocked_() : isOn_(person.active) && !person.authVersion && !person.passwordHash);
  if (!valid) throw new ApiError_("NOT_LOGGED_IN", "Your sign-in changed. Please sign in again.");
  if (person) session.name = person.name;
}

function resetPersonPassword_(session, id) {
  return withLock_(function () {
    delete DB_.rows["Team"];
    const person = readRows_("Team").filter(function (p) { return p.id === String(id || ""); })[0];
    if (!person) throw new ApiError_("NOT_FOUND", "That person is no longer on the list.");
    updateRow_("Team", person.id, { passwordHash: "", passwordSetAt: "", authVersion: Utilities.getUuid() }, person._row);
    CacheService.getScriptCache().remove(loginFailKey_(person.name));
    delete DB_.rows["Team"];
    log_(session.name, "person.passwordReset", person.id, { name: person.name });
    return { ok: true, team: taskTeam_() };
  });
}
