# PulseLine

Experimental hospital financial-review tool for healthcare M&A and strategy work.

Current product hypothesis (not a validated customer requirement):

**Help a reviewer choose one hospital, understand its historical financial condition, and explore transparent operating scenarios.**

Primary workflow: Choose hospital → Understand financials → Explore scenarios → Investigate evidence gaps.

Financial analysis is the main product. PulseLine Ask and the experimental concern score support it. PulseLine is not a valuation platform, deal recommendation engine, or substitute for professional diligence.

The About page keeps the mission:

> Because we believe your ZIP code should not determine the quality of care you receive.

Community-access context remains available. It is not a hospital staffing measure and does not prove that a transaction improves or harms access unless a sourced record says so.

## How to use PulseLine

1. Search a hospital, city, county, or facility ZIP. The matching Kentucky area is highlighted when a county outline is available.
2. Browse matching hospital cards with arrows, keyboard, or swipe. Browsing does not open financials.
3. Choose **View financials** to open that hospital’s workspace below the cards.
4. Read **What changed?** for the selected fiscal report versus the immediately preceding available report. Use **Financial view** for one large chart at a time, then Scenarios, Evidence, and Ask.
5. Open **About PulseLine** for methodology, sources, limitations, and the scoring rubric.

Research cases without financials show **Financial data pending**. They keep sourced events. They do not receive change cards, a score, charts, or an enabled scenario model.

“No matching hospitals in PulseLine” does not mean no hospitals exist there. ZIP searches use facility postal ZIP strings. PulseLine does not draw Census ZCTA polygons and does not invent missing boundaries or coordinates.

## Financial definitions

Single source of truth: `lib/finance`. Display, charts, statements, the What changed? brief, and Ask explanations reuse these definitions.

| Measure | Origin | Construction | Not |
| --- | --- | --- | --- |
| Net patient revenue | Source | CMS Net Patient Revenue | Not total hospital revenue |
| Patient-service expenses | Source | CMS Less Total Operating Expense | Not a validated overall operating-cost total |
| Published patient-service result | Source | CMS Net Income from Service to Patients | Not overall operating income, net income, or cash flow |
| Derived patient-service balance | Calculated | NPR − Less Total Operating Expense | Not cash flow. Shown separately from the published result |
| Patient-service result | Calculated | Published result / NPR | Not a validated overall operating margin |
| Total assets / liabilities | Source | CMS totals | Negative published values are preserved |
| Cash | Source | CMS Cash on Hand and in Banks | Not a cash-runway estimate |
| Current ratio | Calculated | Current assets / current liabilities | Excluded if current liabilities ≤ 0 |
| Liabilities / assets | Calculated | Total liabilities / total assets | Excluded if assets ≤ 0 or liabilities are uninterpretable |
| Inpatient utilization | Calculated | Total Days / Total Bed Days Available | Operational only, not a financial result |

Missing values stay missing. They are not shown as zero. If the published patient-service result differs from the derived subtraction, both are shown. PulseLine does not overwrite one with the other.

## What changed? comparison rules

The visual brief and the Ask question “What changed between these reports?” use the same structured result from `whatChangedBrief`.

- Compare the selected fiscal report with the immediately preceding available report by fiscal-end date. Both periods are always shown. PulseLine does not skip to a different report merely to produce a change.
- Before a growth rate is shown, PulseLine checks measure definitions and units, period duration, overlapping periods, duplicate/revised CMS report record ids, entity scope, and existing validity/exclusion rules.
- Each comparison has an explicit state: **Comparable** (required checks passed), **Limited** (required evidence is missing, including unknown scope or missing period length), or **Incompatible** (known facility-versus-parent scope difference, overlapping or duplicate reports, or period lengths that differ by more than 30 days).
- Known facility-versus-parent scope differences block same-entity growth claims. Missing period lengths are never described as verified or “within 30 days.”
- Unknown consolidation scope stays visible. Figures can still be viewed retrospectively. PulseLine does not present that as verified same-entity growth.
- Percentage change is used only for appropriate values with a valid **positive** baseline. Percentage-point change is used for percentage measures. Ratio-point change is used for ratios. Absolute change is shown when a percentage would mislead.
- PulseLine does not calculate percentage growth from a missing, zero, or negative baseline. Missing values and negative published values are preserved. They are not turned into zero.
- Reports are not annualized, interpolated, or invented to enable a comparison.
- Revenue versus expense growth compares **growth rates**, not which dollar change is larger.
- Default cards follow a documented editorial order and data availability, not a severity or “most material” model: (1) revenue and patient-service expense growth, (2) supported patient-service result or an explicitly derived balance, (3) liquidity, (4) assets/liabilities, (5) operational utilization, labeled operational. Correlated restatements are not shown as three separate default cards.
- Patient-service result is not treated as overall operating margin. Net patient revenue is not total revenue. Fiscal periods are not CMS file-cohort years.
- Copy stays factual. PulseLine does not say a hospital is failing, will be acquired, or that financial pressure will increase.
- Research cases without financials show **Financial data pending** and do not generate change cards, scores, or comparisons.
- A 10% year-to-year display cue is an exploratory PulseLine rule, not a materiality, audit, or credit threshold.

Fiscal-end age is not a source publication date or an access date. Unknown publication dates limit point-in-time historical claims. They do not automatically prevent clearly labeled retrospective viewing.

## Peer comparison (not implemented)

PulseLine does not show peer medians, percentiles, “unusual versus peers,” or automatic peer matching. The Paul B. Hall–Morgan pairing is a proposed research comparison, not an established matched cohort.

A future comparison would still need, at minimum:

- Verified identities for every hospital in the set
- Comparable measure definitions, units, and fiscal periods
- Documented matching factors such as size, ownership, rural or CAH status, and other relevant attributes
- Sample-size and selection rules
- Consistent source availability for the same fields and vintages

Unavailable peer inputs must not be filled with invented medians.

## Operating scenario model

Question: how would the simplified patient-service balance change under different revenue and expense assumptions?

- `scenarioRevenue = baselineRevenue × (1 + revenueChangePct / 100)`
- `scenarioExpenses = baselineExpenses × (1 + expenseChangePct / 100)`
- `baselineBalance = baselineRevenue − baselineExpenses`
- `scenarioBalance = scenarioRevenue − scenarioExpenses`
- `balanceChange = scenarioBalance − baselineBalance`

Also shown: revenue needed to equal scenario expenses, and the required change from baseline revenue when the denominator is usable.

The output is a simplified patient-service scenario. It is not overall operating profit, net income, cash flow, or a forecast. Inputs are clamped from −95% to +400%. Those bounds are validation limits, not economically probable ranges. The model is disabled when financials are pending, when baseline fields are missing, or when the published result does not reconcile with the subtraction. Changing hospitals or reports resets assumptions. Scenario changes never write back to historical records, scores, or event classifications.

## Stage 2: valuation readiness (not implemented)

A future valuation feature would still need, at minimum:

- Reconciled entity and transaction scope
- Appropriate earnings or cash-flow measures
- Debt and cash that can be used in a valuation identity
- Capital expenditure and working-capital information
- Explicit assumptions and a stated valuation basis
- Credible comparable transactions if using transaction multiples

Unavailable inputs must not be treated as zero. PulseLine does not generate enterprise values, equity values, purchase-price estimates, deal-attractiveness scores, or acquisition recommendations.

## Current architecture

1. Financial research pack (`research/PulseLine_three_hospital_data.json`, evidence, dictionary, event log).
2. Financial adapter (`lib/adapt-research.ts`) converts 12 hospital-year reports, preserving original CMS strings, report record IDs, file cohorts, fiscal dates, publication dates when present, and nulls.
3. Extract validation (`lib/validate-extract.ts`) runs before normalize/score.
4. Financial definitions (`lib/finance`) for measures, comparability, statements, period age, and the What changed? brief.
5. Scoring (`lib/score-financial.ts`, `lib/scoring-config.ts`). Thresholds and weights were not changed. The score is secondary in the workspace.
6. Evidence ledger (`research/PulseLine_expanded_evidence_v1.json`) through `lib/adapt-evidence.ts`.
7. Search-first explorer: area search, Kentucky county map, hospital cards, then an inline financial workspace.
8. Workspace tabs: Overview, Financials, Scenarios, Evidence, Ask. One large financial view at a time.
9. PulseLine Ask (`lib/ask`, `src/ui/ask`) answers hospital-scoped questions. Valuation and acquire/for-sale questions are declined.

The production interface does not include invented hospitals or fake scores. Isolated scale tests used 120 development fixtures (`tests/fixtures/explorer-scale.ts`) and are not shown in the app.

## Hospitals

Scored hospitals:

- Breckinridge Memorial Hospital (`KY-LIC-600070`, CCN `181319`)
- Morgan County ARH Hospital (`KY-LIC-600058`, CCN `181307`)
- Kentucky River Medical Center (`KY-LIC-100620`, historical CCN `180139`, current CCN `181334`)

Research cases, financial coverage pending (no invented CCN, license, financials, score, or reassuring status):

- Highlands Regional Medical Center / Highlands ARH (`case_highlands`)
- Paul B. Hall Regional Medical Center / Paintsville ARH (`case_paul_b_hall`)

## Scoring methodology

Configurable in `lib/scoring-config.ts`. Shown beside the secondary concern score as “How this score is calculated.”

| Factor | Construction | Notes |
| --- | --- | --- |
| Operating margin | not calculated | Patient-care result is not a validated overall operating margin |
| Patient-service expense pressure | Less Total Operating Expense / Net Patient Revenue | Supported derived ratio; invalid if revenue ≤ 0 |
| Liabilities / assets | Total Liabilities / Total Assets | Excluded if liabilities or assets are uninterpretable |
| Current ratio | Total Current Assets / Total Current Liabilities | Excluded if current liabilities ≤ 0 |
| Cash / liquidity | Cash on Hand and in Banks / Less Total Operating Expense | Negative cash is preserved and excluded from the ratio |
| Patient volume | Total Days / Total Bed Days Available | CMS fiscal report only |

If no factor can be scored, score is null and status is **Insufficient data**. The rubric is generated from the same configuration used by the calculation. The score is not enterprise value, creditworthiness, acquisition attractiveness, or a recommendation to transact.

## Structural events

Shown on Evidence, separate from financials.

- Highlands acquisition (2019-08-01) and rename share one event group.
- Paul B. Hall acquisition (effective 2021-12-01; announcement 2021-09-23) and rename share one event group.
- Kentucky River September 2021 property sale is a property transaction, not a verified provider CHOW.
- Quorum April 2020 bankruptcy and July 2020 emergence are parent events, not a verified Kentucky River hospital bankruptcy.

A blank event log does not mean no events occurred.

## Geography

- County polygons: simplified U.S. Census Bureau cartographic county boundaries (public domain U.S. government work), Kentucky extract in `data/geo/ky-counties.json`.
- Search can highlight a sourced county outline and fit the map to that county. City searches highlight the documented county when known; they do not draw city limits.
- ZIP codes are facility postal strings, not Census ZCTA polygons. PulseLine does not invent a ZIP-area outline. The UI labels that limitation as “ZIP area outline unavailable.”
- Research-pack latitude and longitude are null. PulseLine does not place a fabricated hospital marker, does not geocode at runtime, and does not request visitor location.
- Kentucky River’s 400 Jett Drive vs 540 Jett Drive discrepancy is preserved in evidence details.

## PulseLine Ask

Ask is a supporting, hospital-specific helper. Suggested questions, free-text lookup, follow-ups, copy, and answer-only PDF export work without downloading a model. Facts, arithmetic, periods, hospital identity, and comparison statements are produced by application code. Free-form model text is not shown. If the optional on-device helper runs, PulseLine accepts only an approved structured choice and renders a trusted template. Any other output is discarded and the deterministic answer is kept. Copied answers and PDF exports follow the same rule. Cards label whether generative AI ran.

If a device cannot run the optional model, Ask continues as **data lookup**. Conversations are scoped to the selected hospital, can be cleared, and are not persisted after the tab is closed.

Answer PDFs are generated in the browser as **evidence notes**, not a completed diligence assessment. They include only completed, selected answers: hospital, periods, sources, limitations, scenario assumptions and computed values when present, export date, and an experimental-use note.

## On-device model

Default helper: **Llama 3.2 1B Instruct**, 4-bit MLC build `Llama-3.2-1B-Instruct-q4f16_1-MLC`.

| Topic | Detail |
| --- | --- |
| Runtime | [WebLLM](https://github.com/mlc-ai/web-llm) (`@mlc-ai/web-llm`), Apache-2.0 |
| Download | Official MLC size is about 700 MB. Optional; cancelled loads leave Ask on data lookup |
| Hardware | WebGPU (Chrome / Edge 113+). No mobile-performance claim until physically tested |
| Privacy | Inference stays on the visitor device. Questions are not sent to a remote model API |

## Limitations

- Revised CMS CSV publication dates are often unverified (`publication_date` null).
- Reporting-entity vs parent consolidation is not independently reconciled.
- Kentucky River CCN transition effective date is unknown.
- Event-time CCNs and legal-entity crosswalks are unresolved for the research cohort.
- A null publication date cannot establish pre-event availability.
- Outcomes stay unknown unless a sourced event says otherwise.
- Workforce / NPPES, five-domain research, pre-event panels, and matched controls are pending.
- Peer matching, peer medians, and “unusual versus peers” are not implemented.
- Hospital street coordinates are unverified.
- Research-case ZIP codes are not in the current ledger.
- The current dataset is five hospitals, not Kentucky-wide coverage.

## Browser support and GitHub Pages

Landing, selector, map, workspace, charts, statements, What-if, Ask data lookup, and PDF export: current Chrome, Edge, Firefox, and Safari with JavaScript enabled. Viewport checks in development are not a substitute for a physical phone.

Build with `PAGES_BASE=/PulseLine/` and publish the `dist/` folder. No server, database, account, or secret API key is required.

## How to run locally

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
npm run dev
```

## CMS financial updates

The dashboard uses the validated CMS snapshot for five reviewed hospitals. See [automatic refresh setup and evidence limitations](research/PulseLine_CMS_refresh.md) for daily updates, activation, and failure handling.

## Community impact proposal

See the [community-impact map and comparable-care travel requirements](research/PulseLine_community_impact_proposal.md) for the approved closure-scenario research handoff, including per-community road miles, additional travel and verification requirements. This is a specification; the map and route estimates are not implemented yet.
