# MajiFlow Pricing Intelligence Playbook (Living Doc)

> Status: living document. Last updated 2026-06-29.
> Audience: founder / business (not a contributor/dev doc).
> Related: [MARKET_ANALYSIS.md](MARKET_ANALYSIS.md). The pricing numbers themselves live in code at `src/app/pages/pricing/pricing.model.ts` (the single edit point); unconfirmed prices are listed in `PROVISIONAL_PRICES` there.

A living, growing playbook for estimating willingness-to-pay (WTP) and ARPU with little or no data, and for monitoring the factors that will refine both as leads, runs, quotes, and (later) payments accumulate. Read one thing first: the founder's rough "WTP around 230k" is almost certainly the ONE-TIME Done-for-You Pro KIT CapEx (a purchase price), NOT a monthly figure and NOT ARPU. It is a one-off, not recurring. This doc keeps the two WTP numbers permanently separate. Every KES amount here is either grounded in code (the placeholder rates in `pricing.model.ts`) or marked [FILL] (to be replaced by a real buyer paying it or a real competitor quoting it); do not let a placeholder calcify into a "known" number. Sections marked "measurable now" can be charted today from data MajiFlow already captures (leads estimate snapshots, the runs ledger, sites/packs); sections marked "needs tracking" wait on instrumentation that does not exist yet. Update this doc as data arrives: flip metrics from estimate to actual, strike through superseded assumptions for audit, and stamp a date on each fill-in.

## 1. How to read the "230k": one-time KIT WTP vs recurring ARPU, and the razor/blades allocation

**The single biggest pricing error available here is treating WTP as one number.** It is two variables that behave completely differently. Write both down and never average or quote them together.

| | One-time KIT WTP | Recurring per-site WTP (= ARPU) |
|---|---|---|
| What it is | A purchase / budget decision: pay once to own the hardware + install | A trust-gated, ongoing decision: pay every month to keep it running and watched |
| The number | The founder's "~230k" (Done-for-You Pro KIT, incl install + warranty) | Unknown today. No ARPU exists yet (no billing job, Paystack manual) |
| In the code | `PRICING.bundle = 55_000` (Self-Install) up to the Pro band | `subscriptionMonthly(controllers)` from `PRICING.subscription` brackets (2500/2000/1500/1000, all PLACEHOLDER) + attached `packs.price_monthly` |
| Margin role | The subsidised wedge: near-cost by design, low margin | The actual revenue stream the business runs on; the only thing LTV is built on |
| How to validate | Revealed: deposit conversion + discount leakage on real quotes | Modeled now (value-at-stake x capture rate), measured later (realized ARPU once payments flow) |

**Interpreting the 230k concretely.** It lands inside the stated Pro band (~230-245k incl install + warranty), so read it as the Done-for-You CapEx. Validate it against the Self-Install step: `PRICING.bundle` is KES 55,000 for one controller bundle. The gap (~175-190k) is what the buyer pays for install + warranty + done-for-you trust. The live question per segment: is that gap defensible, or is the buyer really only willing to pay near the Self-Install figure plus a modest install fee?

**Razor/blades is a live decision, not a given.** Decide it deliberately, because it changes what recurring WTP even needs to be:
- **KIT carries its own margin** (razor priced to profit): then the subscription is pure upside, and recurring price only has to clear cost-to-serve + a fair value share.
- **KIT is subsidised to seed sites** (blades carry the business): then the subscription MUST clear cost-to-serve and earn the annuity, and you should discount the KIT to win sites. The code comments already lean this way ("the subsidised wedge", "the revenue stream, what we actually sell"), and the metering hub is explicitly "sold near cost ... margin is recovered in the billing/metering pack."
- Self-question that forces the call: of the ~230k, how much is hardware + install cost-to-serve (your floor) vs margin? You cannot answer recurring WTP until you know how much value the KIT price has already consumed.

**[FILL as data arrives]**
- One-time KIT WTP (revealed): ___ (median deposit-confirmed Pro price), date ___
- Recurring per-site WTP / blended ARPU (modeled): ___; (realized): ___ once payments flow, date ___
- Razor/blades decision: KIT margin = ___% ; chosen posture = ___ , date ___

## 2. Estimating WTP with little data: the cheap methods and when to use each

Rough order of bang-for-effort for a solo founder. Do the free anchoring today; make interviews the backbone; turn the sales pipeline into a continuous WTP meter; use surveys only to bracket the recurring base. **Skip conjoint.**

| Method | What it gives you | Use it for | Cost / effort | Sample |
|---|---|---|---|---|
| **Substitute / alternative-cost anchoring** | Defensible upper/lower brackets before you talk to anyone. Split into CapEx (anchors the KIT) and recurring (anchors the subscription) | Both WTP numbers, day one | Free, one afternoon (public pricing + a few dealer calls) | n/a |
| **Value-at-stake interviews** (structured, small-sample) | The backbone. Value-at-stake per segment AND the legibility test in one call | The core WTP signal per segment | ~1 week of calls | 8-12 real prospects per segment, recruited from `leads` |
| **Price-objection + win/loss logging** (continuous) | Your real demand curve, for free, and whether resistance is to the KIT or the monthly | Living WTP meter until billing exists | Near-zero marginal effort; set up once | every quote sent (20-30 to draw a curve) |
| **Van Westendorp PSM** (4 questions) | An acceptable price RANGE for the recurring base where you have no anchor | The MajiFlow Cloud monthly base, per segment | Half a day to tabulate | ~15-30 per segment (reuse interview prospects) |
| **Gabor-Granger** (yes/no at randomized prices) | A demand + revenue curve to CHOOSE among candidate monthly prices | Picking the revenue-optimal monthly after VW brackets it | Low-moderate; needs a price shortlist first | same channel as VW |
| **Deposit / pre-commitment test** | The strongest cheap signal: REVEALED one-time WTP, not stated | Validating the Pro KIT price | Low, high-signal; Paystack takes deposits manually today | convert lead to deposit to install |
| **Value-based anchoring** (synthesis) | Converts interview value-at-stake into an actual price, expressed in the buyer's terms ("less than one meter-reader visit") | Setting the recurring price legibly | Free once interviews are done | n/a |

**Sequencing for a solo founder:** (1) anchoring this afternoon; (2) interviews over the next week, recruiting straight from the `leads` collection (you already store name/phone/email + their stated `profile`); (3) switch on objection logging on every quote from now; (4) once you have a value prop and rough range, run VW then Gabor-Granger on the same prospects; (5) ask for deposits at the target Pro price and let conversion falsify the model. Spend saved time getting real deposits, not building panels.

**Order-of-asking rule (avoids anchoring bias):** establish value-at-stake and current spend FIRST; ask the price question LAST. Always corroborate any stated number with a revealed signal (deposit, win/loss) before trusting it, because stated WTP inflates, especially for a subscription.

**[FILL] Substitute anchor table** (illustrative structure only; no figures invented):

| Alternative | CapEx anchor (vs the KIT) | Recurring anchor (vs the subscription) |
|---|---|---|
| DIY float-switch + GSM relay | [FILL] (cheap, fragile) | [FILL] (replacements / SMS costs) |
| Davis & Shirtliff / Grundfos pump + controller install | [FILL] | [FILL] (service visits) |
| SunCulture solar-pump package | [FILL] | [FILL] |
| Manual meter reader / guard | n/a | [FILL] (wage x visits) |
| Doing nothing (status quo loss) | n/a | [FILL] (burnt pump x freq, lost crop, unbilled water, emergency trucking) |

## 3. The self-question bank (general, then per segment)

Answer in writing; re-answer as data arrives. These are the questions that turn guesses into a defensible estimate.

**General (ask for every estimate)**
- WTP disambiguation: when a prospect reacts to "230k", are they reacting to the KIT or the monthly? Re-ask every WTP signal twice: "what would you pay once to own this?" and "what would you pay every month to keep it running and watched?" Never average the two.
- Is the 230k an anchor I invented, or a number a real buyer has said yes to with a deposit? Until >=3 prospects have paid a deposit at or near it, it is a hypothesis, not a price.
- Razor/blades: of the ~230k, how much is cost-to-serve (floor) vs margin? Am I banking margin on the KIT, or seeding sites to earn on the recurring?
- Legibility test (rival hypothesis): can THIS buyer, unprompted, name the shillings they lose today (a burnt pump, a dry crop block, unbilled tenant water, an avoidable truck delivery)? If not, WTP collapses to convenience pricing regardless of true value-at-stake. Which hypothesis is winning per segment?
- Substitute anchor: what does the buyer's next-best option cost all-in (DIY float + GSM relay; a Davis & Shirtliff / Grundfos controller; a SunCulture package; doing nothing)? My price is read RELATIVE to that, not in a vacuum.
- Recurring substitute: what recurring cost does MajiFlow Cloud replace (meter-reader wage, guard time, repeat pump-burnout repair, emergency trucking)? That avoided cost is the honest recurring anchor.
- Subscription trust friction: will buyers here accept an open-ended monthly at all, or do I need annual prepay / bundled-first-year / "pay only while it's saving you money"? Recurring WTP here is as much about payment-model trust as the number.
- Walk-away asymmetry: at what monthly do prospects switch from "a bit pricey" (fine, near WTP) to "not worth it" (the real ceiling)? Am I logging which one I hear?
- Floor check: what is my fully-loaded cost-to-serve per site per month (cloud/MQTT, support time, alert delivery once SMS/WhatsApp ships)? Below this is a subsidy I must choose on purpose.
- Segment mix: are the three segments so different in value-at-stake that one base price is wrong? Should the flat SITE base stay flat with packs carrying the difference, or does a segment genuinely need a different base?
- Pack attach: for each value pack, which segment names a concrete shillings gain, and would they pay for it WITHOUT the base subscription? That separates real standalone value from base-bundling.
- Controller-count mix: what share of sites will be multi-controller? (Mechanically sets `base_ARPU` via the graduated brackets.) Answerable TODAY from `leads.estimate.controllers`.
- Which single metric, if it moved, would most change the business: pack-attach, multi-site share, churn, or KIT margin? Rank it so you know what to instrument first.

**farm** (segment = farm; note: `profile.vertical` farm/greenhouse map here)
- Value-at-stake: crop revenue per block protected from dry-run + pump-burn avoidance + irrigation labor saved. [FILL] KES/month per typical farm site.
- Legibility: can the grower name the shillings of a lost crop block or a burnt borehole pump? (`priority = dry_run`/`continuity` suggests yes.)
- Seasonality: how many months/year is a typical farm site actively running water vs dormant? Express ARPU as revenue-weighted active-months/12, not 12/12. This is the segment where dry-season dormancy is most dangerous.
- Substitute: float + GSM relay on the borehole; a Davis & Shirtliff borehole controller; a SunCulture solar package. [FILL] CapEx.
- Pack: Smart irrigation (`SEGMENT_PACKS.farm`, `fromMonthly` currently null). Does the grower name a yield/labor gain exceeding its price? [FILL]

**property** (segment = property; `vertical` residential/hotel/commercial map here)
- Value-at-stake: tenant water billing recovered + caretaker/guard time saved + amenity continuity (no dry taps for tenants). [FILL] KES/month per typical property.
- Legibility: this is the value-at-stake bullseye. Can the landlord name unbilled / under-recovered tenant water in shillings? If yes, tenant billing is a strong recurring anchor.
- Substitute: a meter reader's wage x visits; a guard checking tanks. [FILL] recurring anchor.
- Pack: Tenant billing (`SEGMENT_PACKS.property`, null). Would they pay for billing WITHOUT the base if they could? Attach rate here is the cleanest recurring-WTP readout once sites exist.
- Trust: landlords may prefer annual prepay; test framing, not just the number.

**water_supply** (segment = water_supply; `vertical` water_business maps here)
- Value-at-stake: litres sold x margin + meter-reader / collection cost replaced + downtime = lost sales. [FILL] KES/month per typical scheme/kiosk.
- Legibility: can the operator name lost sales per hour of downtime and shrinkage from unmetered draw? Steady-volume operators often can.
- Substitute: manual meter reading + collection; a Grundfos controller for the pump. [FILL].
- Pack: Metering & protection (`SEGMENT_PACKS.water_supply`, null). The metering hub is sold near-cost to UNLOCK this pack; the pack is where the margin is recovered. Does the operator name a shrinkage/uptime gain above its price? [FILL]
- Seasonality: typically the steadiest segment (least seasonal churn); good for predictable ARPU.

## 4. ARPU and unit-economics framework (definitions, decomposition, LTV/CAC, estimating when fresh)

**Framing.** The billing entity is the SITE, so every figure is per-site, not per-account (there is no account entity). ARPU here means per-site monthly recurring revenue (MRR), NOT the one-time KIT. Keep the two WTP numbers permanently separate (see section 1).

**ARPU decomposition (per site, per month):**

`ARPU_site = base_ARPU + pack_ARPU + addon_ARPU - discount`
- `base_ARPU = subscriptionMonthly(controllers)`: the graduated per-controller brackets (Lite 1st / Plus 2-4 / Pro 5-10 / Scale 11+, floored), marginal like tax brackets. This is MECHANICAL from the controller count, not a WTP guess. The only unknowns on this line are (a) the bracket rates (still PLACEHOLDER in `pricing.model.ts`: 2500/2000/1500/1000) and (b) the controller-count distribution (measurable today from `leads.estimate.controllers`, later from `sites`).
- `pack_ARPU = attach_rate x avg_pack_price`: where premium margin lives (tenant billing etc.). The metering hub is sold near-cost to UNLOCK packs. Decompose into the two levers so you can move each separately. `SEGMENT_PACKS.fromMonthly` is null today: setting these prices is the pack_ARPU lever.
- `addon_ARPU`: a-la-carte capability keys (`sites.addons`).
- `discount`: the gap from `sites.price_override` (bespoke deals) and bracket volume discounts.

Track blended ARPU AND per-segment ARPU (farm / property / water_supply) separately; WTP and pack-attach differ structurally by segment.

**LTV (do not use a single logo-churn number).** `LTV = (ARPU_site x gross_margin_%) x expected_paying_lifetime`, where lifetime is built from THREE distinct churns, not 1/logo-churn:
1. **logo/site churn** (site stops paying entirely);
2. **partial / contraction churn** (drops a pack, removes a controller, downgrades a bracket) and its mirror **expansion / NRR** (adds controllers as the site grows wider, adds packs);
3. **seasonal churn / dormancy** (farm idles in a dry/off-season; water_supply and property are steadier). Model seasonal as revenue-weighted active-months/year, NOT a binary; a farm gone quiet for a season is not necessarily churned but is not paying value either.

`NRR = (start_MRR - contraction - logo_churn + expansion) / start_MRR`. NRR > 100% on a small base is the single most important early signal that the per-site model compounds, and it is the whole thesis.

**CAC and payback.** Split CAC by channel AND by KIT type, because Self-Install (~55k) and Done-for-You Pro (~230-245k) have completely different sales motions and truck-roll costs. `CAC_payback_months = (CAC - KIT_margin_contribution) / (ARPU_site x gross_margin_%)`. Credit the KIT one-time margin FIRST: if the Pro KIT margin >= CAC + install, recurring revenue is payback-positive from month 1, and recurring-only math overstates payback. State this explicitly.

**Gross margin / cost-to-serve per site** (the denominator everything depends on, and the one most likely to be hand-waved while fresh): `cost_to_serve = cloud/hosting share + comms egress + support time + amortised Pro truck-rolls/warranty`. Email is ~free today, so comms egress is currently understated and WILL jump when SMS/WhatsApp ship (alerts-per-site x per-message price); a chatty site can become margin-negative. Mark egress as a known future cost, not zero. Fault rate from the runs ledger is the leading predictor of truck-roll cost. Without an honest gross-margin %, every LTV number is theatre.

**Estimating while fresh (assumption-driven ladder):** (1) write the formula; (2) plug a stated assumption with a source/rationale; (3) compute a range (pessimistic / base / optimistic); (4) replace each assumption with an actual the moment data arrives, leaving the old assumption struck through for audit. The `leads` snapshot already lets you compute the would-be `base_ARPU` distribution of demand (every lead carries controllers + monthly + segment) BEFORE a single sale: it is the best fresh proxy you have. Also ask: at what number of paying sites does fixed cloud/ops cost get covered (breakeven site count at assumed ARPU and margin)?

**[FILL when data arrives]**
- Bracket rates confirmed (the highest-leverage single edit, lives in `pricing.model.ts`): ___ , date ___
- `SEGMENT_PACKS.fromMonthly` per segment: farm ___ / property ___ / water_supply ___ , date ___
- Gross-margin % per site (base / optimistic / pessimistic): ___ , date ___
- Dormancy rule (e.g. >60d no runs = at-risk, >120d = dormant, cancellation = churned): ___ , date ___
- KIT margin contribution to CAC: ___ , date ___
- Realized ARPU (post-Paystack): ___ , date ___

## 5. The metrics dashboard to monitor

Leading = predicts the future; Lagging = confirms the past. "Measurable now" = chartable today from existing data; "Needs tracking" = waits on instrumentation. Do the cheap-now metrics first; defer billing/MRR-snapshot/egress instrumentation until there are enough paying sites for the numbers to be non-noise.

| Metric | Why it matters | Lead/Lag | Data source | Now vs needs tracking |
|---|---|---|---|---|
| Stated one-time WTP distribution | The KIT WTP appetite; histogram of quoted CapEx by segment + priority | Leading | `leads.estimate.oneTime` x `profile.vertical` / `profile.priority` | Measurable now |
| base_ARPU demand distribution | The would-be subscription MRR if leads buy; the best fresh ARPU proxy | Leading (now) / Lagging (later) | `leads.estimate.controllers` + `monthly`; later `subscriptionMonthly(sites.controllers)` | Now as demand proxy; actual needs billing job |
| Multi-controller / multi-site share (THE HINGE) | base_ARPU is graduated per controller, so the whole model bends on sites growing wider | Leading | `leads.estimate.controllers` distribution; `sites` count; `sites.owner` grouping for multi-site | Now (controllers); multi-site-per-owner needs repeat buyers |
| Conversion funnel by segment + source | Revenue signal + CAC input; which pains convert | Leading | `leads.status` (new/contacted/closed) + `convertedSiteId` + `profile.vertical` + `source` | Measurable now |
| Conversion / objection BY priority | Free legibility proxy: do nameable pains (`dry_run`/`continuity`) convert at higher price than diffuse (`waste`/`quality`/`labor`)? | Leading | `leads.estimate.profile.priority` x outcome | Now for conversion; objection needs new field |
| Quote outcome + verbatim objection | Separates KIT-resistance from monthly-resistance; your real demand curve | Leading | extend the lead pipeline (won/lost/stalled + objection note) | Needs tracking (add field beyond `status`) |
| Realized vs quoted price gap (leakage) | The discount truth-check; value-at-stake vs legibility | Lagging | join `sites.price_override` to originating lead via `leads.estimate.convertedSiteId` vs `estimate.monthly` | Measurable now the moment any lead converts |
| pack_ARPU = attach_rate x avg_pack_price | Premium-margin lever | Lagging | `sites.packs` x `packs.price_monthly` | Now from sites (near-zero while fresh); pack-INTENT on the lead form needs new field |
| addon_ARPU + discount | Recurring from addons minus override leakage | Lagging | `sites.addons`, `sites.price_override` | Now from sites |
| Blended & per-segment ARPU_site | The headline | Lagging | composed; segment via `sites.segment` | Needs billing job; estimate from leads meanwhile |
| Runs per active site / engagement intensity | Stickiness + expansion precursor; litres = water value delivered | Leading | runs ledger (idx_runs_site, `delivered_l`, `duration_s`); reuse `usage-rollup.ts` (currently per-route, add per-site) | Measurable now |
| Realized value-at-stake delivered | Turns the value-at-stake hypothesis into fact: litres moved + dry-run/faults caught per site/month | Leading | runs ledger `delivered_l` (= `end_litres - start_litres`), `stop_reason`, `fault` | Now; needs a small per-site monthly rollup |
| Seasonal dormancy / active-months ratio | Distinguishes dry-season dormancy from real churn | Leading | runs ledger `max(started_at)` per site, recency buckets | Measurable now (once sites run) |
| Fault / reliability rate per site | Predicts truck-roll cost + churn + warranty load | Leading | `runs.fault`, `runs.stop_reason` | Measurable now |
| NRR / expansion / contraction | The truest health signal; NRR > 100% = model compounds | Lagging | monthly per-site MRR snapshot diffed; cohort start = `commence_date` | Needs tracking (no MRR history table; sites is current-state only) |
| Site / logo churn rate | Sites that cancel | Lagging | a paying/cancelled state | Needs tracking (no payment state; Paystack manual) |
| Comms egress per site (future) | Variable cost that scales with chattiness; a noisy site can go margin-negative | Leading (cost) | per-site send-counter x provider price | Needs tracking (email-only today, ~0; will jump) |
| Gross margin % / cost-to-serve per site | The LTV denominator | Lagging | cloud bill / site count + support-time log + truck-roll log + future egress | Needs tracking (manual support + truck-roll log) |
| CAC by channel + KIT type | Acquisition efficiency | Lagging | `leads.source` (funnel) + manual spend log; Pro CAC must include install labour | Now (funnel); spend log needs tracking |
| CAC-payback months | Health of the motion (credit KIT margin first) | Lagging | composed | Cheap once inputs exist |
| LTV and LTV:CAC | The bottom line | Lagging | composed from ARPU, margin, three-part churn | Gated on churn data |
| Breakeven site count | When fixed cloud/ops is covered | Lagging | fixed cost / (ARPU x margin) | Estimate now; actual needs margin data |

**Reusable building blocks already in the codebase:** `usage-rollup.ts` and the `/usage` facade aggregate runs by route (extend to per-site for engagement, dormancy, delivered-litres); `idx_runs_site` makes per-site/period queries cheap; `leads.estimate.convertedSiteId` already links a converted site back to its quote (no schema work for the leakage join).

## 6. Review cadence and what to revisit as data arrives

**Cadence (solo-founder realistic):**
- **Per quote (continuous):** log outcome + verbatim objection + whether resistance was to the KIT or the monthly. This is your living WTP meter until billing exists; near-zero effort, compounding value.
- **Weekly:** glance at the leads funnel (conversion by segment / source / priority) and, once sites run, the runs-ledger dormancy + fault buckets.
- **Monthly:** refresh the would-be `base_ARPU` distribution from leads; review realized-vs-quoted leakage on any conversions; re-rank the "which metric moves the business most" question.
- **Quarterly / on milestone:** re-run the value-at-stake interviews if a segment is converting oddly; revisit the bracket rates and pack prices in `pricing.model.ts`.

**Milestone triggers (flip estimates to actuals when these land):**
- **~20 leads:** start the cross-tabs (oneTime + conversion by `segment` and `profile.priority`). First read on the legibility hypothesis.
- **First deposit at the target Pro price:** the 230k stops being an anchor and becomes a (revealed) data point. Track deposit-conversion rate.
- **First conversions (sites exist):** compute realized-vs-quoted via the `convertedSiteId` link; start per-site engagement, dormancy, and fault rollups.
- **Bracket rates / pack prices confirmed:** edit `pricing.model.ts` (one file), remove keys from `PROVISIONAL_PRICES` as they firm up, and version the change. This is the highest-leverage pricing decision.
- **Paystack receipts + a billing rollup:** realized ARPU, pack attach rate, logo + revenue churn RETIRE the modeled estimates. Add at minimum a manual payment-reconciliation log.
- **Monthly per-site MRR snapshot table (cron):** unlocks NRR / expansion / contraction; key it off `commence_date` cohorts.
- **SMS/WhatsApp ships:** add a per-site send-counter; recompute cost-to-serve with real egress. Note: the recurring base WTP you measure on an email-only product is a FLOOR, not the ceiling, because in Kenya the protection value is largely realized via SMS/WhatsApp reach. Do not under-price the subscription permanently based on email-only.

**Maintenance discipline (so the doc stays living, not stale):**
- Mark every assumption with a fill-in date and a source/rationale; strike through superseded assumptions rather than silently overwriting (keeps an audit trail).
- Never let a [FILL] placeholder calcify into a "known" KES number; every price is provisional until a real buyer pays it or a real competitor quotes it.
- Keep the two WTP numbers separate forever; keep segment as a first-class reporting axis (ARPU, attach, churn, dormancy all per segment).
- Watch the `vertical` vs `segment` mapping: leads carry a 7-value `profile.vertical` (residential / small_business / farm / hotel / greenhouse / commercial / water_business) while sites/packs use the 3-value `segment` (farm / property / water_supply). Define and document the rollup map once so cross-tabs line up, and revisit it if conversion patterns suggest the buckets are wrong.
- TODO backlog (instrumentation, in cheap-first order): (1) lead outcome + objection field; (2) per-site runs rollup (litres / faults / recency); (3) deposit capture via Paystack; (4) manual payment-reconciliation log; (5) monthly MRR snapshot cron; (6) per-site comms send-counter when messaging ships; (7) support-time + truck-roll log.
