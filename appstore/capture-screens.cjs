const { chromium } = require("playwright-core");
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await b.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto("https://headtoheadapp.com/?r=" + Date.now(), { waitUntil: "networkidle" });
  await p.fill("#em", "appreview@headtoheadapp.com");
  await p.locator("#em").press("Enter");
  await p.waitForTimeout(1200);
  await p.fill("#cd", process.env.PW);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForTimeout(5000);
  const skip = p.locator(".tour-skip");
  if (await skip.count()) await skip.first().click();
  await p.waitForTimeout(800);
  const shot = async (name) => { await p.waitForTimeout(1500); await p.screenshot({ path: OUT + "/raw-" + name + ".png" }); console.log("shot", name); };
  const tap = async (label) => { await p.locator("button, a, [role=tab]").filter({ hasText: new RegExp("^\\s*" + label + "\\s*$") }).first().click(); };
  await p.mouse.move(200, 190);
  for (let i = 0; i < 2; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(400); }
  await shot("layout");
  const tab = async (label) => { await p.locator(".tab").filter({ hasText: label }).first().click(); };
  await tab("Draw"); await shot("draw");
  await tab("Measure"); await shot("measure");
  await tab("Plan"); await shot("plan");
  await p.locator("button").filter({ hasText: "Parts list" }).first().click(); await shot("parts");
  await b.close();
})();
