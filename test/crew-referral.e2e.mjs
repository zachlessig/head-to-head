// Crew and referrals against the Stripe sandbox and the live Supabase project (Zach 2026-11-17):
// 5 crew included, $5 a month each after; a referral code takes $5 off the new contractor's first
// month and gives the referrer a free month after that first payment. Throwaway h2h-test accounts
// only; everything it makes is deleted at the end. Env: SUPA_TOKEN, ANON, STRIPE_KEY.
const REF = "vqgbtssybgaqietjbqms",
  BASE = `https://${REF}.supabase.co`;
const T = process.env.SUPA_TOKEN,
  ANON = process.env.ANON,
  SK = process.env.STRIPE_KEY;
const H = { Authorization: "Bearer " + T, "User-Agent": "head-to-head-deploy" };
const keys = await (
  await fetch(
    `https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`,
    { headers: H },
  )
).json();
const SRK = keys.find((k) => k.name === "service_role").api_key;
const sql = async (q) =>
  (
    await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    })
  ).json();
const stripe = async (path, body, method = body ? "POST" : "GET") => {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: {
      Authorization: "Bearer " + SK,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(path + ": " + (j.error && j.error.message));
  return j;
};
let fails = 0;
const check = (ok, what) => {
  console.log((ok ? "PASS " : "FAIL ") + what);
  if (!ok) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clearOld() {
  const old = await sql(
    "select u.id from auth.users u where u.email like 'h2h-test-%@example.com'",
  );
  for (const o of old) {
    await sql(`delete from companies where owner_id = '${o.id}'`);
    await fetch(BASE + "/auth/v1/admin/users/" + o.id, {
      method: "DELETE",
      headers: { apikey: SRK, Authorization: "Bearer " + SRK },
    });
  }
  return old.length;
}
console.log("old test accounts cleared:", await clearOld());

const stamp = Date.now();
async function person(tag) {
  const email = `h2h-test-${tag}-${stamp}@example.com`;
  const pw = "Test-" + Math.random().toString(36).slice(2) + "-9aZ";
  await fetch(BASE + "/auth/v1/admin/users", {
    method: "POST",
    headers: {
      apikey: SRK,
      Authorization: "Bearer " + SRK,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: pw, email_confirm: true }),
  });
  const r = await fetch(BASE + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  const tok = (await r.json()).access_token;
  return {
    email,
    as: {
      apikey: ANON,
      Authorization: "Bearer " + tok,
      "Content-Type": "application/json",
    },
  };
}
const rest = async (who, path, init = {}) => {
  const r = await fetch(BASE + "/rest/v1/" + path, {
    ...init,
    headers: { ...who.as, ...(init.headers || {}) },
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};
const billing = async (who, body) => {
  const r = await fetch(BASE + "/functions/v1/billing", {
    method: "POST",
    headers: { ...who.as, Origin: "http://localhost:8742" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const made = { customers: [], subs: [] };
try {
  // A shares a code; B is the new contractor with 6 crew
  const a = await person("ref"),
    b = await person("new");
  const aid = (
    await rest(a, "rpc/create_company", {
      method: "POST",
      body: JSON.stringify({ company_name: "Test Referrer Co" }),
    })
  ).body;
  const bid = (
    await rest(b, "rpc/create_company", {
      method: "POST",
      body: JSON.stringify({ company_name: "Test New Co" }),
    })
  ).body;
  const code = (await rest(a, "companies?select=referral_code&id=eq." + aid))
    .body[0].referral_code;
  check(
    /^[A-Z2-9]{8}$/.test(code),
    "a new company gets an 8 character referral code (" +
      code.length +
      " chars)",
  );

  for (let i = 0; i < 6; i++) {
    const c = await person("crew" + i);
    const me = await (
      await fetch(BASE + "/auth/v1/user", { headers: b.as })
    ).json();
    await rest(b, "invites", {
      method: "POST",
      body: JSON.stringify({
        company_id: bid,
        email: c.email,
        invited_by: me.id,
      }),
    });
    const iv = (await rest(c, "rpc/my_invites", { method: "POST", body: "{}" }))
      .body;
    await rest(c, "rpc/accept_invite", {
      method: "POST",
      body: JSON.stringify({ invite_id: iv[0].id }),
    });
  }
  const s0 = await billing(b, { action: "crew-sync", company_id: bid });
  check(
    s0.status === 200 &&
      s0.body.crew === 6 &&
      s0.body.extra === 1 &&
      s0.body.billed === false,
    "6 crew counted, 1 extra, nothing billed before a plan: " +
      JSON.stringify(s0.body),
  );
  const outsider = await billing(a, { action: "crew-sync", company_id: bid });
  check(
    outsider.status === 403,
    "another company can't recount this one (" + outsider.status + ")",
  );

  // bad codes
  const own = await billing(b, {
    action: "subscribe",
    company_id: bid,
    referral_code: (
      await rest(b, "companies?select=referral_code&id=eq." + bid)
    ).body[0].referral_code,
  });
  check(own.status === 400, "own code refused: " + own.body.error);
  const bad = await billing(b, {
    action: "subscribe",
    company_id: bid,
    referral_code: "ZZZZ2222",
  });
  check(bad.status === 400, "unknown code refused: " + bad.body.error);

  // checkout with the code: plan line, 1 extra crew line, $5 coupon
  const ok = await billing(b, {
    action: "subscribe",
    company_id: bid,
    referral_code: code.toLowerCase(),
  });
  check(
    ok.status === 200 && /checkout\.stripe\.com/.test(ok.body.url || ""),
    "checkout opens with a lowercase code",
  );
  const sid = (
    await sql(
      `select pending_checkout from billing where company_id = '${bid}'`,
    )
  )[0].pending_checkout;
  const sess = await stripe(
    "checkout/sessions/" + sid + "?expand[]=line_items&expand[]=discounts",
  );
  const lines = sess.line_items.data
    .map((l) => l.price.lookup_key + "x" + l.quantity)
    .sort();
  check(
    JSON.stringify(lines) ===
      JSON.stringify(["extra_crew_monthlyx1", "founding_monthlyx1"]),
    "checkout lines: " + lines.join(", "),
  );
  check(
    sess.amount_total === 2000 + 500 - 500,
    "first month total $" +
      sess.amount_total / 100 +
      " ($20 + $5 crew - $5 referral)",
  );
  check(
    sess.metadata && sess.metadata.company_id === bid,
    "checkout knows the company",
  );
  await stripe("checkout/sessions/" + sid + "/expire", {});

  // Stand in for the checkout page: the same subscription it would make, paid with Stripe's test card
  const cust = (
    await sql(
      `select stripe_customer_id from billing where company_id = '${bid}'`,
    )
  )[0].stripe_customer_id;
  made.customers.push(cust);
  const pm = await stripe("payment_methods/pm_card_visa/attach", {
    customer: cust,
  });
  await stripe("customers/" + cust, {
    "invoice_settings[default_payment_method]": pm.id,
  });
  const price = async (k) =>
    (await stripe("prices?active=true&lookup_keys[]=" + k)).data[0].id;
  const sub = await stripe("subscriptions", {
    customer: cust,
    "items[0][price]": await price("founding_monthly"),
    "items[1][price]": await price("extra_crew_monthly"),
    "items[1][quantity]": "1",
    "discounts[0][coupon]": "referral_5_off",
    "metadata[company_id]": bid,
    "metadata[plan]": "founding",
    "metadata[referrer]": aid,
  });
  made.subs.push(sub.id);
  check(sub.status === "active", "test subscription active");

  // the webhook should record B's plan and credit A a free month
  let ref = [],
    bal = null;
  for (let i = 0; i < 20 && !ref.length; i++) {
    await sleep(3000);
    ref = await sql(
      `select rewarded_at from referrals where company_id = '${bid}' and referrer_id = '${aid}' and rewarded_at is not null`,
    );
  }
  check(
    ref.length === 1,
    "referral recorded as rewarded after the first payment",
  );
  const acust = (
    await sql(
      `select stripe_customer_id from billing where company_id = '${aid}'`,
    )
  )[0];
  if (acust && acust.stripe_customer_id) {
    made.customers.push(acust.stripe_customer_id);
    bal = (await stripe("customers/" + acust.stripe_customer_id)).balance;
  }
  check(
    bal === -2000,
    "referrer (no plan yet) holds a $20 free month as credit: balance " + bal,
  );
  const bb = (
    await sql(`select status from billing where company_id = '${bid}'`)
  )[0];
  check(bb && bb.status === "active", "new contractor's plan saved as active");
  const again = await billing(b, {
    action: "subscribe",
    company_id: bid,
    referral_code: code,
  });
  check(
    again.status === 409 || again.status === 400,
    "no second plan or second referral (" + again.status + ")",
  );

  // someone leaves: 5 crew, the extra line comes off
  const one = (
    await sql(
      `select user_id from members where company_id = '${bid}' and role = 'member' limit 1`,
    )
  )[0].user_id;
  await rest(b, `members?company_id=eq.${bid}&user_id=eq.${one}`, {
    method: "DELETE",
  });
  const s1 = await billing(b, { action: "crew-sync", company_id: bid });
  check(
    s1.body.crew === 5 && s1.body.extra === 0 && s1.body.billed,
    "after one leaves: " + JSON.stringify(s1.body),
  );
  let items = (await stripe("subscriptions/" + sub.id)).items.data.map(
    (i) => i.price.lookup_key,
  );
  check(
    !items.includes("extra_crew_monthly"),
    "extra crew line removed: " + items.join(", "),
  );

  // two join back: 7 crew, extra line at 2
  for (let i = 0; i < 2; i++) {
    const c = await person("crewb" + i);
    const me = await (
      await fetch(BASE + "/auth/v1/user", { headers: b.as })
    ).json();
    await rest(b, "invites", {
      method: "POST",
      body: JSON.stringify({
        company_id: bid,
        email: c.email,
        invited_by: me.id,
      }),
    });
    const iv = (await rest(c, "rpc/my_invites", { method: "POST", body: "{}" }))
      .body;
    await rest(c, "rpc/accept_invite", {
      method: "POST",
      body: JSON.stringify({ invite_id: iv[0].id }),
    });
  }
  const s2 = await billing(b, { action: "crew-sync", company_id: bid });
  items = (await stripe("subscriptions/" + sub.id)).items.data.map(
    (i) => i.price.lookup_key + "x" + i.quantity,
  );
  check(
    s2.body.extra === 2 && items.includes("extra_crew_monthlyx2"),
    "7 crew bills 2 extra: " + items.join(", "),
  );

  // self-referral (security review 2026-11-17): the referrer's own second company is refused at
  // checkout, and a different sign-in paying with the referrer's card gets no free month
  const a2 = (await rest(a, "rpc/create_company", { method: "POST", body: JSON.stringify({ company_name: "Test Referrer Two" }) })).body;
  const selfTry = await billing(a, { action: "subscribe", company_id: a2, referral_code: code });
  check(selfTry.status === 400, "referrer's own second company refused: " + selfTry.body.error);
  const acus = (await sql(`select stripe_customer_id from billing where company_id = '${aid}'`))[0].stripe_customer_id;
  await stripe("payment_methods/pm_card_visa/attach", { customer: acus });
  const d = await person("same-card");
  const did = (await rest(d, "rpc/create_company", { method: "POST", body: JSON.stringify({ company_name: "Test Same Card" }) })).body;
  const dcust = await stripe("customers", { "metadata[company_id]": did });
  made.customers.push(dcust.id);
  const dpm = await stripe("payment_methods/pm_card_visa/attach", { customer: dcust.id });
  await stripe("customers/" + dcust.id, { "invoice_settings[default_payment_method]": dpm.id });
  const dsub = await stripe("subscriptions", {
    customer: dcust.id,
    "items[0][price]": (await stripe("prices?active=true&lookup_keys[]=founding_monthly")).data[0].id,
    "discounts[0][coupon]": "referral_5_off",
    "metadata[company_id]": did,
    "metadata[plan]": "founding",
    "metadata[referrer]": aid,
  });
  made.subs.push(dsub.id);
  let drow = [];
  for (let i = 0; i < 20 && !drow.length; i++) {
    await sleep(3000);
    drow = await sql(`select rewarded_at from referrals where company_id = '${did}'`);
  }
  check(drow.length === 1 && drow[0].rewarded_at === null, "same card: referral recorded but not rewarded");
  const bal2 = (await stripe("customers/" + acus)).balance;
  check(bal2 === -2000, "referrer still has just the one free month: balance " + bal2);
} catch (e) {
  console.log("FAIL error:", e.message);
  fails++;
} finally {
  for (const s of made.subs)
    await stripe("subscriptions/" + s, undefined, "DELETE").catch(() => null);
  for (const c of made.customers)
    await stripe("customers/" + c, undefined, "DELETE").catch(() => null);
  console.log("cleaned up:", await clearOld(), "test accounts");
}
console.log(fails ? fails + " failing" : "all passing");
process.exit(fails ? 1 : 0);
