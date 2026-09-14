# Community impact and comparable-care travel: approved product requirements

Recorded September 14, 2026. Status: agreed research and engineering specification; not an implemented map or a verified impact dataset. No distances, affected populations, or closure probabilities are asserted here.

## User experience

Add a **View community impact** button to each hospital card. It opens a hypothetical closure scenario with a map of nearby communities, the selected hospital, and candidate alternative hospitals. Begin with Paul B. Hall / Paintsville ARH and emergency care; expand after the first scenario is verified.

Let the user select a care service. Emergency care, maternity, surgery and inpatient care must be assessed separately. A facility offering some emergency services is not automatically equivalent in trauma, pediatric or other specialist capability. Define required capabilities before selecting alternatives.

For each community show:

| Field | Meaning |
| --- | --- |
| Community and starting point | Named community, stable geographic ID and explicitly sourced representative origin |
| Current route | Road miles and modeled minutes to the selected hospital |
| Candidate alternative | Nearest reachable verified qualifying facility by road distance, with relevant service evidence |
| Alternative route | Road miles and modeled minutes from the same community origin to the candidate |
| Additional travel | Alternative route minus current route, separately for miles and minutes |
| Access change | Whether removal worsens the community's best available access to qualifying care |
| Verification | Service verification date, route-data date, sources, and uncertainties |

Clicking a community shows its routes and supporting evidence. Explain that a representative origin is not every resident's home. No home addresses or patient information are collected. If the nearest-by-miles option differs from the fastest modeled option, distinguish the two.

## Two comparisons that must remain distinct

1. **Travel relative to the selected hospital:** compare the selected hospital with its nearest qualifying alternative from each community. Preserve negative differences; an alternative may already be closer. This does not establish that residents used the selected hospital.
2. **Change in geographic access:** calculate the best reachable qualifying facility before removal and after removal using the same candidate universe and routing assumptions. A community whose best option is unchanged should not be labeled newly affected solely because it is nearby.

Use a disclosed study boundary and consider qualifying hospitals across county and state borders. Do not truncate candidate searches at the county boundary. Describe any search-radius limit. No route found means unknown/unreachable under the model, not zero miles.

## Map and population requirements

Show modeled travel changes using a legend, with verified facts, calculated results, unknown coverage and illustrative scenarios visually distinct. Until route and service evidence is ready, show **Illustrative closure scenario—impact not yet calculated** instead of numeric mock results presented as facts.

Use sourced Census geographic units for population overlays and avoid double counting overlapping areas. Record estimate year and margins of error where applicable. A representative-point classification describes an approximation; do not imply every resident in a polygon has the same journey. County population is not a hospital's service population. Show poverty, older residents and households without vehicles as separate community context with correct denominators, not components of an unsupported distress label.

Any label such as newly underserved requires a declared service-specific access threshold, baseline and method. Otherwise use the narrower description **modeled increase in travel to qualifying care**. Do not infer clinical outcomes or emergency-response times from ordinary driving routes.

## Proposed engineering handoff fields

Each community/service/scenario row should retain:

- scenario_id, selected_hospital_id, selected_hospital_ccn, care_service, required_capabilities;
- community_id, community_name, geography_type, geography_vintage;
- origin_latitude, origin_longitude, origin_method, origin_source_url, location_uncertainty;
- candidate_hospital_id, candidate_ccn, candidate_name, service_status, service_source_url, service_verified_at;
- selected_hospital_road_miles, selected_hospital_drive_minutes;
- candidate_road_miles, candidate_drive_minutes, additional_miles, additional_minutes;
- baseline_best_hospital_id, baseline_best_minutes, after_closure_best_hospital_id, after_closure_best_minutes, access_change_minutes;
- routing_engine, routing_profile, network_vintage, route_calculated_at, route_status, study_boundary, candidate_search_limit;
- population_estimate, population_year, population_margin_of_error, population_source_url, population_assignment_method;
- source_url, reporting_period, publication_date_if_known, accessed_at, observation_scope, limitations, value_type.

Keep a separate source table for multiple citations per observation; value_type distinguishes verified observation, calculation and mock demonstration. Store unknown values as null, not zero. Preserve formulas and routing parameters so results can be reproduced.

## Research and acceptance criteria

Use only free public sources. Research leads to verify include official hospital service publications, Kentucky facility records, CMS facility identifiers, Census geography and aggregate demographics, and a road network/routing method with suitable public-use terms. These are collection targets, not completed service or route verification.

Research owns identity matching, service-equivalence rules, source evidence and interpretation. Engineering owns the interactive map, routing and scenario implementation. Candidate proximity does not establish capacity, bed availability, insurance acceptance or ability to absorb displaced demand.

Before publishing a calculated first case:

1. Verify selected and candidate facilities and relevant capabilities with dates.
2. Document community origins and population geography, including uncertainty.
3. Calculate road routes using the same network and travel profile; never label straight-line distance as road miles.
4. Check alternatives across administrative borders and distinguish shortest distance from shortest time.
5. Validate the no-change case, closer-alternative case, unavailable-service case and unreachable-route case.
6. Expose evidence and methodology alongside results; display **Candidate alternative; capacity and appointment availability are not confirmed.**

This feature assesses a hypothetical change in geographic access. It does not predict closure, establish a hospital catchment population, or demonstrate patient displacement.
