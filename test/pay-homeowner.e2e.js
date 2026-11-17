// End-to-end homeowner unlock against the Stripe sandbox: example yard -> Pay $10 -> Stripe's
// checkout with the 4242 test card -> back to the site -> server confirms -> yard unlocked.
const { chromium } = require("playwright-core");
(async () => {
  const b = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const p = await b.newPage({
    viewport: { width: 1200, height: 900 },
    reducedMotion: "reduce",
  });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => {
    if (!localStorage.getItem("headtohead.prefs.v1"))
      localStorage.setItem(
        "headtohead.prefs.v1",
        JSON.stringify({ homeowner: true, toured: true }),
      );
  });
  await p.goto("http://localhost:8742/");
  await p.waitForTimeout(1500);
  if (await p.locator("#example").count()) await p.click("#example");
  await p.waitForTimeout(2500);
  const close = p.locator(".tour button");
  if (await close.count())
    await close
      .first()
      .click()
      .catch(() => {});
  await p.click("#ul");
  await p.waitForTimeout(400);
  await p.click("#pay");
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
  console.log("on Stripe checkout:", new URL(p.url()).host);
  await p.waitForTimeout(3000);
  await p.waitForTimeout(3000);
  const f = p.frames().find((x) => /elements-inner/.test(x.url()) && x.url().includes("habanero")) ||
    p.frames().find((x) => /elements-inner/.test(x.url()));
  await f.fill("#paymentForm-emailInput", "test@example.com");
  await f.fill("#payment-numberInput", "4242424242424242");
  await f.fill("#payment-expiryInput", "12 / 34");
  await f.fill("#payment-cvcInput", "123");
  await f.fill("#payment-nameInput", "Test Homeowner");
  await f.fill("#payment-postalCodeInput", "84041");
  await p.screenshot({ path: __dirname + "/stripe-form.png" });
  const pay = p.getByRole("button", { name: /^Pay/ });
  if (await pay.count()) await pay.last().click();
  else await f.getByRole("button", { name: /^Pay/ }).last().click();
  await p.waitForURL(/localhost:8742/, { timeout: 60000 });
  console.log(
    "back on site:",
    p.url().replace(/unlock=[^&]+/, "unlock=<session>"),
  );
  await p.waitForTimeout(4000);
  const toast = await p
    .locator(".toast")
    .allTextContents()
    .catch(() => []);
  const unlocked = await p.evaluate(() => {
    const jobs = JSON.parse(
      localStorage.getItem("headtohead.jobs.v1") ||
        localStorage.getItem("headtohead.jobs") ||
        "[]",
    );
    return jobs.map(
      (j) => j.name + ": " + (j.unlocked ? "unlocked" : "locked"),
    );
  });
  console.log("toast:", toast.join(" | ") || "(gone)");
  console.log("jobs:", unlocked.join(", "));
  console.log(
    "map still blurred:",
    (await p.locator(".leaflet-container.locked").count()) > 0,
  );
  await p.screenshot({ path: __dirname + "/after-pay.png" });
  console.log("page errors:", errs.join(" / ") || "none");
  await b.close();
})();
