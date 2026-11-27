// Throwaway account: owner can open plan checkout, deactivate refuses with no plan, delete
// account removes the sign-in, the company and its jobs. Uses a made-up test address.
const REF = "vqgbtssybgaqietjbqms",
  BASE = `https://${REF}.supabase.co`;
const T = process.env.SUPA_TOKEN,
  ANON = process.env.ANON;
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

// leftovers from an earlier run: test companies, then the test sign-ins (only made-up h2h-test addresses)
const old = await sql("select u.id from auth.users u where u.email like 'h2h-test-%@example.com'");
for (const o of old) {
  await sql(`delete from companies where owner_id = '${o.id}'`);
  await fetch(BASE + "/auth/v1/admin/users/" + o.id, { method: "DELETE", headers: { apikey: SRK, Authorization: "Bearer " + SRK } });
}
console.log("old test accounts cleared:", old.length);
const email = "h2h-test-" + Date.now() + "@example.com";
const pw = "Test-" + Math.random().toString(36).slice(2) + "-9aZ";
let r = await fetch(BASE + "/auth/v1/admin/users", {
  method: "POST",
  headers: {
    apikey: SRK,
    Authorization: "Bearer " + SRK,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email, password: pw, email_confirm: true }),
});
const user = await r.json();
console.log("test user made:", r.status);
r = await fetch(BASE + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: pw }),
});
const tok = (await r.json()).access_token;
if (!tok) {
  console.log("password sign-in refused:", r.status);
}
const as = {
  apikey: ANON,
  Authorization: "Bearer " + tok,
  "Content-Type": "application/json",
};
r = await fetch(BASE + "/rest/v1/rpc/create_company", {
  method: "POST",
  headers: as,
  body: JSON.stringify({ company_name: "Test Sprinkler Co" }),
});
const cid = await r.json();
console.log("company made:", r.status);
r = await fetch(BASE + "/rest/v1/jobs", {
  method: "POST",
  headers: as,
  body: JSON.stringify({
    id: "testjob42",
    company_id: cid,
    data: { name: "Test yard" },
  }),
});
console.log("job saved:", r.status);

const call = async (body) => {
  const res = await fetch(BASE + "/functions/v1/billing", {
    method: "POST",
    headers: { ...as, Origin: "http://localhost:8742" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  return (
    res.status +
    " " +
    (j.url
      ? "checkout url " + new URL(j.url).host
      : j.error || JSON.stringify(j))
  );
};
console.log(
  "owner opens monthly checkout:",
  await call({ action: "subscribe", company_id: cid, interval: "month" }),
);
console.log(
  "owner opens yearly checkout:",
  await call({ action: "subscribe", company_id: cid, interval: "year" }),
);
console.log(
  "contractor $10 yard checkout:",
  await call({ action: "unlock", job_id: "testjob42", kind: "contractor" }),
);
// the price follows who's asking: a signed-in contractor asking for the homeowner price still pays $10
{
  const res = await fetch(BASE + "/functions/v1/billing", { method: "POST", headers: { ...as, Origin: "http://localhost:8742" }, body: JSON.stringify({ action: "unlock", job_id: "testjob42", kind: "homeowner" }) });
  const j = await res.json();
  const sid = (j.url.match(/(cs_test_[A-Za-z0-9]+)/) || [])[1];
  const sess = await (await fetch("https://api.stripe.com/v1/checkout/sessions/" + sid, { headers: { Authorization: "Bearer " + process.env.STRIPE_KEY } })).json();
  console.log("contractor asking for the $10 price is charged:", "$" + sess.amount_total / 100);
}
console.log(
  "deactivate with no plan:",
  await call({ action: "cancel", company_id: cid }),
);
// an active sandbox plan for this company, then deactivate it
const SK = process.env.STRIPE_KEY;
const st = async (path, data, method) => (await fetch("https://api.stripe.com/v1/" + path, { method: method || (data ? "POST" : "GET"), headers: { Authorization: "Bearer " + SK, "Content-Type": "application/x-www-form-urlencoded" }, body: data ? new URLSearchParams(data) : undefined })).json();
const cust = await st("customers", { name: "TEST deactivate", payment_method: "pm_card_visa", "invoice_settings[default_payment_method]": "pm_card_visa" });
const price = (await st("prices?lookup_keys[]=founding_monthly")).data[0].id;
const sub = await st("subscriptions", { customer: cust.id, "items[0][price]": price, "metadata[company_id]": cid, "metadata[plan]": "founding" });
let row;
for (let i = 0; i < 15 && !(row && row.status === "active"); i++) { await new Promise((r) => setTimeout(r, 2000)); [row] = await sql(`select status, cancel_at_period_end from billing where company_id='${cid}'`); }
console.log("plan active:", JSON.stringify(row));
console.log("deactivate:", await call({ action: "cancel", company_id: cid }));
for (let i = 0; i < 15 && !(row && row.cancel_at_period_end); i++) { await new Promise((r) => setTimeout(r, 2000)); [row] = await sql(`select status, cancel_at_period_end from billing where company_id='${cid}'`); }
console.log("after deactivate (still active until period end):", JSON.stringify(row));
console.log("delete account:", await call({ action: "delete-account" }));
console.log("Stripe plan after delete:", (await st("subscriptions/" + sub.id)).status);
await st("customers/" + cust.id, null, "DELETE");
const left = await sql(
  `select (select count(*) from companies where id='${cid}')::int companies, (select count(*) from jobs where company_id='${cid}')::int jobs, (select count(*) from members where company_id='${cid}')::int members, (select count(*) from billing where company_id='${cid}')::int billing, (select count(*) from auth.users where id='${user.id}')::int users`,
);
console.log("left behind:", JSON.stringify(left[0]));
// the Stripe customer the checkout made is a sandbox leftover; remove it
