/** Questions organizers add to Join CSS. Standard membership fields stay unchanged. */
const MEMBERSHIP_QUESTIONS_PROPERTY = "MEMBERSHIP_QUESTIONS";
const MEMBERSHIP_QUESTIONS_MAX = 20;

function membershipQuestions_() {
  const saved = PropertiesService.getScriptProperties().getProperty(MEMBERSHIP_QUESTIONS_PROPERTY);
  if (!saved) return [];
  let questions;
  try { questions = JSON.parse(saved); } catch (e) { /* reported below */ }
  if (!Array.isArray(questions) || questions.length > MEMBERSHIP_QUESTIONS_MAX) {
    throw new ApiError_("SETUP_NEEDED", "The Join CSS questions couldn't be loaded. Open Members and save the questions again.");
  }
  return questions;
}

function getMembershipForm_(session) {
  if (!session || session.role !== "admin") throw new ApiError_("ADMIN_ONLY", "Changing the Join CSS form needs the admin password.");
  return { ok: true, questions: membershipQuestions_() };
}

function saveMembershipForm_(session, input) {
  if (!session || session.role !== "admin") throw new ApiError_("ADMIN_ONLY", "Changing the Join CSS form needs the admin password.");
  return withIntakeLock_(function () {
    let previous = [];
    try { previous = membershipQuestions_(); } catch (e) { if (!(e instanceof ApiError_) || e.code !== "SETUP_NEEDED") throw e; }
    const questions = cleanMembershipQuestions_(input, previous);
    // Keep the saved setting small and ASCII, including when questions contain Chinese text.
    const text = JSON.stringify(questions).replace(/[^ -~]/g, function (c) { return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4); });
    if (text.length > 8000) throw new ApiError_("BAD_REQUEST", "These questions are too long to save together. Shorten them or remove some choices.");
    PropertiesService.getScriptProperties().setProperty(MEMBERSHIP_QUESTIONS_PROPERTY, text);
    log_(session.name, "membership.form", "Join CSS", { questions: questions.length });
    return { ok: true, questions: questions };
  });
}

function cleanMembershipQuestions_(input, previous) {
  if (!Array.isArray(input)) throw new ApiError_("BAD_REQUEST", "Send the list of Join CSS questions.");
  if (input.length > MEMBERSHIP_QUESTIONS_MAX) throw new ApiError_("BAD_REQUEST", "Add up to 20 questions to Join CSS.");
  const existingIds = Object.create(null);
  (previous || []).forEach(function (q) { existingIds[q.id] = true; });
  const labels = Object.create(null), ids = Object.create(null);
  const oneLine = function (value, what) {
    const text = String(value === null || value === undefined ? "" : value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    if (!text || text.length > 120) throw new ApiError_("BAD_REQUEST", what + " must be between 1 and 120 characters.");
    return text;
  };
  return input.map(function (q) {
    q = q || {};
    const label = oneLine(q.label, "Each question");
    const key = label.toLowerCase();
    if (labels[key]) throw new ApiError_("BAD_REQUEST", "Two questions are worded the same. Give each question different wording.");
    labels[key] = true;
    const type = String(q.type || "text");
    if (type !== "text" && type !== "choice") throw new ApiError_("BAD_REQUEST", "Choose a text answer or a list of choices for " + label + ".");
    const rawId = String(q.id || "");
    const id = rawId && existingIds[rawId] ? rawId : newId_("MQ");
    if (ids[id]) throw new ApiError_("BAD_REQUEST", "The same question was added twice. Remove its extra copy.");
    ids[id] = true;
    let options = [];
    if (type === "choice") {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 30) throw new ApiError_("BAD_REQUEST", "Add between 2 and 30 choices for " + label + ".");
      const seen = Object.create(null);
      options = q.options.map(function (option) {
        const text = oneLine(option, "Each choice");
        const key = text.toLowerCase();
        if (seen[key]) throw new ApiError_("BAD_REQUEST", "The choices for " + label + " include the same answer twice.");
        seen[key] = true;
        return text;
      });
    }
    return { id: id, label: label, type: type, required: q.required === true, options: options };
  });
}

/** Save the question's wording with the answer so later form edits never rename old answers. */
function cleanMembershipAnswers_(input, questions, lenient) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const answers = Object.create(null);
  (questions || []).forEach(function (q) {
    const raw = Object.prototype.hasOwnProperty.call(input, q.id) ? input[q.id] : "";
    if (raw !== undefined && raw !== null && typeof raw !== "string" && typeof raw !== "number") throw new ApiError_("BAD_REQUEST", "Enter an answer for " + q.label + ".");
    const value = String(raw === null || raw === undefined ? "" : raw).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (value.length > 1000) throw new ApiError_("BAD_REQUEST", "The answer to " + q.label + " is too long (up to 1000 characters).");
    if (!value && q.required && !lenient) throw new ApiError_("BAD_REQUEST", "Please answer: " + q.label + ".");
    if (value && q.type === "choice" && q.options.indexOf(value) === -1) throw new ApiError_("BAD_REQUEST", "Choose one of the answers for " + q.label + ".");
    if (value) answers[q.label] = value;
  });
  return answers;
}
