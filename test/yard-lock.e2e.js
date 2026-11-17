// The 500 ft rule: a paid yard nudged 365 ft stays unlocked; moved 730 ft it locks again.
const { chromium } = require("playwright-core");
const KEY = "headtohead.jobs.v1";
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
  const x = p.locator(".tour button");
  if (await x.count())
    await x
      .first()
      .click()
      .catch(() => {});
  const isLocked = () =>
    p
      .locator(".leaflet-container.locked")
      .count()
      .then((n) => n > 0);
  console.log("before paying, locked:", await isLocked());
  await p.click("#ul");
  await p.waitForTimeout(300);
  await p.click("#tu");
  await p.waitForTimeout(800);
  console.log("after paying, locked:", await isLocked());
  const id = await p.evaluate(
    (k) => JSON.parse(localStorage.getItem(k))[0].id,
    KEY,
  );
  const shift = async (dLat) => {
    await p.evaluate(
      ([k, d]) => {
        const jobs = JSON.parse(localStorage.getItem(k));
        for (const s of jobs[0].shapes) for (const pt of s.pts) pt.lat += d;
        localStorage.setItem(k, JSON.stringify(jobs));
      },
      [KEY, dLat],
    );
    await p.goto("http://localhost:8742/#/job/" + id);
    await p.reload();
    await p.waitForTimeout(2500);
    const h = p.locator('.tab[data-mode="heads"]');
    if (await h.count()) await h.first().click();
    await p.waitForTimeout(600);
  };
  await p.evaluate((k) => { const jobs = JSON.parse(localStorage.getItem(k)); delete jobs[0].base; localStorage.setItem(k, JSON.stringify(jobs)); }, KEY);
  await shift(0.001); // about 365 ft north
  console.log("moved ~365 ft, locked:", await isLocked());
  await shift(0.001); // about 730 ft from where it was paid for
  console.log("moved ~730 ft, locked:", await isLocked());
  // grid paper: back to the paid spot, then grow the lawns by 1.5x each way (2.25x the area)
  await p.evaluate((k) => {
    const jobs = JSON.parse(localStorage.getItem(k)); const j = jobs[0];
    j.base = "grid";
    for (const sh of j.shapes) for (const pt of sh.pts) pt.lat -= 0.002;
    localStorage.setItem(k, JSON.stringify(jobs));
  }, KEY);
  await shift(0);
  console.log("grid, same size, locked:", await isLocked());
  await p.evaluate((k) => {
    const jobs = JSON.parse(localStorage.getItem(k)); const j = jobs[0]; const c = j.paidAt;
    for (const sh of j.shapes) for (const pt of sh.pts) { pt.lat = c.lat + (pt.lat - c.lat) * 1.5; pt.lng = c.lng + (pt.lng - c.lng) * 1.5; }
    localStorage.setItem(k, JSON.stringify(jobs));
  }, KEY);
  await shift(0);
  console.log("grid, lawn 2.25x bigger, locked:", await isLocked());
  await p.click("#ul").catch(() => {});
  await p.waitForTimeout(500);
  console.log(
    "unlock sheet says:",
    (
      (await p
        .locator(".sheet .hint")
        .first()
        .textContent()
        .catch(() => "")) || ""
    ).slice(0, 120),
  );
  console.log("page errors:", errs.join(" / ") || "none");
  await b.close();
})();
