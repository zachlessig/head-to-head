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

  // Counter flyer (v2, Zach 2026-11-19: "capitalize on how easy it is, and how much time it saves")
  const flyer = `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${base}
@page{size:8.5in 11in;margin:0}
.page{width:8.5in;height:11in;padding:0.5in 0.6in;display:flex;flex-direction:column;background:#fffdf8}
.brand{display:flex;align-items:center;gap:12px}.brand svg{width:44px;height:48px}.brand b{font-family:Fraunces,Georgia,serif;font-size:26px}
h1{font-size:62px;line-height:1.0;margin:30px 0 16px;letter-spacing:-0.015em}
h1 em{font-style:normal;color:#1d6e47}
.lede{font-size:21px;line-height:1.45;color:#3d5246;margin:0 0 26px}
.vs{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.col{border-radius:20px;padding:20px 22px}
.old{background:#f1eee6;color:#64746a}.new{background:#1d6e47;color:#f6f3ea}
.col b{display:block;font-size:14px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px}
.col ol{margin:0;padding:0;list-style:none;counter-reset:n}
.col li{counter-increment:n;font-size:17.5px;line-height:1.3;padding:8px 0 8px 34px;position:relative}
.col li:before{content:counter(n);position:absolute;left:0;top:7px;width:24px;height:24px;border-radius:50%;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
.old li:before{background:#e2ddd0;color:#64746a}.new li:before{background:#f6f3ea;color:#1d6e47}
.old li{text-decoration:line-through;text-decoration-color:#b9b2a2}
.big{font-family:Fraunces,Georgia,serif;font-size:44px;font-weight:700;line-height:1;margin:14px 0 2px}
.small{font-size:14px;opacity:.85}
.offer{margin-top:auto;display:flex;gap:26px;align-items:center;border:2px solid #1d6e47;border-radius:22px;padding:22px 26px}
.offer h2{font-size:29px;margin:0 0 6px;line-height:1.08}.offer p{margin:4px 0;font-size:16.5px;color:#3d5246;line-height:1.4}
.qr{flex:none;width:1.6in;text-align:center}.qr svg{width:100%;height:auto;display:block}
.qr span{display:block;margin-top:8px;font-weight:700;font-size:13px}
.foot{display:flex;justify-content:space-between;margin-top:16px;font-size:14px;color:#64746a}
</style></head><body><div class="page">
<div class="brand">${logo.replace("<svg", '<svg aria-hidden="true"')}<b>Head to Head</b></div>
<h1>Map a whole yard in <em>about 5 minutes.</em></h1>
<p class="lede">Walk the edge of the lawn with your iPhone. Head to Head draws the yard, places every head, zones it to your water, and writes the parts list. You just walk.</p>
<div class="vs">
<div class="col old"><b>The old way</b><ol>
<li>Roll a measuring wheel down every side</li>
<li>Pull tape to the house corners</li>
<li>Sketch it on paper in the truck</li>
<li>Redraw it and count heads at home</li>
<li>Guess the parts list at the counter</li>
</ol></div>
<div class="col new"><b>With Head to Head</b><ol>
<li>Walk the edge of the lawn</li>
<li>Tap Generate</li>
<li>Print the plan and parts list</li>
</ol><div class="big">~5 min</div><div class="small">to map a whole yard</div></div>
</div>
<div class="offer"><div>
<h2>Founding contractors:<br>$20 a month, locked in</h2>
<p>Every yard included. Regular price is $30.</p>
<p>Only a few installs a year? $15 a yard instead.</p>
</div><div class="qr">${qr}<span>Scan to start</span></div></div>
<div class="foot"><span>headtoheadapp.com &nbsp;·&nbsp; (801) 791-0112 &nbsp;·&nbsp; zach@headtoheadapp.com</span><span>Built by a landscaper</span></div>
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
    html: `${logoCream}<div><div class="n">Head to Head</div><div class="s">Map a whole yard in<br>about 5 minutes.</div></div>` }, "#1d6e47");
  const back = card({ css: `.safe{display:flex;justify-content:space-between;align-items:center}
.who b{display:block;font-family:Fraunces,Georgia,serif;font-size:15px}.who i{display:block;font-style:normal;font-size:8.5px;color:#64746a;margin:1px 0 9px}
.who div{font-size:8.5px;line-height:1.6}.qr{width:0.92in}.qr svg{width:100%;height:auto;display:block}.qr span{display:block;text-align:center;font-size:6.5px;font-weight:700;margin-top:3px}`,
    html: `<div class="who"><b>Zach Lessig</b><i>Founder, Head to Head</i><div>(801) 791-0112</div><div>zach@headtoheadapp.com</div><div>headtoheadapp.com</div><div style="color:#64746a;margin-top:5px">Built by a landscaper</div></div><div class="qr">${qr}<span>Scan to start</span></div>` }, "#fffdf8");
  for (const [n, h] of [["card-front", front], ["card-back", back]]) {
    await p.setContent(h, { waitUntil: "networkidle" });
    await p.pdf({ path: OUT + "/" + n + ".pdf", width: "3.75in", height: "2.25in", printBackground: true });
    await p.setViewportSize({ width: 360, height: 216 });
    await p.screenshot({ path: OUT + "/" + n + "-preview.png" });
  }
  await b.close();
  console.log("done");
})();
