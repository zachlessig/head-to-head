// Creates Head to Head's products and prices in the Stripe sandbox. Safe to run again: existing
// lookup keys are left alone. Key comes from the STRIPE_KEY env var, never printed.
const k = process.env.STRIPE_KEY;
async function api(path, data) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: data ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + k,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: data ? new URLSearchParams(data) : undefined,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(path + ": " + (j.error && j.error.message));
  return j;
}
const acct = await api("account");
console.log(
  "account:",
  (acct.settings &&
    acct.settings.dashboard &&
    acct.settings.dashboard.display_name) ||
    acct.id,
);
const prices = (await api("prices?active=true&limit=100")).data;
const existing = Object.fromEntries(
  prices.filter((p) => p.lookup_key).map((p) => [p.lookup_key, p]),
);
console.log(
  "existing lookup keys:",
  Object.keys(existing).join(", ") || "none",
);
async function product(name, description) {
  const r = await api(
    "products/search?" + new URLSearchParams({ query: `name:'${name}'` }),
  );
  if (r.data.length) return r.data[0].id;
  return (await api("products", { name, description })).id;
}
const plan = await product(
  "Head to Head contractor plan",
  "Sprinkler layouts, plans and parts lists for your whole crew.",
);
const yard = await product(
  "Head to Head yard unlock",
  "Every head, a printable plan and the parts list for one yard.",
);
// Zach 2026-11-17: 5 crew included, "$5 more a month" each after; $60 a year on a yearly plan,
// since every line on one subscription bills on the same schedule
const crew = await product(
  "Head to Head extra crew",
  "Each crew member past the 5 that come with the plan.",
);
const want = [
  ["extra_crew_monthly", crew, 500, true, "Extra crew member"],
  ["extra_crew_yearly", crew, 6000, "year", "Extra crew member, yearly"],
  // Zach 2026-11-27: founding $15, standard $20, a yard $10
  ["founding_monthly", plan, 1500, true, "Founding contractor"],
  ["standard_monthly", plan, 2000, true, "Contractor"],
  ["yard_unlock", yard, 1000, false, "One yard"],
  ["founding_yearly", plan, 20000, "year", "Founding contractor, yearly"],
  ["standard_yearly", plan, 25000, "year", "Contractor, yearly"],
  ["contractor_yard", yard, 1000, false, "One yard, contractor"],
];
for (const [lookup_key, product_id, cents, recurring, nickname] of want) {
  const old = existing[lookup_key];
  if (old && old.unit_amount === cents) {
    console.log(lookup_key, "already at $" + cents / 100);
    continue;
  }
  const d = {
    product: product_id,
    unit_amount: cents,
    currency: "usd",
    lookup_key,
    nickname,
  };
  // a new amount is a new price that takes over the lookup key; plans already on the old price
  // keep it (that's how founders keep theirs), and the old one stops being offered
  if (old) d.transfer_lookup_key = "true";
  if (recurring) d["recurring[interval]"] = recurring === "year" ? "year" : "month";
  const p = await api("prices", d);
  if (old) await api("prices/" + old.id, { active: "false" });
  console.log(
    lookup_key,
    (old ? "changed from $" + old.unit_amount / 100 + " to $" : "created at $") +
      p.unit_amount / 100,
    recurring ? (recurring === "year" ? "a year" : "a month") : "once",
  );
}

// Referral (Zach 2026-11-17): $5 off the new contractor's first payment
const coupon = await api("coupons/referral_5_off").catch(() => null);
if (coupon) console.log("coupon referral_5_off already exists");
else {
  await api("coupons", {
    id: "referral_5_off",
    name: "Referral: $5 off your first month",
    amount_off: 500,
    currency: "usd",
    duration: "once",
  });
  console.log("coupon referral_5_off created");
}
