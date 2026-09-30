// Demo mode (used only when API_URL in config.js is empty).
// Runs the real member logic from ../api/Members.js on made-up people, laid out
// exactly like the Membership sheet, so the page can be tried without touching CSS data.

const MockApi = (() => {
  const DEMO_PASSWORD = "demo";
  const DEMO_ADMIN_PASSWORD = "demo-admin";
  const HEADERS = ["Timestamp", "Full Name", "UCID", "Email", "Payment method", "When", "Where", "Who",
    "", "", "", "", "", "", "Paid Status", "Member ID", "Portal Link", "Mail Status"];
  const blanks = ["", "", "", "", "", ""];
  const ROWS = [
    [new Date("2026-09-10T12:04:00"), "Alex Wong", "30100001", "alex.wong@example.com", "E-transfer", "", "", "", ...blanks, true, "CSS0021234", "", "Sent"],
    [new Date("2026-09-10T12:31:00"), "Bella Chen", "30100002", "bella.c@example.com", "Cash", "Sep 10 clubs week", "MacHall booth", "Treasurer", ...blanks, true, "CSS0034821", "", "Sent"],
    [new Date("2026-09-11T09:15:00"), "Chris Li", "30100003", "chrisli@example.com", "E-transfer", "", "", "", ...blanks, "", "", "", ""],
    [new Date("2026-09-12T18:40:00"), "Daniel Zhang", "", "dz.guest@example.com", "E-transfer", "", "", "", ...blanks, "YES", "CSS0051177", "", ""],
    [new Date("2026-09-14T14:02:00"), "Emily Chan", "30100005", "emily.chan@example.com", "Cash", "", "", "", ...blanks, "TRUE", "CSS0066402", "", "Sent"],
    [new Date("2026-09-15T10:20:00"), "Emily Cheng", "30100006", "e.cheng@example.com", "E-transfer", "", "", "", ...blanks, false, "", "", ""]
  ];

  let ready = null;
  function loadLogic() {
    ready = ready || new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "../api/Members.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load ../api/Members.js"));
      document.head.appendChild(s);
    });
    return ready;
  }

  const sessions = new Set();

  async function handle(req) {
    await loadLogic();
    await new Promise((r) => setTimeout(r, 250));   // feel like a real network call
    const members = rowsToMembers_([HEADERS, ...ROWS]);

    switch (req.action) {
      case "login": {
        const role = req.password === DEMO_ADMIN_PASSWORD ? "admin" : req.password === DEMO_PASSWORD ? "exec" : "";
        if (!role) return { ok: false, error: "WRONG_PASSWORD" };
        if (!String(req.name || "").trim()) return { ok: false, error: "NAME_NEEDED" };
        const token = "demo-" + Math.random().toString(36).slice(2);
        sessions.add(token);
        return { ok: true, token, name: req.name.trim(), role };
      }
      case "logout":
        sessions.delete(req.token);
        return { ok: true };
      case "searchMembers":
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        const matches = searchMembers_(members, req.query, 100000);
        return { ok: true, results: matches.slice(0, 25), total: matches.length };
      case "getMember": {
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        const member = findMemberById_(members, req.memberId);
        return member ? { ok: true, member } : { ok: false, error: "NOT_FOUND" };
      }
      default:
        return { ok: false, error: "UNKNOWN_ACTION" };
    }
  }

  return { handle };
})();
