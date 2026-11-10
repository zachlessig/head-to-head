# Head to Head: working rules

Zach's phone app for laying out sprinkler systems. He ran a sprinkler supply counter, so the
irrigation rules come from him. Every rule below has a test in `test/engine.test.js`; run
`node test/engine.test.js` after any engine change. `node test/fuzz.js 50 <seed>` builds 50 random
yards with every feature, runs them the way the app does, and checks the rules independently; run
seeds 1 to 3 after engine changes (146 of 150 clean on 2026-11-10; the 4 are fences running
lengthwise down a 6 to 14 ft strip, which leave slivers at 95.8% to 98.7% coverage). Timing on a loaded Mac
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
  the same lawn. Rotor borrowing is neighbours only. There's no minimum number of pop-ups for a
  zone. A test fails if any zone has a head off on its own.
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
- Example yard: "Try an example yard" on the home screen builds a made-up yard with every
  feature, on a plain background (no satellite photo of a real place), and lays it out.
  When a feature is added, add it to `exampleJob()` in `js/app.js` too.
- Parts list sections, in order: heads, pipe, fittings, manifold, controller, water connection.
  - Pop-ups: one total of 1804 bodies, plus a count for each nozzle that's on the map, listed as just "15H" under the Spray nozzles header. No zero lines.
  - Rotors: a total per model only.
  - Swing joints: a 1/2" elbow for each pop-up and 3504, a 3/4" elbow for each 5004. Swing pipe
    is 3 ft per head, in whole 100 ft rolls rounded up, never fewer than 1.
  - Manifold: one zone valve per zone.
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
  - Water: every job is culinary or secondary, picked on the new job screen. Culinary needs a
    backflow preventer and secondary needs a filter. Zach is writing a fixed list for each, and it
    goes in `WATER_SOURCE_PARTS` in `js/engine.js`.

## Shipping

The site is GitHub Pages from `main` (zachlessig/head-to-head). Push and it's live in about
a minute. The Mapbox key is a public `pk.` token. GitHub push protection flags it, and Zach has
to click "Allow secret" once for each new token.
