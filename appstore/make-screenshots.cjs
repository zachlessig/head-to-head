const { chromium } = require("playwright-core");
const fs = require("fs");
const OUT = process.argv[2], DEST = process.argv[3];
const frames = [
  ["1-layout", "raw-layout.png", "Every head placed for you", "Rotors and pop-ups laid out head to head, then zoned to fit your water."],
  ["2-plan", "raw-plan.png", "A plan you can hand over", "To scale, every zone marked. Print it or save a PDF."],
  ["3-parts", "raw-parts.png", "The parts list, ready for the counter", "Heads, nozzles, pipe, fittings and valves, already counted."],
  ["4-sod", "raw-measure.png", "Sod and square footage too", "Pallets figured with 10% extra for edges and cuts."],
];
(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await b.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 });
  const p = await ctx.newPage();
  for (const [name, raw, head, sub] of frames) {
    const img = "data:image/png;base64," + fs.readFileSync(OUT + "/" + raw).toString("base64");
    await p.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,500;9..40,600&family=Fraunces:opsz,wght@9..144,700&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:440px;height:956px;overflow:hidden;background:#1d6e47;font-family:"DM Sans",sans-serif}
.top{padding:46px 30px 0;color:#f6f3ea}
h1{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:34px;line-height:1.08;margin:0 0 12px;letter-spacing:-0.01em;text-wrap:balance}
p{margin:0;font-size:17px;line-height:1.4;color:#dcebdf;text-wrap:pretty}
.phone{position:absolute;left:50%;transform:translateX(-50%);top:262px;width:356px;border-radius:38px;overflow:hidden;border:7px solid #143020;box-shadow:0 18px 40px rgba(0,0,0,.28)}
.phone img{display:block;width:100%}
</style></head><body><div class="top"><h1>${head}</h1><p>${sub}</p></div><div class="phone"><img src="${img}"></div></body></html>`, { waitUntil: "networkidle" });
    await p.waitForTimeout(400);
    await p.screenshot({ path: DEST + "/" + name + ".png" });
    console.log("made", name);
  }
  await b.close();
})();
