const { chromium } = require("playwright-core");
const QR = require("qrcode");
const fs = require("fs");
const REPO = process.argv[2], OUT = REPO + "/marketing";
const logo = fs.readFileSync(REPO + "/icons/logo.svg", "utf8");
const logoCream = logo.replace('fill="url(#dg)"', 'fill="#f6f3ea"');
const fonts = '<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap" rel="stylesheet">';
const base = `*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:"DM Sans",sans-serif;color:#143020;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,.serif{font-family:Fraunces,Georgia,serif}`;
(async () => {
  const url = "https://headtoheadapp.com/#signin";
  const qr = (await QR.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#143020", light: "#0000" } }));
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const p = await b.newPage();

  // Counter flyer: US letter, 0.25in safe margin, prints on a normal printer
  const flyer = `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${base}
@page{size:8.5in 11in;margin:0}
.page{width:8.5in;height:11in;padding:0.5in 0.6in;display:flex;flex-direction:column;background:#fffdf8}
.brand{display:flex;align-items:center;gap:12px}.brand svg{width:44px;height:48px}.brand b{font-family:Fraunces,Georgia,serif;font-size:26px}
.tag{align-self:flex-start;margin-top:30px;background:#dcebdf;color:#1d6e47;font-weight:700;font-size:15px;padding:6px 14px;border-radius:99px}
h1{font-size:60px;line-height:1.02;margin:16px 0 22px;letter-spacing:-0.01em}
.lede{font-size:21px;line-height:1.45;color:#3d5246;margin:0 0 26px;max-width:6.6in}
ul{list-style:none;padding:0;margin:0 0 28px}li{font-size:20px;line-height:1.35;padding:14px 0 14px 40px;position:relative;border-top:1px solid #e6e2d6}
li:last-child{border-bottom:1px solid #e6e2d6}
li:before{content:"";position:absolute;left:4px;top:18px;width:20px;height:20px;border-radius:50%;background:#1d6e47}
li:after{content:"";position:absolute;left:10px;top:22px;width:6px;height:10px;border:solid #fff;border-width:0 3px 3px 0;transform:rotate(45deg)}
.offer{margin-top:auto;display:flex;gap:28px;align-items:center;background:#1d6e47;color:#f6f3ea;border-radius:22px;padding:26px 30px}
.offer h2{font-size:31px;margin:0 0 6px;line-height:1.05}.offer p{margin:4px 0;font-size:17px;color:#dcebdf;line-height:1.4}
.qr{flex:none;width:1.75in;background:#fffdf8;border-radius:14px;padding:12px;text-align:center}.qr svg{width:100%;height:auto;display:block}
.qr span{display:block;margin-top:8px;font-weight:700;font-size:13px;color:#143020}
.foot{display:flex;justify-content:space-between;margin-top:18px;font-size:14px;color:#64746a}
</style></head><body><div class="page">
<div class="brand">${logo.replace("<svg", '<svg aria-hidden="true"')}<b>Head to Head</b></div>
<span class="tag">Built by a landscaper</span>
<h1>Walk the yard.<br>Get the sprinkler layout.</h1>
<p class="lede">Walk the edge of the lawn with your iPhone and Head to Head maps it. Then it places every head, splits the zones to fit the water, and writes the parts list for the counter.</p>
<ul>
<li>No measuring wheel, no tape, no drawing it up later</li>
<li>Heads set head to head, with no spray over sidewalks or fences</li>
<li>Zones sized to your pressure and supply line</li>
<li>A to-scale plan to print, and the full parts list for the store</li>
</ul>
<div class="offer"><div>
<h2>Founding contractors:<br>$20 a month</h2>
<p>Locked in for as long as you keep the plan. Regular price is $30.</p>
<p>Only a few installs a year? Pay $15 a yard instead.</p>
</div><div class="qr">${qr}<span>Scan to start</span></div></div>
<div class="foot"><span>headtoheadapp.com &nbsp;·&nbsp; zach@headtoheadapp.com</span><span>iPhone app coming to the App Store</span></div>
</div></body></html>`;
  await p.setContent(flyer, { waitUntil: "networkidle" });
  await p.pdf({ path: OUT + "/flyer-letter.pdf", width: "8.5in", height: "11in", printBackground: true });
  await p.setViewportSize({ width: 816, height: 1056 });
  await p.screenshot({ path: OUT + "/flyer-preview.png" });

  // Business card: 3.5 x 2 in trim, 0.125 in bleed each side (3.75 x 2.25 page), text 0.125 in inside trim
  const card = (inner, bg) => `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${base}
@page{size:3.75in 2.25in;margin:0}.bleed{width:3.75in;height:2.25in;background:${bg};position:relative;overflow:hidden}
.safe{position:absolute;left:0.25in;top:0.25in;right:0.25in;bottom:0.25in}${inner.css}</style></head><body><div class="bleed"><div class="safe">${inner.html}</div></div></body></html>`;
  const front = card({ css: `.safe{display:flex;align-items:center;gap:0.18in;color:#f6f3ea}.safe svg{width:0.85in;height:0.93in;flex:none}
.n{font-family:Fraunces,Georgia,serif;font-size:21px;font-weight:700;line-height:1.05}.s{margin-top:6px;font-size:9.5px;line-height:1.35;color:#dcebdf}`,
    html: `${logoCream}<div><div class="n">Head to Head</div><div class="s">Walk the yard.<br>Get the sprinkler layout.</div></div>` }, "#1d6e47");
  const back = card({ css: `.safe{display:flex;justify-content:space-between;align-items:center}
.who b{display:block;font-family:Fraunces,Georgia,serif;font-size:15px}.who i{display:block;font-style:normal;font-size:8.5px;color:#64746a;margin:1px 0 9px}
.who div{font-size:8.5px;line-height:1.6}.qr{width:0.92in}.qr svg{width:100%;height:auto;display:block}.qr span{display:block;text-align:center;font-size:6.5px;font-weight:700;margin-top:3px}`,
    html: `<div class="who"><b>Zach Lessig</b><i>Founder, Head to Head</i><div>zach@headtoheadapp.com</div><div>headtoheadapp.com</div><div style="color:#64746a;margin-top:5px">Built by a landscaper</div></div><div class="qr">${qr}<span>Scan to start</span></div>` }, "#fffdf8");
  for (const [n, h] of [["card-front", front], ["card-back", back]]) {
    await p.setContent(h, { waitUntil: "networkidle" });
    await p.pdf({ path: OUT + "/" + n + ".pdf", width: "3.75in", height: "2.25in", printBackground: true });
    await p.setViewportSize({ width: 360, height: 216 });
    await p.screenshot({ path: OUT + "/" + n + "-preview.png" });
  }
  await b.close();
  console.log("done");
})();
