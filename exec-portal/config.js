// The CSS Platform API web app address (Apps Script → Deploy → Web app URL, ending in /exec).
// Leave it empty to run the page with made-up demo data.
const API_URL = "https://script.google.com/macros/s/AKfycbxJ_a_cHyRXadK17ocIebhE2XDFcpEADCzSqOVXwdCgIQe1T-UPi-efzgla2mn7ML2d/exec";

// Where the public event pages live. The "Public page" links and the links in ticket emails use this.
// It follows the host this portal is opened from, so one codebase works everywhere:
//   exec.ucalgarycss.ca      -> https://events.ucalgarycss.ca/
//   *.vercel.app (testing)   -> https://css-platform-public.vercel.app/
//   anything else (GitHub Pages, local folder) -> the sibling folder ../public/
const PUBLIC_SITE_URL = location.hostname === "exec.ucalgarycss.ca" ? "https://events.ucalgarycss.ca/"
  : location.hostname.endsWith(".vercel.app") ? "https://css-platform-public.vercel.app/"
  : "../public/";
