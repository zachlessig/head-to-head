// Payments through Stripe (Zach picked Stripe 2026-11-16). The website calls this to open Stripe's
// own checkout page; card numbers never touch Head to Head. Actions:
//   subscribe     company owner starts the contractor plan (founding price while it's open)
//   portal        company owner manages or cancels the plan on Stripe's billing page
//   unlock        a homeowner pays $10 once for one yard (no account; the job lives on their phone)
//   unlock-check  after Stripe sends them back, confirm that payment really went through
// Stripe prices are found by lookup key, so switching founding to standard is a dashboard change.
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// "founding" until Zach closes the founding price; then set the PLAN_TIER secret to "standard".
// Prices (Zach 2026-11-16): founding $20 a month or $200 a year, standard $30 a month or $250 a
// year, a contractor's single yard $15, a homeowner's yard $10. Lookup keys are <tier>_monthly and
// <tier>_yearly. Which payment types checkout offers (cards, Apple Pay) is set on the Stripe
// account, not here: Stripe stopped taking that per checkout.
const PLAN_TIER = Deno.env.get("PLAN_TIER") === "standard" ? "standard" : "founding";
const YARD_LOOKUP = "yard_unlock";

// Stripe sends people back only to these sites, never to an address a request names
const RETURN_ORIGINS = [
  "https://zachlessig.github.io",
  "https://headtoheadapp.com",
  "https://www.headtoheadapp.com",
  "http://localhost:8742",
];
const SITE = "https://zachlessig.github.io/head-to-head/";

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin":
    origin && RETURN_ORIGINS.includes(origin) ? origin : RETURN_ORIGINS[0],
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
});

// Stripe's API takes form fields, with nested objects written as a[b][c]=...
function form(
  obj: Record<string, unknown>,
  prefix = "",
  out = new URLSearchParams(),
) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(
  path: string,
  body?: Record<string, unknown>,
  method = body ? "POST" : "GET",
) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: {
      Authorization: "Bearer " + STRIPE_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? form(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      (json.error && json.error.message) || "Stripe error " + res.status,
    );
  return json;
}

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok)
    throw new Error("Database error " + res.status + ": " + (await res.text()));
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function priceId(lookup: string) {
  const r = await stripe(
    "prices?active=true&lookup_keys[]=" + encodeURIComponent(lookup),
  );
  if (!r.data || !r.data.length)
    throw new Error("No Stripe price with lookup key " + lookup);
  return r.data[0].id as string;
}

// the signed-in person, from their own session token; null for a homeowner with no account
async function whoIs(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const res = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SERVICE_KEY, Authorization: auth },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u && u.id ? (u as { id: string; email?: string }) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// the app's job ids (same rule as the jobs table)
const JOB_ID = /^[A-Za-z0-9_-]{4,40}$/;

async function ownerOf(companyId: string, userId: string) {
  if (!UUID.test(companyId)) return false;
  const rows = await db(
    "members?select=role&company_id=eq." + companyId + "&user_id=eq." + userId,
  );
  return (
    Array.isArray(rows) &&
    rows.some((r: { role: string }) => r.role === "owner")
  );
}

function backTo(origin: string | null, path: string) {
  const base =
    origin && RETURN_ORIGINS.includes(origin)
      ? origin + (origin.includes("github.io") ? "/head-to-head/" : "/")
      : SITE;
  return base + path;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!STRIPE_KEY) return reply({ error: "Payments aren't set up yet." }, 503);

  let input: Record<string, string> = {};
  try {
    input = await req.json();
  } catch {
    return reply({ error: "Bad request" }, 400);
  }

  try {
    if (input.action === "subscribe" || input.action === "portal") {
      const user = await whoIs(req);
      if (!user) return reply({ error: "Sign in first." }, 401);
      const companyId = String(input.company_id || "");
      if (!(await ownerOf(companyId, user.id)))
        return reply(
          { error: "Only the company's owner can change the plan." },
          403,
        );
      const rows = await db("billing?select=*&company_id=eq." + companyId);
      let bill = Array.isArray(rows) && rows[0] ? rows[0] : null;

      if (input.action === "portal") {
        if (!bill || !bill.stripe_customer_id)
          return reply({ error: "No plan yet." }, 400);
        const s = await stripe("billing_portal/sessions", {
          customer: bill.stripe_customer_id,
          return_url: backTo(origin, "?billing=back"),
        });
        return reply({ url: s.url });
      }

      if (bill && ["active", "trialing", "past_due"].includes(bill.status))
        return reply(
          { error: "This company already has a plan. Use Manage billing." },
          409,
        );
      // a customer deleted on Stripe's side (or a leftover from a sandbox test) starts fresh
      if (bill && bill.stripe_customer_id) {
        const c = await stripe("customers/" + bill.stripe_customer_id).catch(() => null);
        if (!c || c.deleted) bill = { ...bill, stripe_customer_id: null };
      }
      if (!bill || !bill.stripe_customer_id) {
        const names = await db("companies?select=name&id=eq." + companyId);
        const c = await stripe("customers", {
          email: user.email,
          name: names && names[0] ? names[0].name : undefined,
          metadata: { company_id: companyId },
        });
        await db("billing?on_conflict=company_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({
            company_id: companyId,
            stripe_customer_id: c.id,
          }),
        });
        bill = { stripe_customer_id: c.id };
      }
      const s = await stripe("checkout/sessions", {
        mode: "subscription",
        customer: bill.stripe_customer_id,
        client_reference_id: companyId,
        line_items: {
          0: {
            price: await priceId(PLAN_TIER + (input.interval === "year" ? "_yearly" : "_monthly")),
            quantity: 1,
          },
        },
        subscription_data: {
          metadata: { company_id: companyId, plan: PLAN_TIER },
        },
        metadata: { company_id: companyId },
        success_url: backTo(origin, "?billing=done"),
        cancel_url: backTo(origin, "?billing=cancel"),
      });
      return reply({ url: s.url });
    }

    if (input.action === "unlock") {
      const jobId = String(input.job_id || "");
      if (!JOB_ID.test(jobId)) return reply({ error: "Bad job" }, 400);
      const s = await stripe("checkout/sessions", {
        mode: "payment",
        line_items: { 0: { price: await priceId(YARD_LOOKUP), quantity: 1 } },
        metadata: { job_id: jobId, kind: "yard_unlock" },
        // Stripe fills in {CHECKOUT_SESSION_ID}; the app checks it on the way back
        success_url: backTo(
          origin,
          "?unlock={CHECKOUT_SESSION_ID}&job=" + jobId,
        ),
        cancel_url: backTo(origin, "#/job/" + jobId),
      });
      return reply({ url: s.url });
    }

    if (input.action === "unlock-check") {
      const sid = String(input.session_id || "");
      const jobId = String(input.job_id || "");
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid) || !JOB_ID.test(jobId))
        return reply({ error: "Bad request" }, 400);
      const s = await stripe("checkout/sessions/" + sid);
      const paid =
        s.payment_status === "paid" &&
        s.metadata &&
        s.metadata.job_id === jobId &&
        s.metadata.kind === "yard_unlock";
      return reply({ paid });
    }

    return reply({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return reply(
      { error: "Couldn't reach the payment company. Try again in a minute." },
      502,
    );
  }
});
