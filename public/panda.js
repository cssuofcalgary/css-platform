// CSS loader: loading, slow, success and error states. Drawn art lives in assets/panda/*.webp (transparent).
//   mountPanda(element, "loading")  shows the munching panda with the three leaves; after 6 s it becomes "taking a little longer", after 15 s "still working".
//   pandaMarkup("error", { sub: "...", retry: true })   markup only, for error and success screens.
//   pandaImg("success")                                  just the picture, for a hero above a title.
// Elements with data-panda in the page are filled in automatically (data-title and data-compact are optional).

const PANDA_BASE = "assets/panda/";
const PANDA_ART = false;   // false = no panda picture, just the three leaves (the public site and the member pass)
const PANDA_SLOW_MS = 6000;
const PANDA_SLEEPY_MS = 15000;

const PANDA_STATES = {
  loading: { frames: ["munch", "wiggle"], title: "Loading…", sub: "Just a moment, we're working on it!", dots: true },
  slow:    { frames: ["climb"], title: "Taking a little longer…", sub: "Still working behind the scenes!", dots: true },
  sleepy:  { frames: ["sleep"], title: "Still working…", sub: "Thanks for your patience!", dots: true },
  almost:  { frames: ["almost"], title: "Almost there…", sub: "Just a few more seconds!", dots: true },
  success: { frames: ["success"], title: "All set!", sub: "You're good to go.", dots: false },
  error:   { frames: ["error"], title: "Oops!", sub: "Something went wrong.", dots: false }
};

function pandaEsc(text) {
  return String(text === undefined || text === null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pandaImg(name, className) {
  if (!PANDA_ART) return "";
  return `<img class="pl-solo ${className || ""}" src="${PANDA_BASE}${name}.webp" alt="" decoding="async">`;
}

/** o = { title, sub, compact, retry } (title or sub can be "" to leave a line out). */
function pandaMarkup(state, o) {
  o = o || {};
  const s = PANDA_STATES[state] || PANDA_STATES.loading;
  const title = o.title !== undefined ? o.title : s.title;
  const sub = o.sub !== undefined ? o.sub : s.sub;
  const frames = !PANDA_ART ? "" : s.frames.map((f, i) => `<img class="pl-img pl-f${i}" src="${PANDA_BASE}${f}.webp" alt="" decoding="async">`).join("");
  return `<div class="pl${o.compact ? " pl-compact" : ""}${PANDA_ART ? "" : " pl-leaves"}" data-state="${state}" role="status" aria-live="polite">
    ${PANDA_ART ? `<div class="pl-stage pl-frames-${s.frames.length}">${frames}</div>` : ""}
    ${s.dots ? '<div class="pl-dots" aria-hidden="true"><i></i><i></i><i></i></div>' : ""}
    ${title ? `<p class="pl-title">${pandaEsc(title)}</p>` : ""}
    ${sub ? `<p class="pl-sub">${pandaEsc(sub)}</p>` : ""}
    ${o.retry ? '<button type="button" class="pl-retry">Try again</button>' : ""}
  </div>`;
}

/** Shows the loading panda in `el`, and moves it on to "taking longer" / "still working" while it stays there. */
function mountPanda(el, state, o) {
  o = o || {};
  clearTimeout(el._plSlow); clearTimeout(el._plSleepy);
  el.innerHTML = pandaMarkup(state || "loading", o);
  if ((state || "loading") !== "loading") return;
  const stillShowing = () => el.isConnected && !el.hidden && el.querySelector('.pl[data-state="loading"], .pl[data-state="slow"], .pl[data-state="almost"]');
  el._plSlow = setTimeout(() => { if (stillShowing()) el.innerHTML = pandaMarkup(o.batch ? "almost" : "slow", o); }, PANDA_SLOW_MS);
  el._plSleepy = setTimeout(() => { if (stillShowing()) el.innerHTML = pandaMarkup("sleepy", o); }, PANDA_SLEEPY_MS);
}

function clearPanda(el) {
  clearTimeout(el._plSlow); clearTimeout(el._plSleepy);
  el.innerHTML = "";
}

function startPandas() {
  document.querySelectorAll("[data-panda]").forEach((el) => {
    const o = { compact: el.hasAttribute("data-compact") };
    if (el.dataset.title) o.title = el.dataset.title;
    mountPanda(el, "loading", o);
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startPandas); else startPandas();
