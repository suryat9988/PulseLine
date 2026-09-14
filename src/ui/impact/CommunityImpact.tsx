import { useEffect, useRef, useState } from "react";
import type { ExplorerHospital } from "../../../lib/explorer/index.ts";
import { areaFromCounty, allKentuckyArea } from "../../../lib/explorer/search.ts";
import { KentuckyMap } from "../map/KentuckyMap.tsx";

const SERVICES = ["Emergency care", "Maternity", "Surgery", "Inpatient care"];

/** Geographic exploration only until verified route and service observations are available. */
export function CommunityImpact({ hospital, onClose }: { hospital: ExplorerHospital; onClose: () => void }) {
  const [service, setService] = useState(SERVICES[0]);
  const [communities, setCommunities] = useState<{ fips: string; name: string }[]>(
    hospital.countyFips && hospital.county ? [{ fips: hospital.countyFips, name: hospital.county }] : [],
  );
  const [area, setArea] = useState(() => hospital.countyFips && hospital.county
    ? areaFromCounty(hospital.countyFips, hospital.county) : allKentuckyArea());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  function addCounty(fips: string, name: string) {
    setArea(areaFromCounty(fips, name));
    setCommunities((previous) => previous.some((item) => item.fips === fips) ? previous : [...previous, { fips, name }]);
  }

  return <section className="community-impact" aria-labelledby="impact-title">
    <div className="results-list-head">
      <h2 id="impact-title" ref={heading} tabIndex={-1}>Community impact if this hospital closes</h2>
      <button type="button" className="chip" onClick={onClose}>Close community impact</button>
    </div>
    <h3>{hospital.name}</h3>
    <p className="impact-notice">Illustrative closure scenario—impact not yet calculated.</p>
    <p>Explore areas to assess for access to care. This scenario does not predict that the hospital will close.</p>
    <label className="impact-service">Care to compare
      <select value={service} onChange={(event) => setService(event.target.value)}>
        {SERVICES.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
    <p>Select counties on the map to add them to the assessment below. County boundaries are geographic context, not verified hospital service areas or affected communities.</p>
    <KentuckyMap hospitals={[hospital]} area={area} mapFocus={area.kind === "all" ? "kentucky" : "area"}
      selectedHospitalId={hospital.hospitalId} onSelectCounty={addCounty} onShowAll={() => setArea(allKentuckyArea())} />
    <p className="tiny">Map highlight: selected area to investigate. It does not indicate a measured loss of care. Verified hospital coordinates and community origins are not yet available for this scenario.</p>
    <h3>{service}: community travel assessment</h3>
    <p>Each county is a starting area for research. Named communities and sourced representative starting points must be added before calculating routes.</p>
    <div className="impact-table-wrap">
      <table className="impact-table">
        <caption>Road miles and comparable-care verification by selected area</caption>
        <thead><tr><th scope="col">Area / community origin</th><th scope="col">Candidate alternative</th><th scope="col">Road miles to alternative</th><th scope="col">Additional miles</th><th scope="col">Drive time</th><th scope="col">Service verification</th><th scope="col">Manage</th></tr></thead>
        <tbody>{communities.map((community) => <tr key={community.fips}>
          <th scope="row">{community.name} County<br /><small>Community origin not yet verified</small></th>
          <td>Not yet verified</td><td>Not calculated</td><td>Not calculated</td><td>Not calculated</td><td>{service}: not yet verified</td>
          <td><button type="button" className="text-link" aria-label={`Remove ${community.name} County`} onClick={() => setCommunities((items) => items.filter((item) => item.fips !== community.fips))}>Remove</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    {!communities.length && <p>Select a county on the map to begin.</p>}
    <details><summary>How distances and affected areas will be assessed</summary>
      <ul>
        <li>Road miles start from a sourced representative community location, not every resident’s home. Straight-line distances are not substituted for driving routes.</li>
        <li>Additional miles compare the alternative route with the route to this hospital from the same origin. The closest qualifying alternative may already be closer.</li>
        <li>Assess best available access before and after removal. Nearby areas are not automatically affected. Include qualifying options across county and state borders.</li>
        <li>Verify the selected service and relevant capabilities at each alternative. The five hospitals in this financial sample are not a complete alternative-care directory.</li>
        <li>Candidate alternative; capacity and appointment availability are not confirmed.</li>
        <li>Population impact remains unknown until routes, geographic coverage and population sources are verified. County population is not a hospital’s service population.</li>
      </ul>
    </details>
  </section>;
}
