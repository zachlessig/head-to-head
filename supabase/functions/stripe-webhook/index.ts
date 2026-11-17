// Stripe tells the server here when a contractor's plan starts, renews, fails or is cancelled
// (Zach picked Stripe 2026-11-16). Each message is signed with STRIPE_WEBHOOK_SECRET; anything
// unsigned or older than 5 minutes is refused, so nobody can mark a company paid by posting here.
// The function is deployed with JWT checks off, because Stripe has no Supabase session.
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const LIVE = ["active", "trialing", "past_due"];

// Stripe doesn't promise messages arrive in order, so the subscription is read fresh from Stripe
// and that's what gets saved, never the copy inside the message (review 2026-11-17: a late
// "created" could overwrite "active").
async function freshSubscription(id: string) {
  const res = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(id), {
    headers: { Authorization: "Bearer " + STRIPE_KEY },
  });
  if (!res.ok) throw new Error("subscription read " + res.status);
  return await res.json();
}

async function currentBilling(companyId: string) {
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/billing?select=subscription_id,status&company_id=eq." + companyId,
    { headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY } },
  );
  if (!res.ok) throw new Error("billing read " + res.status);
  const rows = await res.json();
  return rows[0] || null;
}
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
      const sub = await freshSubscription(String(obj.id));
      const companyId = sub.metadata && sub.metadata.company_id;
      if (!companyId || !UUID.test(companyId))
        return new Response("no company", { status: 200 });
      // a company deleted with its account: nothing to record, and a 500 would make Stripe retry
      const co = await fetch(SUPABASE_URL + "/rest/v1/companies?select=id&id=eq." + companyId, {
        headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY },
      }).then((r) => r.json());
      if (!Array.isArray(co) || !co.length) return new Response("company gone", { status: 200 });
      // a second subscription that ended doesn't overwrite the one that's still running
      const cur = await currentBilling(companyId);
      if (cur && cur.subscription_id && cur.subscription_id !== sub.id && LIVE.includes(cur.status) && !LIVE.includes(sub.status))
        return new Response("older subscription", { status: 200 });
      const plan = sub.metadata.plan === "standard" ? "standard" : "founding";
      // newer Stripe versions keep the period end on the subscription item
      const end = sub.current_period_end ??
        (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end);
      await saveBilling({
        company_id: companyId,
        stripe_customer_id: sub.customer,
        subscription_id: sub.id,
        status: sub.status,
        plan,
        current_period_end: end ? new Date(end * 1000).toISOString() : null,
        cancel_at_period_end: !!(sub.cancel_at_period_end || sub.cancel_at),
        pending_checkout: null,
      });
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error(e);
    // a 500 makes Stripe send it again later
    return new Response("error", { status: 500 });
  }
});
