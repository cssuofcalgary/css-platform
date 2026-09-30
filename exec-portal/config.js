// The CSS Platform API web app address (Apps Script → Deploy → Web app URL, ending in /exec).
// Leave it empty to run the page with made-up demo data.
const API_URL = "https://script.google.com/macros/s/AKfycbxJ_a_cHyRXadK17ocIebhE2XDFcpEADCzSqOVXwdCgIQe1T-UPi-efzgla2mn7ML2d/exec";

// Where the public event pages live. The "Public page" links and the links in ticket emails use this.
// On exec.ucalgarycss.ca (Vercel) the public site is its own subdomain; anywhere else (GitHub Pages,
// opening the folder locally) it is the sibling folder.
const PUBLIC_SITE_URL = location.hostname === "exec.ucalgarycss.ca" ? "https://events.ucalgarycss.ca/" : "../public/";
