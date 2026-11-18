// Points Stripe's subscription events at the stripe-webhook function and sets up the billing
// portal (manage card, cancel). Prints the webhook signing secret to stdout only when asked to
// create a new endpoint, for piping straight into the keychain. Key from STRIPE_KEY.
const k = process.env.STRIPE_KEY;
const URL_HOOK =
  "https://vqgbtssybgaqietjbqms.supabase.co/functions/v1/stripe-webhook";
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
const mode = process.argv[2];
if (mode === "hook") {
  const existing = (await api("webhook_endpoints?limit=100")).data.filter(
    (w) => w.url === URL_HOOK,
  );
  if (existing.length) {
    console.error(
      "webhook already exists:",
      existing.map((w) => w.id).join(", "),
      "(secret only shown at creation)",
    );
    process.exit(2);
  }
  const events = [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    // referral reward after the first payment, and the crew recount before each renewal
    "invoice.paid",
    "invoice.upcoming",
  ];
  const d = { url: URL_HOOK, description: "Head to Head plan status" };
  events.forEach((e, i) => (d["enabled_events[" + i + "]"] = e));
  const w = await api("webhook_endpoints", d);
  console.error("webhook created", w.id);
  process.stdout.write(w.secret);
} else if (mode === "portal") {
  const prods = (await api("products?active=true&limit=100")).data;
  const plan = prods.find((p) => p.name === "Head to Head contractor plan");
  const prices = (
    await api("prices?active=true&limit=100&product=" + plan.id)
  ).data.map((p) => p.id);
  const d = {
    "business_profile[headline]": "Head to Head: manage your plan",
    "features[payment_method_update][enabled]": "true",
    "features[invoice_history][enabled]": "true",
    "features[subscription_cancel][enabled]": "true",
    "features[subscription_cancel][mode]": "at_period_end",
    "features[customer_update][enabled]": "true",
    "features[customer_update][allowed_updates][0]": "email",
    "features[customer_update][allowed_updates][1]": "name",
    default_return_url: "https://headtoheadapp.com/",
  };
  const cfgs = (await api("billing_portal/configurations?limit=10")).data;
  const def = cfgs.find((c) => c.is_default);
  const c = def
    ? await api("billing_portal/configurations/" + def.id, d)
    : await api("billing_portal/configurations", d);
  console.log(
    "portal config",
    c.id,
    "default",
    c.is_default,
    "plan prices",
    prices.length,
  );
}
