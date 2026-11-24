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

function execLoginAttempt_(name, sharedScope) {
  const cache = CacheService.getScriptCache();
  const key = loginFailKey_(name);
  const failed = parseInt(cache.get(key) || "0", 10);
  const sharedKey = sharedScope ? "failed_shared_" + sharedScope : "";
  const sharedFailed = sharedKey ? parseInt(cache.get(sharedKey) || "0", 10) : 0;
  if (failed >= MAX_FAILED_LOGINS || sharedFailed >= MAX_FAILED_LOGINS) throw new ApiError_("TOO_MANY_TRIES", "Too many wrong passwords. Try again in 10 minutes.");
  return { cache: cache, key: key, failed: failed, sharedKey: sharedKey, sharedFailed: sharedFailed };
}

function execWrongPassword_(attempt) {
  attempt.cache.put(attempt.key, String(attempt.failed + 1), 600);
  if (attempt.sharedKey) attempt.cache.put(attempt.sharedKey, String(attempt.sharedFailed + 1), 600);
  throw new ApiError_("WRONG_PASSWORD", "That name and password don't match.");
}

function clearExecLoginAttempt_(attempt) {
  attempt.cache.remove(attempt.key);
  if (attempt.sharedKey) attempt.cache.remove(attempt.sharedKey);
}

/**
 * The People row a typed sign-in name means: the exact name (any capitals or spacing), otherwise the one active person whose
 * first name (or the start of whose full name) it is, so "amy" or "Amy L" signs in as "Amy Lee". Two people it could be:
 * NAME_AMBIGUOUS, naming them. Nobody: null (a new person, as before).
 */
function signInPerson_(typed) {
  const exact = taskTeamByName_(typed);
  if (exact) return exact;
  const key = teamNameKey_(typed);
  const matches = readRows_("Team").filter(function (r) {
    const name = teamNameKey_(r.name);
    return isOn_(r.active) && name && (name.split(" ")[0] === key || name.indexOf(key + " ") === 0 || (key.indexOf(" ") !== -1 && name.indexOf(key) === 0));
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new ApiError_("NAME_AMBIGUOUS", "More than one person is called that: " +
      matches.map(function (r) { return String(r.name).trim(); }).join(", ") + ". Type your full name.");
  }
  return null;
}

/** Public: the active names on the People list, for the sign-in name box. Names only. Kept for 5 minutes. */
function signInNames_() {
  const cache = CacheService.getScriptCache();
  const saved = cache.get("signin_names");
  if (saved) return { ok: true, names: JSON.parse(saved) };
  const names = taskTeam_().filter(function (p) { return p.active && String(p.name || "").trim(); })
    .map(function (p) { return String(p.name).replace(/\s+/g, " ").trim(); });
  cache.put("signin_names", JSON.stringify(names), 300);
  return { ok: true, names: names };
}

function personalLogin_(password, name) {
  const config = getConfig_();
  if (!config.password) throw new ApiError_("SETUP_NEEDED", "The club password has not been set.");
  const typed_ = memberText_(name, 60);
  if (!typed_) throw new ApiError_("NAME_NEEDED", "Pick your name.");
  const person = signInPerson_(typed_);
  const who = person ? String(person.name).trim() : typed_;
  // A locked roster rejects unknown names before comparing the club password.
  if (!person && peopleLocked_()) throw new ApiError_("PERSON_NOT_LISTED", "Your name isn't on the People list. Ask an admin to add you first.");
  const attempt = execLoginAttempt_(who, person && person.passwordHash ? "" : "club");
  const typed = String(password || "");
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
    clearExecLoginAttempt_(attempt);
    return reply;
  }
  if (typed !== config.password) return execWrongPassword_(attempt);
  const setupToken = Utilities.getUuid();
  attempt.cache.put("exec_setup_" + setupToken, JSON.stringify({ name: person ? person.name : who,
    personId: person ? person.id : "", authVersion: person ? String(person.authVersion || "") : "", epoch: currentEpoch_() }), EXEC_SETUP_SECONDS);
  clearExecLoginAttempt_(attempt);
  return { ok: true, needsPasswordSetup: true, setupToken: setupToken, name: person ? person.name : who };
}

function finishExecSetup_(setupToken, password) {
  const cache = CacheService.getScriptCache();
  const key = "exec_setup_" + String(setupToken || "");
  const raw = setupToken && cache.get(key);
  if (!raw) throw new ApiError_("PASSWORD_SETUP_EXPIRED", "Sign in with the club password again to set your password.");
  const setup = JSON.parse(raw);
  if (setup.epoch !== currentEpoch_()) throw new ApiError_("PASSWORD_SETUP_EXPIRED", "Sign in with the club password again.");
  const typed = typeof password === "string" ? password : "";
  if (!typed) throw new ApiError_("BAD_REQUEST", "Enter a password.");
  const hash = hashExecPassword_(typed);
  const reply = withLock_(function () {
    if (!cache.get(key) || setup.epoch !== currentEpoch_()) throw new ApiError_("PASSWORD_SETUP_EXPIRED", "Sign in with the club password again.");
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
  const attempt = execLoginAttempt_("settings_" + (session.personId || session.name), "settings");
  const expected = getConfig_().adminPassword;
  if (!expected || String(password || "") !== expected) return execWrongPassword_(attempt);
  clearExecLoginAttempt_(attempt);
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
    CacheService.getScriptCache().remove("failed_shared_club");
    delete DB_.rows["Team"];
    log_(session.name, "person.passwordReset", person.id, { name: person.name });
    return { ok: true, team: taskTeam_() };
  });
}
