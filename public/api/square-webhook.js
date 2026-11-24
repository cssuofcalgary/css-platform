// Square notification relay (events site, Vercel serverless function at /api/square-webhook).
//
// When someone pays by card, Square tells this address. We check the message really came from Square (its signature), and
// for a completed payment pass on just the Square order id to the CSS Platform API ("confirmSquareWebhook"). The API never
// trusts this: it asks Square itself whether the order was paid before recording anything. No money moves here.
//
// Vercel settings (Project → Settings → Environment Variables), never in this file:
//   SQUARE_WEBHOOK_SIGNATURE_KEY  the "Signature key" Square shows for this webhook subscription
//   SQUARE_WEBHOOK_URL            the exact notification URL entered in Square, e.g. https://events.ucalgarycss.ca/api/square-webhook
//   API_URL                       the CSS Platform API web app address (the same one as public/config.js)

const crypto = require("node:crypto");

const MAX_BODY_BYTES = 256 * 1024;

/** True when `signature` is Square's: Base64(HMAC-SHA256(key, notification URL + raw body)), compared in constant time. */
function verifySignature(rawBody, signature, key, url) {
  if (!key || !url || !signature) return false;
  const expected = crypto.createHmac("sha256", key).update(String(url) + String(rawBody)).digest("base64");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** The request body exactly as Square sent it (the signature covers these exact bytes). */
function readRawBody(req) {
  if (typeof req.rawBody === "string") return Promise.resolve(req.rawBody);
  if (Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody.toString("utf8"));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error("too big")); return; }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** The Square order id to check, when the event is a completed payment; otherwise "". */
function completedOrderId(event) {
  if (!event || event.type !== "payment.updated") return "";
  const payment = event.data && event.data.object && event.data.object.payment;
  if (!payment || payment.status !== "COMPLETED") return "";
  const id = String(payment.order_id || "");
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : "";
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Builds the handler. `deps.fetch` and `deps.env` can be swapped in tests (no network, no real keys). */
function makeHandler(deps) {
  deps = deps || {};
  return async function handler(req, res) {
    const env = deps.env || process.env;
    const doFetch = deps.fetch || globalThis.fetch;
    if (req.method !== "POST") return send(res, 405, { ok: false });
    let raw;
    try { raw = await readRawBody(req); } catch (e) { return send(res, 400, { ok: false }); }
    const signature = req.headers["x-square-hmacsha256-signature"];
    if (!verifySignature(raw, signature, env.SQUARE_WEBHOOK_SIGNATURE_KEY, env.SQUARE_WEBHOOK_URL)) return send(res, 401, { ok: false });
    let event;
    try { event = JSON.parse(raw); } catch (e) { return send(res, 400, { ok: false }); }
    const squareOrderId = completedOrderId(event);
    if (!squareOrderId) return send(res, 200, { ok: true, ignored: true });   // another kind of event: nothing to do
    if (!env.API_URL) return send(res, 500, { ok: false });
    try {
      // Apps Script answers a POST with a redirect to the result: follow it.
      const reply = await doFetch(env.API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "confirmSquareWebhook", squareOrderId: squareOrderId }),
        redirect: "follow"
      });
      const data = await reply.json().catch(() => ({}));
      // Not recorded yet (API busy or down): a non-200 makes Square send the notification again later.
      if (!reply.ok || !data || data.ok !== true) return send(res, 502, { ok: false });
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 502, { ok: false });
    }
  };
}

module.exports = makeHandler();
module.exports.config = { api: { bodyParser: false } };
module.exports.makeHandler = makeHandler;
module.exports.verifySignature = verifySignature;
module.exports.completedOrderId = completedOrderId;
module.exports.readRawBody = readRawBody;
