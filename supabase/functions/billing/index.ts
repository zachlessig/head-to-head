// Payments through Stripe (Zach picked Stripe 2026-11-16). The website calls this to open Stripe's
// own checkout page; card numbers never touch Head to Head. Actions:
//   subscribe     company owner starts the contractor plan (founding price while it's open)
//   portal        company owner manages or cancels the plan on Stripe's billing page
//   unlock        a homeowner pays $15 once for one yard (no account; the job lives on their phone)
//   unlock-check  after Stripe sends them back, confirm that payment really went through
//   crew-sync     recount the crew and set the extra-crew line on the plan to match
// Stripe prices are found by lookup key, so switching founding to standard is a dashboard change.
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// "founding" until Zach closes the founding price; then set the PLAN_TIER secret to "standard".
// Prices (Zach 2026-11-16): founding $20 a month or $200 a year, standard $30 a month or $250 a
// year, a yard $15 for contractors and homeowners alike (Zach 2026-11-17). Lookup keys are <tier>_monthly and
// <tier>_yearly. Which payment types checkout offers (cards, Apple Pay) is set on the Stripe
// account, not here: Stripe stopped taking that per checkout.
const PLAN_TIER = Deno.env.get("PLAN_TIER") === "standard" ? "standard" : "founding";
const YARD_LOOKUP = "yard_unlock"; // homeowner, $15
const PRO_YARD_LOOKUP = "contractor_yard"; // contractor with no plan, $15 (Zach 2026-11-16)

// Stripe sends people back only to these sites, never to an address a request names
const RETURN_ORIGINS = [
  "https://zachlessig.github.io",
  "https://headtoheadapp.com",
  "https://www.headtoheadapp.com",
  "http://localhost:8742",
];
const SITE = "https://headtoheadapp.com/";

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

// Crew (Zach 2026-11-17): "lets just say you can have 5 crew members on the app before you need $5
// more a month". The owner isn't counted. Extra people are a second line on the same subscription,
// $5 a month (extra_crew_monthly) or $60 a year on a yearly plan (extra_crew_yearly), because
// Stripe needs every line on one subscription to bill on the same schedule.
const FREE_CREW = 5;
// Referrals (Zach 2026-11-17): $5 off the new contractor's first payment (Stripe coupon below,
// made by scripts/stripe-prices.mjs); the referrer's free month is credited by stripe-webhook.
const REFERRAL_COUPON = "referral_5_off";
const CODE = /^[A-Z0-9]{8}$/;

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

async function memberOf(companyId: string, userId: string) {
  if (!UUID.test(companyId)) return false;
  const rows = await db(
    "members?select=role&company_id=eq." + companyId + "&user_id=eq." + userId,
  );
  return Array.isArray(rows) && rows.length > 0;
}

// people in the company besides the owner, counted here so the app can't send a smaller number
async function crewCount(companyId: string) {
  const rows = await db(
    "members?select=user_id&role=eq.member&company_id=eq." + companyId,
  );
  return Array.isArray(rows) ? rows.length : 0;
}
const extraCrew = (crew: number) => Math.max(0, crew - FREE_CREW);

// Make the plan's extra-crew line match the crew. Nothing to do without a running plan: the count
// is taken again when one starts. Stripe prorates a change onto the next bill.
async function syncCrew(companyId: string) {
  const crew = await crewCount(companyId);
  const extra = extraCrew(crew);
  const rows = await db("billing?select=subscription_id,status&company_id=eq." + companyId);
  const bill = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!bill || !bill.subscription_id || !["active", "trialing", "past_due"].includes(bill.status))
    return { crew, extra, billed: false };
  const sub = await stripe("subscriptions/" + bill.subscription_id);
  const items = (sub.items && sub.items.data) || [];
  const isCrew = (it: { price?: { lookup_key?: string } }) =>
    !!(it.price && it.price.lookup_key && it.price.lookup_key.startsWith("extra_crew_"));
  const crewItem = items.find(isCrew);
  const planItem = items.find((it: { price?: { lookup_key?: string } }) => !isCrew(it));
  const yearly = !!(planItem && planItem.price && planItem.price.recurring &&
    planItem.price.recurring.interval === "year");
  if (extra > 0 && !crewItem)
    await stripe("subscription_items", {
      subscription: sub.id,
      price: await priceId(yearly ? "extra_crew_yearly" : "extra_crew_monthly"),
      quantity: extra,
    });
  else if (extra > 0 && crewItem.quantity !== extra)
    await stripe("subscription_items/" + crewItem.id, { quantity: extra });
  else if (extra === 0 && crewItem)
    await stripe("subscription_items/" + crewItem.id, undefined, "DELETE");
  return { crew, extra, billed: true };
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
      // a referral code only counts on a company's first plan, and never its own code
      let referrer: string | null = null;
      const code = String(input.referral_code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code) {
        if (!CODE.test(code))
          return reply({ error: "That referral code isn't right. It's 8 letters and numbers." }, 400);
        const found = await db("companies?select=id&referral_code=eq." + code);
        if (!Array.isArray(found) || !found.length)
          return reply({ error: "That referral code isn't right. Check it with whoever gave it to you." }, 400);
        if (found[0].id === companyId)
          return reply({ error: "That's your own company's code. Share it with another contractor instead." }, 400);
        // the same person on both sides isn't a referral (security review 2026-11-17); the webhook
        // checks again, and checks cards, before any free month
        const both = await db("members?select=company_id,user_id&company_id=in.(" + companyId + "," + found[0].id + ")");
        const theirs = new Set((both || []).filter((m: { company_id: string }) => m.company_id === found[0].id).map((m: { user_id: string }) => m.user_id));
        if ((both || []).some((m: { company_id: string; user_id: string }) => m.company_id === companyId && theirs.has(m.user_id)))
          return reply({ error: "That code is from a company you're part of. Referral codes are for another contractor." }, 400);
        const before = await db("billing?select=subscription_id&company_id=eq." + companyId);
        const had = await db("referrals?select=company_id&company_id=eq." + companyId);
        if ((Array.isArray(before) && before[0] && before[0].subscription_id) ||
          (Array.isArray(had) && had.length))
          return reply({ error: "Referral codes only work on a company's first plan." }, 400);
        // the referrer rides on the subscription; stripe-webhook rewards them after the first
        // payment and records it in referrals then
        referrer = found[0].id;
      }
      const yearly = input.interval === "year";
      const extra = extraCrew(await crewCount(companyId));
      const lines: Record<string, unknown> = {
        0: { price: await priceId(PLAN_TIER + (yearly ? "_yearly" : "_monthly")), quantity: 1 },
      };
      if (extra > 0)
        lines[1] = { price: await priceId(yearly ? "extra_crew_yearly" : "extra_crew_monthly"), quantity: extra };
      if (bill.pending_checkout)
        await stripe("checkout/sessions/" + bill.pending_checkout + "/expire", {}).catch(() => null);
      const s = await stripe("checkout/sessions", {
        mode: "subscription",
        customer: bill.stripe_customer_id,
        client_reference_id: companyId,
        line_items: lines,
        discounts: referrer ? { 0: { coupon: REFERRAL_COUPON } } : undefined,
        subscription_data: {
          metadata: { company_id: companyId, plan: PLAN_TIER, referrer: referrer || undefined },
        },
        metadata: { company_id: companyId },
        success_url: backTo(origin, "?billing=done"),
        cancel_url: backTo(origin, "?billing=cancel"),
      });
      await db("billing?company_id=eq." + companyId, {
        method: "PATCH",
        body: JSON.stringify({ pending_checkout: s.id }),
      });
      return reply({ url: s.url });
    }

    // Any member's app asks for this after someone joins or is removed, and the owner's company
    // screen asks when it opens; the server does the counting either way.
    if (input.action === "crew-sync") {
      const user = await whoIs(req);
      if (!user) return reply({ error: "Sign in first." }, 401);
      const companyId = String(input.company_id || "");
      if (!(await memberOf(companyId, user.id)))
        return reply({ error: "Not in this company." }, 403);
      return reply(await syncCrew(companyId));
    }

    // Deactivate (Zach 2026-11-17): stop the plan at the end of the paid time; the account and
    // every job stay, read-only past that point.
    if (input.action === "cancel") {
      const user = await whoIs(req);
      if (!user) return reply({ error: "Sign in first." }, 401);
      const companyId = String(input.company_id || "");
      if (!(await ownerOf(companyId, user.id)))
        return reply({ error: "Only the company's owner can change the plan." }, 403);
      const rows = await db("billing?select=subscription_id,status&company_id=eq." + companyId);
      const bill = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (!bill || !bill.subscription_id || bill.status === "canceled")
        return reply({ error: "There's no active plan to stop." }, 400);
      const sub = await stripe("subscriptions/" + bill.subscription_id, { cancel_at_period_end: "true" });
      return reply({ ok: true, ends: sub.cancel_at || null });
    }

    // Delete account (Zach 2026-11-17; Apple also requires it in the app). An owner's company goes
    // with them: its plan is cancelled now, then the company and every job, folder and invite in it
    // are deleted. Someone who isn't an owner just leaves. Then the sign-in itself is deleted.
    if (input.action === "delete-account") {
      const user = await whoIs(req);
      if (!user) return reply({ error: "Sign in first." }, 401);
      const owned = await db("companies?select=id&owner_id=eq." + user.id);
      for (const c of Array.isArray(owned) ? owned : []) {
        const rows = await db("billing?select=subscription_id,status&company_id=eq." + c.id);
        const bill = Array.isArray(rows) && rows[0] ? rows[0] : null;
        if (bill && bill.subscription_id && bill.status !== "canceled")
          // if the plan can't be stopped, don't delete: they'd keep paying with no account left
          await stripe("subscriptions/" + bill.subscription_id, undefined, "DELETE");
        await db("companies?id=eq." + c.id, { method: "DELETE" });
      }
      await db("members?user_id=eq." + user.id, { method: "DELETE" });
      const res = await fetch(SUPABASE_URL + "/auth/v1/admin/users/" + user.id, {
        method: "DELETE",
        headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY },
      });
      if (!res.ok) throw new Error("auth delete " + res.status + " " + (await res.text()));
      return reply({ ok: true });
    }

    if (input.action === "unlock") {
      const jobId = String(input.job_id || "");
      if (!JOB_ID.test(jobId)) return reply({ error: "Bad job" }, 400);
      // the price follows who's asking, not what the page says: anyone signed into a company pays
      // the contractor price (review 2026-11-17: the page could ask for the $10 one)
      const asker = await whoIs(req);
      const inCompany = asker
        ? ((await db("members?select=company_id&user_id=eq." + asker.id + "&limit=1")) || []).length > 0
        : false;
      input.kind = inCompany ? "contractor" : "homeowner";
      const s = await stripe("checkout/sessions", {
        mode: "payment",
        line_items: {
          0: {
            price: await priceId(input.kind === "contractor" ? PRO_YARD_LOOKUP : YARD_LOOKUP),
            quantity: 1,
          },
        },
        metadata: { job_id: jobId, kind: input.kind === "contractor" ? "contractor_yard" : "yard_unlock" },
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
        (s.metadata.kind === "yard_unlock" || s.metadata.kind === "contractor_yard");
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
