// Stripe tells the server here when a contractor's plan starts, renews, fails or is cancelled
// (Zach picked Stripe 2026-11-16). Each message is signed with STRIPE_WEBHOOK_SECRET; anything
// unsigned or older than 5 minutes is refused, so nobody can mark a company paid by posting here.
// The function is deployed with JWT checks off, because Stripe has no Supabase session.
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const LIVE = ["active", "trialing", "past_due"];
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SITE = "https://headtoheadapp.com/";

// Zach 2026-11-18: once a homeowner's yard is paid, the plan goes to their email "in case they
// exit the page its not lost": the plan picture, the parts list, and a link that opens the yard
// again. Sent once; claiming emailed_at first means a retried message can't send it twice.
const escHtml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// security review 2026-11-18: the email is built from what the server controls. It goes to the
// address typed into Stripe's checkout, the subject is fixed, the yard's name and parts list stay
// out of it (the link opens both), and only a checked plan picture is attached.
async function sendYardCopy(token: string, sessionId: string, stripeEmail: string) {
  const headers = { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json" };
  const base = SUPABASE_URL + "/rest/v1/yard_copies?token=eq." + encodeURIComponent(token);
  const claim = await fetch(base + "&emailed_at=is.null", {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ paid: true, session_id: sessionId, emailed_at: new Date().toISOString() }),
  });
  if (!claim.ok) throw new Error("yard copy claim " + claim.status + " " + (await claim.text()));
  const rows = await claim.json();
  const row = rows[0];
  if (!row) return; // already emailed, or no such copy
  const address = String((row.job && row.job.address) || "")
    .replace(/[^A-Za-z0-9 .,#'\-\/]/g, "")
    .slice(0, 100)
    .trim();
  const link = SITE + "?yard=" + token;
  const to = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stripeEmail) ? stripeEmail : row.email;
  const text =
    "Thanks for unlocking " + (address ? "your yard at " + address : "your yard") + " on Head to Head.\n\n" +
    "Your sprinkler plan is attached. To open the yard again with every head, the plan and the parts list, use this link:\n" +
    link + "\n\nThe link also has your parts list. Anyone with this link can open your yard, so keep it to yourself.\n\n" +
    "Questions? Just reply to this email.\n\nHead to Head";
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1d2320;max-width:560px">' +
    "<p>Thanks for unlocking " + escHtml(address ? "your yard at " + address : "your yard") + " on Head to Head.</p>" +
    "<p>Your sprinkler plan is attached. To open the yard again with every head, the plan and the parts list, use this link:</p>" +
    '<p><a href="' + link + '" style="display:inline-block;background:#1d6e47;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Open my yard</a></p>' +
    '<p style="color:#5f6964;font-size:13px">The link also has your parts list. Anyone with this link can open your yard, so keep it to yourself.</p>' +
    "<p>Questions? Just reply to this email.</p><p>Head to Head</p></div>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Head to Head <noreply@headtoheadapp.com>",
      to: [to],
      reply_to: "zach@headtoheadapp.com",
      subject: "Your Head to Head sprinkler plan",
      text,
      html,
      attachments: row.plan_png ? [{ filename: "sprinkler-plan.png", content: row.plan_png }] : undefined,
    }),
  });
  if (!res.ok) {
    // let it go out again on Stripe's retry
    await fetch(base, { method: "PATCH", headers, body: JSON.stringify({ emailed_at: null }) });
    throw new Error("plan email " + res.status + " " + (await res.text()));
  }
}

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
async function stripe(path: string, body?: Record<string, string>, method = body ? "POST" : "GET", idem?: string) {
  const headers: Record<string, string> = {
    Authorization: "Bearer " + STRIPE_KEY,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idem) headers["Idempotency-Key"] = idem;
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers,
    body: body ? new URLSearchParams(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error("stripe " + path + " " + res.status + " " + (json.error && json.error.message));
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
  if (!res.ok) throw new Error("db " + path.split("?")[0] + " " + res.status + " " + (await res.text()));
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function priceOf(lookup: string) {
  const r = await stripe("prices?active=true&lookup_keys[]=" + encodeURIComponent(lookup));
  if (!r.data || !r.data.length) throw new Error("no price " + lookup);
  return r.data[0];
}

// newer Stripe versions moved the subscription id under parent.subscription_details
function invoiceSubscription(inv: Record<string, any>) {
  return inv.subscription ||
    (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription) ||
    null;
}

// Crew (Zach 2026-11-17): 5 people besides the owner are included, $5 a month each after that.
// The billing function keeps the plan's extra-crew line in step when people join; this runs the
// same count a few days before every renewal (invoice.upcoming), so someone who left is never
// billed for. Kept in step with syncCrew in the billing function.
const FREE_CREW = 5;
async function syncCrew(companyId: string, sub: Record<string, any>) {
  const rows = await db("members?select=user_id&role=eq.member&company_id=eq." + companyId);
  const extra = Math.max(0, (Array.isArray(rows) ? rows.length : 0) - FREE_CREW);
  const items = (sub.items && sub.items.data) || [];
  const isCrew = (it: Record<string, any>) =>
    !!(it.price && it.price.lookup_key && String(it.price.lookup_key).startsWith("extra_crew_"));
  const crewItem = items.find(isCrew);
  const planItem = items.find((it: Record<string, any>) => !isCrew(it));
  const yearly = !!(planItem && planItem.price && planItem.price.recurring &&
    planItem.price.recurring.interval === "year");
  if (extra > 0 && !crewItem)
    await stripe("subscription_items", {
      subscription: sub.id,
      price: (await priceOf(yearly ? "extra_crew_yearly" : "extra_crew_monthly")).id,
      quantity: String(extra),
    });
  else if (extra > 0 && crewItem.quantity !== extra)
    await stripe("subscription_items/" + crewItem.id, { quantity: String(extra) });
  else if (extra === 0 && crewItem)
    await stripe("subscription_items/" + crewItem.id, undefined, "DELETE");
}

// Referrals (Zach 2026-11-17): the company whose code was used gets one free month, only after the
// new contractor's second payment goes through ("lets say they get the free month after the second
// payment"; it was the first until a fake company paying once and cancelling was raised). The free month is credit on the referrer's Stripe
// customer worth one month of their plan (founding $15, standard $20), so it comes off their next
// bill and several stack. A referrer with no plan yet keeps the credit for when they start one.
// Security review 2026-11-17: one person owning two companies could refer themselves, pay for
// the second company's first month and collect a free month on the first. So no reward when the
// first payment wasn't real money, or the two companies share an owner, any person or email, or a
// card. Cards are every card on the customer plus every card that ever paid a charge.
// Bank accounts carry a fingerprint too, so they're compared the same way. Every page is read.
async function cardsOf(customer: string) {
  // a payment method of any kind with no fingerprint (Link, a wallet) can't be compared, so it
  // marks the whole customer unknown and blocks the free month (security review 2026-11-17)
  const out = new Set<string>();
  const fp = (d: Record<string, any> | undefined) => {
    if (!d) return;
    const t = d.type;
    const f = t && d[t] && d[t].fingerprint;
    if (f) out.add(t + ":" + f);
    else out.add("unknown");
  };
  const all = async (path: string, each: (o: Record<string, any>) => void) => {
    let after = "";
    for (let page = 0; page < 50; page++) {
      const r = await stripe(path + (after ? "&starting_after=" + after : ""));
      (r.data || []).forEach(each);
      if (!r.has_more || !r.data || !r.data.length) break;
      after = r.data[r.data.length - 1].id;
    }
  };
  await all("customers/" + customer + "/payment_methods?limit=100", fp);
  await all("charges?limit=100&customer=" + customer, (c) => fp(c.payment_method_details));
  return out;
}

async function samePeople(companyId: string, referrerId: string) {
  const cos = await db("companies?select=id,owner_id&id=in.(" + companyId + "," + referrerId + ")");
  if (!Array.isArray(cos) || cos.length !== 2 || cos[0].owner_id === cos[1].owner_id) return "same owner";
  const people = await db("members?select=company_id,user_id,email&company_id=in.(" + companyId + "," + referrerId + ")");
  const side = (id: string, k: string) =>
    new Set((people || []).filter((m: Record<string, string>) => m.company_id === id)
      .map((m: Record<string, string>) => String(m[k] || "").trim().toLowerCase()));
  for (const k of ["user_id", "email"]) {
    const a = side(companyId, k), b = side(referrerId, k);
    for (const v of a) if (v && b.has(v)) return "shared " + k;
  }
  return null;
}

async function referrerBilling(referrerId: string) {
  const rows = await db("billing?select=stripe_customer_id,plan,status&company_id=eq." + referrerId);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// one month of the referrer's plan as credit; the same key twice (Stripe resending) credits once
async function credit(referrerId: string, companyId: string, bill: Record<string, any>) {
  const month = await priceOf((bill.plan === "standard" ? "standard" : "founding") + "_monthly");
  await stripe("customers/" + bill.stripe_customer_id + "/balance_transactions", {
    amount: String(-month.unit_amount),
    currency: "usd",
    description: "Free month: a contractor you referred started their plan",
    "metadata[referred_company]": companyId,
  }, "POST", "referral-" + companyId);
}

// invoices on this subscription that took real money (the referral's $5-off first one counts)
async function paidInvoices(subId: string) {
  let n = 0, after = "";
  for (let page = 0; page < 20; page++) {
    const r = await stripe("invoices?status=paid&limit=100&subscription=" + subId + (after ? "&starting_after=" + after : ""));
    n += (r.data || []).filter((i: Record<string, any>) => i.amount_paid > 0).length;
    if (!r.has_more || !r.data || !r.data.length) break;
    after = r.data[r.data.length - 1].id;
  }
  return n;
}

const saveReferral = (row: Record<string, unknown>) =>
  db("referrals?on_conflict=company_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });

// Referred company's first payment. A referrer on a live plan with a card is checked and credited
// now; any other referrer's free month is held until their own plan's first payment.
async function rewardReferrer(companyId: string, referrerId: string, inv: Record<string, any>) {
  const done = await db("referrals?select=company_id&company_id=eq." + companyId);
  if (Array.isArray(done) && done.length) return;
  const ref = await db("companies?select=id&id=eq." + referrerId);
  if (!Array.isArray(ref) || !ref.length) return; // the referrer deleted their account
  const base = { company_id: companyId, referrer_id: referrerId };
  const why = !(inv.amount_paid > 0) ? "nothing paid" : await samePeople(companyId, referrerId);
  if (why) {
    console.warn("referral not rewarded: " + why);
    await saveReferral(base); // no rewarded_at and not held: never rewarded, never retried
    return;
  }
  const paidWith = await cardsOf(String(inv.customer));
  // fail closed: a payment that can't be matched to a card or bank account earns nothing
  if (!paidWith.size || paidWith.has("unknown")) {
    console.warn("referral not rewarded: payer can't be identified");
    await saveReferral(base);
    return;
  }
  const bill = await referrerBilling(referrerId);
  const theirs = bill && bill.stripe_customer_id && LIVE.includes(bill.status)
    ? await cardsOf(bill.stripe_customer_id)
    : new Set<string>();
  if (!theirs.size) {
    await saveReferral({ ...base, held: true, referred_cards: [...paidWith] });
    return;
  }
  for (const f of paidWith) if (theirs.has(f) || theirs.has("unknown")) {
    console.warn("referral not rewarded: same card");
    await saveReferral(base);
    return;
  }
  await credit(referrerId, companyId, bill);
  await saveReferral({ ...base, rewarded_at: new Date().toISOString() });
}

// A company paid on its own plan: release any free months it was holding as a referrer, unless a
// card it has used also paid for the company it referred.
async function releaseHeld(referrerId: string) {
  const held = await db("referrals?select=company_id,referred_cards&held=is.true&referrer_id=eq." + referrerId);
  if (!Array.isArray(held) || !held.length) return;
  const bill = await referrerBilling(referrerId);
  if (!bill || !bill.stripe_customer_id || !LIVE.includes(bill.status)) return;
  const theirs = await cardsOf(bill.stripe_customer_id);
  if (!theirs.size) return;
  for (const r of held) {
    const clash = theirs.has("unknown") || (r.referred_cards || []).some((f: string) => theirs.has(f));
    if (clash) console.warn("held referral not rewarded: same card");
    else await credit(referrerId, r.company_id, bill);
    await db("referrals?company_id=eq." + r.company_id, {
      method: "PATCH",
      body: JSON.stringify(clash ? { held: false } : { held: false, rewarded_at: new Date().toISOString() }),
    });
  }
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
      event.type === "checkout.session.completed" &&
      obj.metadata && obj.metadata.copy &&
      obj.payment_status === "paid"
    ) {
      await sendYardCopy(
        String(obj.metadata.copy),
        String(obj.id),
        String((obj.customer_details && obj.customer_details.email) || "").trim().toLowerCase(),
      );
      return new Response("ok", { status: 200 });
    }
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
      }).then(async (r) => {
        // a failed lookup throws, so Stripe retries; only a real empty answer means "gone"
        if (!r.ok) throw new Error("company lookup " + r.status);
        return r.json();
      });
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
    if (event.type === "invoice.paid" || event.type === "invoice.upcoming") {
      const subId = invoiceSubscription(obj);
      if (!subId) return new Response("no subscription", { status: 200 });
      const sub = await freshSubscription(String(subId));
      const companyId = sub.metadata && sub.metadata.company_id;
      if (!companyId || !UUID.test(companyId)) return new Response("no company", { status: 200 });
      const co = await db("companies?select=id&id=eq." + companyId);
      if (!Array.isArray(co) || !co.length) return new Response("company gone", { status: 200 });
      if (event.type === "invoice.upcoming") await syncCrew(companyId, sub);
      // saveBilling may not have run yet for a brand new plan, so make sure it's on file first
      if (event.type === "invoice.paid" && obj.amount_paid > 0) {
        const cur = await currentBilling(companyId);
        if (!cur || !cur.subscription_id || cur.subscription_id === sub.id)
          await saveBilling({ company_id: companyId, stripe_customer_id: sub.customer, subscription_id: sub.id, status: sub.status });
        await releaseHeld(companyId);
      }
      const referrer = sub.metadata.referrer;
      if (event.type === "invoice.paid" && obj.amount_paid > 0 &&
        referrer && UUID.test(referrer) && referrer !== companyId &&
        (await paidInvoices(sub.id)) >= 2)
        await rewardReferrer(companyId, referrer, obj);
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error(e);
    // a 500 makes Stripe send it again later
    return new Response("error", { status: 500 });
  }
});
