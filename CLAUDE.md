# Head to Head: working rules

Zach's phone app for laying out sprinkler systems. He ran a sprinkler supply counter, so the
irrigation rules come from him. Every rule below has a test in `test/engine.test.js`; run
`node test/engine.test.js` after any engine change. `node test/fuzz.js 50 <seed>` builds 50 random
yards with every feature, runs them the way the app does, and checks the rules independently; run
seeds 1 to 3 after engine changes. Coverage under 98% is flagged: Zach accepts single coverage
in strips a couple of feet wide (a bed 2.4 ft from a fence) rather than adding 4VANs there
(2026-11-10). The one known flag is a fence running lengthwise down a narrow strip lawn (95.6%). Timing on a loaded Mac
swings 10x, so compare old and new engines back to back before calling anything slow.

## Never

- Never turn Zach's preference into a hard ban. On 2026-11-08 a "no VAN under 8VAN on a curve"
  rule was shipped and he said: "8 van should be the smallest for a general curve, but I don't
  want to make a rule because surely there will be curves where people are in a tight area and
  require a smaller head." When he gives a usual size, build it as the first try with a fallback,
  never as the only option.
- Never ship a guessed limit as if it were his. When a number isn't his (overspray allowance,
  minimum head size), say it's a guess and ask him for the real one in the same reply.
- Never trust the engine's own checker for a new limit. On 2026-11-08 the checker passed a
  kidney lawn with a spray tip 1.08 ft past a curve against a 1 ft rule, because sampling stopped
  short of the tip. Measure new limits with an independent script at a finer step before you
  claim them.
- Never sell GPS walking as accurate enough to draw a sprinkler map from. Zach walked a real yard
  on 2026-11-14: "its off by up to like 9 feet even with the anchor", and "if you are drawing a
  sprinkler map, the most margin of error is probably a foot". The simulation in
  `test/trace.test.js` had promised 6 to 7 ft. Phone GPS drift can't be smoothed away, so a walk is
  a rough outline only. Never quote simulated accuracy as what a phone will do; say it's simulated
  and get a real walk before claiming a number. Under a foot needs tape from two fixed points, the
  camera (App Store version), or an RTK receiver.
- Never give Zach click-by-click directions for a Mac app without a screenshot of what's on his
  screen first. On 2026-11-15 he was told to pick a Team in Xcode's project window while only
  Xcode Settings was open: "i dont see what you are talking about". Open the exact window
  yourself, screenshot, then describe what he'll actually see.
- Never mix rotors and pop-ups in the same area just because each fits (Zach 2026-11-15, Camera v1
  lawn): "most contractors won't like the idea of having pop up and rotors in the same line/ close
  area. then you are running multiple lateral lines in the same area that makes your pipe usage go
  way up." The north edge there went R1, 12VAN, 15VAN, R1, 12VAN, 10H, R0.5, 12VAN, 10VAN, R1.5.
  Being on separate zones isn't enough. Asked him how he'd lay that lawn out (all rotors, all
  pop-ups, or split down the middle) before building the rule; use his answer.
- Never market Head to Head as a generic layout tool. On 2026-11-16 the first front page led with
  "Draw the yard" and satellite tracing, and Zach said: "lets really capitalize on the fact that
  this is built by a landscaper so that i could save time on my own jobs. and lets really market
  the camera idea ... it takes like 5 minutes to map an entire yard by literally just walking
  around. No measuring wheels, no tapes, no mapping on their end." Lead with the camera walk and
  the landscaper who built it (`landingPage` in `js/app.js`). The 5 minutes is his estimate, not a
  timed walk, and the camera walk is iPhone-only and not on the App Store yet: say both plainly.
- Never use a price that isn't the latest one he gave. The standard contractor price went from
  about $35 to $30 on 2026-11-16 ("lets go with 30 for standard as of right now"); founding is $20
  and a yard is $15 for homeowners and contractors alike (Zach 2026-11-17: "both are the same"). Prices live in `PLAN_PRICE`/`FOUNDING_PRICE`/`UNLOCK_PRICE` in `js/app.js`, the
  front page, and the Stripe sandbox lookup keys (standard_monthly, founding_monthly, yard_unlock):
  change all three together.
- Never list rotor nozzles on the parts list. Rotors come with every nozzle (Zach, 2026-11-08).

## His rules

- Overspray: zero on straight edges. Up to 1 ft past a curve, "nothing over a foot ever".
  A spot past the corner where a curve meets a straight edge counts as straight.
- Curves: "overspray is better than a bunch of small heads". Use 8VAN and up first, and add
  4VAN or 6VAN only where a tight curve is still dry.
- Rotors: 3504 throws 18 to 23 ft, 5004 throws 24 to 30 ft. Use rotors only where 3 or more fit
  in a zone.
- Zones stay in one part of the yard (Zach 2026-11-09): "dont spread rotors across the entire
  yard", no "blender of heads". Two zones of the same kind merge only when they're neighbours
  (their sprays reach each other) and fit under the cap; a 1 or 2 head zone may reach 45 ft on
  the same lawn. Rotor borrowing is neighbours only, but if a lawn still has a rotor zone under 3 after
  merging and borrowing, all its rotors are regrouped from scratch (`regroupRotors`: fewest valves,
  every zone 3+ and under the cap, shortest pipe), because Zach said on 2026-11-17 "on a yard that
  big, more trenching and inevitably more space between heads is fine". In 1,000 random yards that
  took short rotor zones from 3 yards to 0. A pop-up zone of one head that can't merge
  (cap) takes the nearest head of a pop-up zone of 3+ within 45 ft (`shareLonePopup`). There's no minimum number of pop-ups for a
  zone. A test fails if any zone has a head off on its own.
- Rotor side and pop-up side (Zach 2026-11-15, Camera v1): "pop ups along the north curvy side and
  rotors along the straight south. split down the middle". In Auto, straight outer edges are rotor edges
  with no length minimum (Zach: the 3-rotor zone rule decides), except a straight stretch between
  curves under 36 ft (too short for 3 rotors head to head), which joins the curvy side. Curves are
  pop-up edges, except a curvy run under POPUP_RUN (40 ft) total stays rotor ground (its curve still
  gets VANs where rotors can't reach). Each spot goes to its nearest edge's side, but the pop-up side
  reaches at most POPUP_DEPTH (16 ft) in. Rotors only sit on the rotor side; pop-ups only on the
  pop-up side, or in a wide patch (70% of 6 ft around) that rotors leave thin. Zach okayed 40 and 16
  (2026-11-15). A rotor patch needing more valves than its rotors can fill 3 each
  goes to pop-ups. Test: "Camera v1" in `test/engine.test.js` (at most 2 rotor/pop-up switches
  around the edge; the old engine had 14).
- Rotor rule both ways: a mostly pop-up area with under 3 rotors goes all pop-ups, and a rotor
  lawn drops a lone pop-up or two that can't share a valve, if nothing goes dry and no more than
  10 sq ft loses double coverage.
- Fences (Zach 2026-11-09): a lawn can be traced through a fence, but heads can't spray through
  one. A fence is an open line with no width. When it crosses a lawn the engine splits the lawn
  along it (`splitByFences`, curved edges stay curved), and each side is laid out with the fence as
  a straight, zero-overspray edge. A fence that stops partway into a lawn is still a wall
  (`fenceSlits`): the lawn edge runs in along both faces of the fence and back out, and a fence
  piece floating inside a lawn becomes a hole with no width. Gate markers were removed; old ones
  are dropped when jobs load.
  Fences draw as the map symbol for a fence, a near-black line with x's along it and a
  "Fence" tag (zone colors take nearly every bright color, so color alone can't mark it). Beds
  are split by fences too and pulled 0.3 ft off the fence (`offFence` in `js/engine.js`, square to
  the fence), or the far side treats the bed as lawn.
  Drip ignores fences: the pipe runs under them, so drip zones never split at a fence.
  Two heads on the same spot (one each side of a fence) are drawn a few pixels apart, square to
  the fence, on the map and the plan (`nudges` in `js/plan.js`). Drawing only: real positions
  and coverage don't move.
- Walk: GPS walking removed 2026-11-14; the Walk tab says "Under construction right now" (his words). Zach: "The gps system is useless and no one will buy a seperate gps.
  Lets build it for the app store version." It comes back in the App Store version using the
  iPhone camera's motion tracking, not GPS. `js/trace.js` (trail to straight edges and curves) and
  `test/trace.test.js` stay for that; the GPS walk UI is in git history (commit 6670fff).
  Camera walk (2026-11-15, branch feat/ios-app): `ios/App/App/CameraWalk.swift` is an ARKit screen
  (world tracking, LiDAR mesh on Pro phones, compass-aligned). A crosshair raycasts to the ground;
  Start records a point every 0.15 m, Corner pins the crosshair spot, Finish returns feet (x east,
  y north). `panelWalk` in `js/app.js` opens it only inside the iPhone app; `placeWalk` runs
  `H2HTrace.fit(points, { precise: true })` and drops the shape in the middle of the screen.
  Accuracy is untested on a real yard: get Zach's tape comparison before quoting a number.
  iPhone app: Capacitor 8, bundle ID com.headtoheadapp.app, team 8T89UT9858. `npm run ios` copies
  the site into www/ and syncs; build with xcodebuild -allowProvisioningUpdates.
- Grid paper (Zach 2026-11-14): a new job picks Satellite or Grid paper first. Satellite shows the
  address search and "Use where I am now"; grid shows only an optional address for the plan. Grid
  paper is 1 ft squares with a darker line every 10 ft (`gridPaper` in `js/app.js`), drawn in the
  job's own feet from `job.origin`, which never moves on a grid job. Corners snap to whole feet
  (`gridSnap`); curve bulges don't. Measure on a grid job just reads a length (no tape scale fix).
  Zoomed out, the 1 ft lines drop away and a scale bar shows. `job.base` is "grid" or missing.
- Homeowner mode (Zach 2026-11-15): "Homeowner? Map your own yard" on the sign-in and home screens
  (`prefs.homeowner`, no account, jobs stay on the phone). They map and generate like a contractor,
  but until a yard is paid for (`job.unlocked`) the heads on the map are blurred, tapping them does
  nothing, and Plan and Parts open the unlock sheet. They do see the head count, zones and a rough
  trench length (`trenchPlan`, see Trench below). Price is $15 one time (`UNLOCK_PRICE`, $10 until 2026-11-17). Payments aren't hooked up: only the http localhost
  test copy shows a no-charge unlock; the iPhone app is capacitor://localhost and must never get it.
  Installers near them show with their Google rating; installers pay $49 a month on top of the
  subscription to be listed. That list stays off (`SHOW_INSTALLERS`) until lots of homeowners use
  the app (Zach 2026-11-15); only the test copy shows it, with a "Sample listing".
- Website and iPhone app (Zach 2026-11-16): "keep full mapping on the website except the camera
  feature. tell people that feature is available on the app though." The website is the front door
  and the office: a front page for signed-out visitors (`landingPage`, with the sign-in form in
  it), paying (Apple takes no cut there; the iPhone app only links to the website, `planBlock`),
  mapping with a mouse (the map fills the left side and the panel sits on the right at 900 px and
  wider), printing and crew invites. The iPhone app is for the yard: camera walk, plus everything
  else. `NATIVE` in `js/app.js` tells them apart; inside the app, links that leave the phone use
  `SITE_URL` (the app's own address is capacitor://localhost). The front page shows no reviews or
  customer counts until real ones exist. `img/app-layout.jpg` is a capture of the example yard.
- Plans, locks and accounts (Zach 2026-11-17). A contractor company with no active plan (never
  started, or cancelled) keeps its account and every job, crew included, and can map new yards,
  but a yard's heads stay blurred and Plan and Parts stay shut until it's paid for ($15, Stripe
  lookup contractor_yard). Yards laid out while the plan was active stay open after a cancel. A
  paid yard (contractor or homeowner) locks again if its lawns move more than 500 ft ("lets say it
  needs to move more than 500 feet") or, on grid paper, if the lawn area changes by more than half
  (`inPlace`, `MOVE_LIMIT_FT`, `AREA_LIMIT` in `js/app.js`). Locks only apply when `ENFORCE`
  (payments on, or the localhost test copy). Locks run on the phone, so a determined person could
  get around them; moving the layout engine to the server is the only real fix. Company screen:
  Deactivate the plan (stops at the end of the paid period, keeps everything) and Delete my account
  (an owner's company and all its jobs go with it; typed DELETE to confirm). Both go through the
  `billing` function. Stripe sandbox only takes cards and Apple Pay (set on the account: Stripe no
  longer takes payment types per checkout).
- Pricing (Zach 2026-11-15, standard changed to $30 on 2026-11-16): contractors pay $30 a month (Stripe lookup key standard_monthly). The first contractors on the app
  lock in $20 a month. Homeowners pay $15 once per yard (was $10; Zach 2026-11-17: "each yard is $15 for a homeowner/contractor"). Nothing is charged yet.
  Crew (Zach 2026-11-17): a contractor account includes 2 crew members free; each person after
  that is $5 a month (not built into billing yet). Referrals (Zach 2026-11-17, not built yet): every
  contractor company has a referral code to give another contractor; the new contractor who enters
  it gets $5 off their first month; the contractor who shared it gets one free month, only after
  the new contractor's first payment goes through; free months stack.
- Trench (Zach 2026-11-16, `trenchPlan` in `js/engine.js`): zones (drip too) are grouped by
  closeness into valve boxes sized by `valveBoxes`; each box goes on the lawn edge at the spot
  closest on average to its zones; the meter, every box and the middle of every zone are joined by
  one shared network (`trenchTree`: shortest tree, then split points wherever two trenches leave a
  point under 120 degrees apart), so the mainline and different boxes' lines share trench too ("can
  you combine the trenches so that multiple pipes can be in the same trench when they are close?";
  the example yard went from 657 ft run separately to 464 shared); plus 50 ft inside each pop-up
  zone and 75 ft inside each rotor zone ("thats probably
  close enough"). A drip zone's trench stops at the edge of its beds, nothing inside ("just get the
  pipe to the bed area"). Homeowners see only the total, "Estimated trenching: About N ft" (Zach 2026-11-17: "keep it simple"). The boxes show on the map as VB pins
  and the network as dashed brown lines once the layout is visible. He wants the same method for pipe lengths on the parts list next.
- Look (Zach picked look A of three, 2026-11-15): cream and green, soft shadows instead of outlines,
  springy button presses, a floating tab bar, and an opening animation where the logo's spray arcs
  draw in (`splash` in `js/app.js`). The home screen fades in only when you arrive at it, not when a
  sync redraws it. Logo (Zach 2026-11-15, option 4 from a logo page made in another session): the
  words HEAD TO HEAD bent into a water drop with the sprinkler as the T, letters cut out, in the
  app's green. `icons/logo.svg` (drop alone), `icons/icon.svg` (green drop on a cream tile, his pick over green), PNGs
  at 180/512 and the iPhone's 1024 AppIcon are renders of that tile. Opening animation (his pick of 9,
  "the rain one"): three small drops fall and the logo grows in where they land. Home header (his
  pick, option B, "sleek and simple"): only the drop, small and centered, the company's name
  centered under it, a thin line below; no intro sentence for contractors (homeowners keep theirs). The letters are holes in one even-odd path, not a mask: the masked version
  rendered blurry on his iPhone (WebKit draws masks at low resolution).
- Trees (Zach 2026-11-15): a tree pin has a trunk size slider (2 to 48 in, new trees start at 12).
  Under 6 in (`BIG_TRUNK_IN`) the layout ignores it. A bigger trunk: blocks spray (`shaded` in
  `covers`, so a head can't water the ground behind it), the ground under the trunk needs no water,
  no head within 7 ft of the trunk (`TREE_KEEP`, his number) except a head sitting on a fence line
  ("the fence boundary should override that"; areas carry `fences` for this), and no rotor whose
  spray reaches the trunk, at any distance ("as long as the rotor spray isnt hitting the trunk then
  it doesnt matter"). A rotor that would reach a trunk is screwed down to stop short of it if it can
  still throw its 18 ft minimum. Ground within `TREE_POPUPS` (15 ft, guess) of a big trunk is
  pop-up ground from the start. Big trees show a dashed 7 ft ring on the map. Tests: "Trees" in
  `test/engine.test.js`, checked by tracing spray lines past the trunk independently.
- Park strips (Zach 2026-11-15): a lawn 3 to 6 ft wide (`STRIP_MIN_W`, `STRIP_MAX_W`, his numbers),
  close to a rectangle (97% of its narrowest bounding rectangle; slanted or tapered strips threw past
  their edges in the random yards and keep regular pop-ups), gets Rain Bird 15 Strip Series nozzles:
  15RCS and 15LCS in the two corners of one long side, 15SSTs along that side between them, head to
  head, no more than 15 ft apart. "the LCS RCS and SST are the main ones installers use"; 15EST and
  15CST are in `STRIP` for odd cases and can be picked by hand on a strip head ("Switch nozzle").
  Each nozzle's throw is screwed down to the spacing so nothing throws past the strip's ends. GPM at
  30 PSI: RCS/LCS 0.49, SST and CST 1.21 (SST confirmed by Zach), EST 0.61. A strip head covers a
  band (`h.strip`), 4 ft wide at least; on a 3 ft strip that lands past the far side, which he
  accepts. The example yard has a 5 ft park strip.
  The heads go on the long side facing the rest of the yard ("sidewalk side always"; `toward` in
  `buildAreas`, the area-weighted middle of the other lawn pieces). A narrow arm of a bigger lawn (a
  side entrance traced with the backyard) is found by `stripCuts`: two straight opposite edges 3 to
  6 ft apart, side by side for 8 ft and twice the width, lawn all the way between; it's cut off
  square where it opens into more lawn, and the rest of the lawn treats the cut as an edge.
  `test/fuzz.js` builds areas the same way.
- First-time tour (Zach 2026-11-16): the first time the home screen would show on a phone
  (`prefs.toured`), the app opens the example yard and shows 7 tips one at a time (`tourSteps`),
  each pointing at its tab with an X to close it and a "Skip tour" link: welcome, Draw, Walk,
  Measure, Heads, Plan and parts, and how to start a job. Homeowners get their own wording for
  Heads and Plan. "Take the tour" on the home screen runs it again. When a feature is added, add a
  line to the tip for its tab.
- Example yard: "Try an example yard" on the home screen builds a made-up yard with every
  feature, on a plain background (no satellite photo of a real place), and lays it out.
  When a feature is added, add it to `exampleJob()` in `js/app.js` too.
- Parts list sections, in order: heads, pipe, fittings, manifold, controller, water connection.
  - Pop-ups: one total of 1804 bodies, plus a count for each nozzle that's on the map, listed as just "15H" under the Spray nozzles header. No zero lines.
  - Rotors: a total per model only.
  - Swing joints: a 1/2" elbow for each pop-up and 3504, a 3/4" elbow for each 5004. Swing pipe
    is 3 ft per head, in whole 100 ft rolls rounded up, never fewer than 1.
  - Manifold: one zone valve per zone. Valve boxes (Zach 2026-11-16): 4 valves fit in a box, and
    they're spread evenly over the fewest boxes ("6 zones i would do 3 and 3"; `valveBoxes`). Drip
    zone valves count too (an assumption, not confirmed). The line is "Standard valve box" or
    "Jumbo valve box", picked on the parts list and remembered as the company's default
    (`prefs.boxSize`, `job.boxSize`). The Heads tab notes the split, e.g. "2 valve boxes: 3, 3 valves".
  - Drip (2026-11-08): every bed is drip. A row runs the length of the bed. The width is
    checked all over the bed, and wherever it's over 7 ft the bed gets an extra row (7 ft or
    less is one row). A drip zone carries 250 ft at most, and the line from the valve box
    isn't counted. Separate beds are separate zones and touching beds share one. A bed under
    20 ft of pipe joins a bed within 15 ft. Rolls, with no pipe left over: 100s up to 350 ft,
    250s and 100s from 351 to 750, and 500s too past 750. A bed over 14 ft wide gets a row for
    every 7 ft. The list
    says "Drip zone valve", one per drip zone. Drip zones are counted from the beds on the map;
    the old manual counter is gone.
  - Drip section (2026-11-08): total drip feet goes in the shaded Drip header ("Drip · 151 ft
    of drip pipe"), then the rolls by Zach's rule, 3 drip tees and 1 drip coupling for every
    100 ft (rounded up, no elbows), and a figure 8 end cap per drip area (a bed, or beds that
    touch). No roll-size picker: "just let them decide that at the store". Drip zone valves
    stay in the Manifold section.
  - Editing: a company can edit any job's list and reset it back to the app's list. The edited
    list is what gets copied and printed.
  - Lateral and mainline fittings (2026-11-10): per sprinkler zone 1 coupling, 2 tees, 1 swing
    adapter; per yard 2 elbows and 30 mainline pinch clamps; 1 bag of LD pinch clamps per 10 zones,
    rounded up, and a saddle for every head. Wire isn't counted: the list ends with "Don't forget
    your low voltage wire!" (Zach 2026-11-17: "who knows where they will put the timer").
  - Pipe (Zach 2026-11-17, `pipePlan`, on trenchPlan's valve boxes): mainline is the shortest run
    joining the meter and every box, through a box or teed off partway, whichever is shorter; each
    Spigot pin gets mainline back to the nearest point on that run (and a trench); every zone gets
    its own lateral from its box out to each head, ending at the last one (shortest tree over the box
    and its heads); a drip zone's lateral stops at its bed's edge. Listed as '<size> mainline pipe'
    and '<size> lateral pipe' by roll (Zach 2026-11-17): mainline in 100 and 300 ft rolls with no
    extra ("keep that pretty close"); lateral in 100 and 400 ft rolls plus 100 ft up to 1300 ft, 200
    ft over that, 400 ft over 3000 (`lateralExtra`); `rollMix` picks the least pipe left over, then
    the fewest rolls. Laterals may split ("lateral lines can split too"), and spigot pipe is 1"
    mainline, counted in with it (Zach 2026-11-17).
  - Sizes (2026-11-10): the new job screen asks for the supply line from the street (3/4" or 1",
    required). Job settings has a lateral line size (3/4" or 1", past the valves),
    starting at the supply size. Saddles, couplings, tees, elbows and LD clamps carry the lateral
    size; mainline pipe and mainline pinch clamps are 1" on every yard (Zach 2026-11-17: "the mainline
    from the meter to each of the boxes and spigot should be 1 inch on every yard"); swing elbows and
    swing adapters no size. The lateral starts at the supply size and can be switched on the parts
    list too ("Lateral line" 3/4" or 1"); picking 1" is remembered for the company's new jobs
    (`prefs.lateral`), since "some landscapers only use 1 inch everywhere". A 3/4"
    lateral on a bigger supply shows a warning and caps zones at 12 GPM, as if the supply were 3/4".
  - Water: every job is culinary or secondary, picked on the new job screen. Culinary gets "Backflow setup"
    and secondary "Filter setup" (brands vary too much to list), each with a stainless steel ball
    valve. These live in `WATER_SOURCE_PARTS` in `js/engine.js`.
    A company can replace either with its own parts ("Edit our backflow setup" on the parts list),
    saved on the phone (`headtohead.prefs.v1`, `setups`) and used on every job with that water.

## Zach's list before he feels good about the app (2026-11-15)

1. Trenching for homeowners: built 2026-11-16 to his method (see Trench). Next: pipe lengths on the
   parts list the same way.
2. Rework tree mechanics: built 2026-11-15 (see Trees under His rules). Open: TREE_POPUPS (15 ft)
   is still a guess.
3. Google ratings for the installer list, for when that list is switched on (`SHOW_INSTALLERS`).
4. The website vs the app: decided and built 2026-11-16 (see Website and iPhone app under His rules).
5. Security and liability (added 2026-11-17): "a way im not liable for if someones map is wrong
   because in reality, this is just a tool for contractors, we aren't actually installing the yard."
6. A sod calculator (added 2026-11-17).

## Payments and server scripts

Keys live in the Mac's keychain (account head-to-head): supabase-access-token,
stripe-secret-key-test, stripe-webhook-secret-test. Scripts read them from env vars and never print
them. Run with Node 18+:

- `scripts/supabase.mjs` (env SUPA_TOKEN): `query "<sql>"`, `sqlfile <migration>`, `deploy <slug>
  supabase/functions/<slug> <verify_jwt>`, `secrets NAME=ENVVAR`, `list-functions`. Migrations are
  run by hand with `sqlfile`, in order; 0001 to 0006 are on the live project.
- `scripts/stripe-prices.mjs` (env STRIPE_KEY): makes the products and lookup-key prices; leaves
  existing ones alone (changing a price means a new price with `transfer_lookup_key`).
- `scripts/stripe-webhook-setup.mjs hook|portal` (env STRIPE_KEY): creates the webhook (prints its
  signing secret once, pipe it into the keychain) and sets up the billing portal.
- End-to-end tests against the Stripe sandbox and the live Supabase project, with the site served
  on http://localhost:8742 (`python3 -m http.server 8742`) and playwright-core installed:
  `test/pay-homeowner.e2e.js` (4242 card through Stripe checkout, yard unlocks),
  `test/yard-lock.e2e.js` (500 ft and grid area rules), `test/account.e2e.mjs` (throwaway account:
  checkout, $15 price by sign-in, deactivate, delete leaves nothing; env ANON, SUPA_TOKEN,
  STRIPE_KEY), `test/subscription.e2e.mjs` (webhook writes billing for the oldest company, then
  cleans up).

## Shipping

The site is GitHub Pages from `main` (zachlessig/head-to-head). Push and it's live in about
a minute. The Mapbox key is a public `pk.` token. GitHub push protection flags it, and Zach has
to click "Allow secret" once for each new token.
