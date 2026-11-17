// Contractor plan, server side: a sandbox subscription carrying a company id should land in the
// billing table through the signed webhook, then show canceled when cancelled. Cleans up after.
// Also checks the billing function refuses a subscribe with no sign-in.
const SK = process.env.STRIPE_KEY,
  T = process.env.SUPA_TOKEN,
  ANON = process.env.ANON;
const REF = "vqgbtssybgaqietjbqms";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function stripe(path, data, method) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: method || (data ? "POST" : "GET"),
    headers: {
      Authorization: "Bearer " + SK,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: data ? new URLSearchParams(data) : undefined,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(path + ": " + j.error.message);
  return j;
}
async function sql(q) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + T,
        "Content-Type": "application/json",
        "User-Agent": "head-to-head-deploy",
      },
      body: JSON.stringify({ query: q }),
    },
  );
  return res.json();
}
// 1. no sign-in: refused
const r0 = await fetch(`https://${REF}.supabase.co/functions/v1/billing`, {
  method: "POST",
  headers: {
    apikey: ANON,
    Authorization: "Bearer " + ANON,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    action: "subscribe",
    company_id: "00000000-0000-0000-0000-000000000000",
  }),
});
console.log("subscribe with no sign-in:", r0.status, (await r0.json()).error);

// 2. unsigned webhook: refused
const r1 = await fetch(
  `https://${REF}.supabase.co/functions/v1/stripe-webhook`,
  {
    method: "POST",
    headers: {
      "stripe-signature": "t=1,v1=bad",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { metadata: { company_id: "x" } } },
    }),
  },
);
console.log("forged webhook:", r1.status, await r1.text());

// 3. real sandbox subscription -> billing row
const [co] = await sql(
  "select id, name from companies order by created_at limit 1",
);
const before = await sql(
  `select count(*)::int n from billing where company_id = '${co.id}'`,
);
if (before[0].n)
  throw new Error("this company already has a billing row; not touching it");
const cust = await stripe("customers", {
  name: "TEST " + co.name,
  payment_method: "pm_card_visa",
  "invoice_settings[default_payment_method]": "pm_card_visa",
  "metadata[test]": "1",
});
const price = (await stripe("prices?lookup_keys[]=founding_monthly")).data[0]
  .id;
const sub = await stripe("subscriptions", {
  customer: cust.id,
  "items[0][price]": price,
  "metadata[company_id]": co.id,
  "metadata[plan]": "founding",
});
console.log("sandbox subscription:", sub.status);
let row;
for (let i = 0; i < 15 && !(row && row.status === "active"); i++) {
  await sleep(2000);
  [row] = await sql(
    `select status, plan, current_period_end, cancel_at_period_end from billing where company_id = '${co.id}'`,
  );
}
console.log("billing row after subscribe:", JSON.stringify(row));
await stripe("subscriptions/" + sub.id, null, "DELETE");
for (let i = 0; i < 15 && !(row && row.status === "canceled"); i++) {
  await sleep(2000);
  [row] = await sql(`select status from billing where company_id = '${co.id}'`);
}
console.log("billing row after cancel:", JSON.stringify(row));
// clean up: the test row and the test customer
await sql(`delete from billing where company_id = '${co.id}'`);
await stripe("customers/" + cust.id, null, "DELETE");
const after = await sql(
  `select count(*)::int n from billing where company_id = '${co.id}'`,
);
console.log("cleaned up, billing rows left for this company:", after[0].n);
