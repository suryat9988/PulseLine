import { useEffect } from "react";
import { scoringConfig } from "../../../lib/scoring-config.ts";
import { SCORE_NOT, rubricBands } from "../../../lib/score-rubric.ts";
import { ScoreRubricPanel } from "../score/ScoreRubric.tsx";
import type { HospitalView } from "../../types.ts";

export function AboutPulseLine({
  hospitalView = null,
}: {
  hospitalView?: HospitalView | null;
}) {
  const bands = rubricBands();
  const factors = Object.values(scoringConfig.factors);

  useEffect(() => {
    function scrollToHash() {
      const id = window.location.hash.replace("#", "");
      if (id.startsWith("about")) {
        document.getElementById(id)?.scrollIntoView({ block: "start" });
      }
    }
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  return (
    <article className="about-page" id="about">
      <header className="about-hero">
        <p className="label">About PulseLine</p>
        <h1>See what a hospital’s public finances actually changed — without inventing a forecast.</h1>
        <p className="mission">Because we believe your ZIP code should not determine the quality of care you receive.</p>
        <p>
          Rural hospitals can look doomed or fine depending on which year you open. PulseLine lets a reviewer pick one
          hospital, read the published record, and try a labeled what-if.
        </p>
        <p>
          <a href="#hospitals">Open Explorer</a>
        </p>
      </header>

      <section id="about-what">
        <h2>What PulseLine does</h2>
        <p>
          PulseLine helps a reviewer search an area, choose one hospital, read historical CMS financial indicators, and
          test transparent operating assumptions. It also keeps sourced events and evidence gaps in view.
        </p>
      </section>

      <section id="about-who">
        <h2>Who it helps and why</h2>
        <p>
          Healthcare M&amp;A and strategy teams can use PulseLine to review historical hospital financial indicators,
          explore operating assumptions, and identify evidence gaps for deeper diligence.
        </p>
        <p className="tiny">
          This is a product hypothesis, not a validated customer requirement. PulseLine is not a valuation platform, deal
          recommendation engine, or substitute for professional diligence.
        </p>
      </section>

      <section id="about-limits">
        <h2>Limitations</h2>
        <ul>
          <li>Public data may be incomplete or old. Historical reports do not describe current conditions.</li>
          <li>Missing financials stay missing. They are not treated as zero.</li>
          <li>Parent events are not automatically facility events. A property sale is not a verified provider CHOW.</li>
          <li>Acquisition is not proof of distress. Unknown outcomes do not mean no events occurred.</li>
          <li>County community statistics are not hospital staffing.</li>
          <li>Street coordinates are unverified. PulseLine does not geocode at runtime or place fabricated markers.</li>
          <li>The current dataset is five hospitals, not Kentucky-wide coverage.</li>
        </ul>
      </section>

      <section id="about-scoring">
        <h2>Scoring methodology</h2>
        <p className="tiny">
          Thresholds and weights are experimental assumptions. The displayed total uses the unrounded calculation, then
          rounds once.
        </p>
        <p className="tiny">{SCORE_NOT}</p>
        <details>
          <summary>Bands, factors, and reconstruction rules</summary>
          <h3>Concern-category boundaries</h3>
          <ul>
            {bands.map((band) => (
              <li key={band.label}>
                {band.label}: {band.min}–{band.max}
              </li>
            ))}
            <li>Insufficient data: no factor could be scored. That is not Stable.</li>
          </ul>
          <h3>Factors</h3>
          <ul className="about-factors">
            {factors.map((factor) => (
              <li key={factor.id}>
                <strong>{factor.label}</strong>
                <p className="tiny">{factor.formula}</p>
                <p className="tiny">
                  Base weight {factor.weight.toFixed(2)} · {factor.direction === "lower_is_riskier" ? "Lower values raise concern" : "Higher values raise concern"} ·
                  Healthy {factor.healthy} · Concern {factor.concern}
                </p>
              </li>
            ))}
          </ul>
          <p className="tiny">{scoringConfig.rounding}</p>
          <p className="tiny">
            When a factor is missing or uninterpretable, it is excluded and remaining base weights are renormalized. Do not
            add already-rounded contribution labels to reconstruct the total.
          </p>
        </details>
        {hospitalView ? (
          <div className="about-hospital-rubric">
            <h3>Contribution for {hospitalView.hospital.name}</h3>
            <ScoreRubricPanel result={hospitalView.financial} />
          </div>
        ) : (
          <p className="tiny">Open a hospital and use How calculated to see that hospital’s contribution breakdown here.</p>
        )}
      </section>

      <section id="about-sources">
        <h2>Data sources and coverage</h2>
        <ul>
          <li>Hospital-year financials: CMS hospital cost reports in the research pack.</li>
          <li>Events and research cases: PulseLine evidence ledger.</li>
          <li>County outlines: U.S. Census Bureau cartographic county boundaries, public domain.</li>
          <li>ZIP codes are facility postal strings. Census ZCTA polygons are not bundled and are not invented.</li>
        </ul>
      </section>

      <section id="about-mission">
        <h2>Mission</h2>
        <p className="mission">Because we believe your ZIP code should not determine the quality of care you receive.</p>
      </section>
    </article>
  );
}
