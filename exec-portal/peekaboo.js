// CSS background-refresh indicator: the Peekaboo panda peeks, waves and hides in a slow loop (peekaboo.css does the animation).
//   mountPeekaboo(el, "Updating in the background")   fills `el` with the panda; the text is the tooltip and screen-reader label
//   clearPeekaboo(el)                                 removes it
// It only says "the page keeps itself up to date"; it does not know when a check runs.

function mountPeekaboo(el, label) {
  if (!el) return;
  el.innerHTML = '<span class="peekaboo" role="img"></span>';
  const panda = el.firstChild;
  panda.setAttribute("aria-label", label || "");
  panda.title = label || "";
}

function clearPeekaboo(el) {
  if (el) el.innerHTML = "";
}
