// Stripe tells the server here when a contractor's plan starts, renews, fails or is cancelled
// (Zach picked Stripe 2026-11-16). Each message is signed with STRIPE_WEBHOOK_SECRET; anything
// unsigned or older than 5 minutes is refused, so nobody can mark a company paid by posting here.
// The function is deployed with JWT checks off, because Stripe has no Supabase session.
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Stripe's own libraries refuse signatures older than 300 seconds; same here
const TOLERANCE_S = 300;

const enc = new TextEncoder();

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// same length, every character compared, so timing doesn't leak how much matched
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signedByStripe(raw: string, header: string) {
  const parts = header.split(",").map((p) => p.split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const want = hex(
    await crypto.subtle.sign("HMAC", key, enc.encode(t + "." + raw)),
  );
  return sigs.some((s) => sameText(s, want));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function saveBilling(row: Record<string, unknown>) {
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/billing?on_conflict=company_id",
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: "Bearer " + SERVICE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
    },
  );
  if (!res.ok)
    throw new Error(
      "billing not saved: " + res.status + " " + (await res.text()),
    );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!WEBHOOK_SECRET) return new Response("not set up", { status: 503 });
  const raw = await req.text();
  if (!(await signedByStripe(raw, req.headers.get("stripe-signature") || "")))
    return new Response("bad signature", { status: 400 });

  const event = JSON.parse(raw);
  const obj = event.data && event.data.object;
  try {
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const companyId = obj.metadata && obj.metadata.company_id;
      if (!companyId || !UUID.test(companyId))
        return new Response("no company", { status: 200 });
      const plan = obj.metadata.plan === "standard" ? "standard" : "founding";
      // newer Stripe versions keep the period end on the subscription item
      const end =
        obj.current_period_end ??
        (obj.items &&
          obj.items.data &&
          obj.items.data[0] &&
          obj.items.data[0].current_period_end);
      await saveBilling({
        company_id: companyId,
        stripe_customer_id: obj.customer,
        subscription_id: obj.id,
        status:
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : obj.status,
        plan,
        current_period_end: end ? new Date(end * 1000).toISOString() : null,
        cancel_at_period_end: !!obj.cancel_at_period_end,
      });
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error(e);
    // a 500 makes Stripe send it again later
    return new Response("error", { status: 500 });
  }
});
