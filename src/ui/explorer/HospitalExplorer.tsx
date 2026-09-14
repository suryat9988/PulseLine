import { CommunityImpact } from "../impact/CommunityImpact.tsx";
import { useMemo, useState } from "react";
import {
  DATASET_SCOPE_NOTE,
  FILTER_LOCATION_HELP,
  NO_MATCHING_HOSPITALS,
  NO_MATCHING_HOSPITALS_NOTE,
  allKentuckyArea,
  areaFromCounty,
  areaFromSuggestion,
  clampIndex,
  filterExplorerHospitals,
  filtersForArea,
  hospitalMatchesArea,
  type ExplorerHospital,
} from "../../../lib/explorer/index.ts";
import { KY_COUNTIES, KY_COUNTY_NAMES, KentuckyMap } from "../map/KentuckyMap.tsx";
import { AreaSearch } from "./AreaSearch.tsx";
import { HospitalCards, ResultsList, type HospitalCardModel } from "./HospitalCards.tsx";

export function HospitalExplorer({
  hospitals,
  snapshots,
  selectedId,
  onViewFinancials,
}: {
  hospitals: ExplorerHospital[];
  snapshots: Record<string, Omit<HospitalCardModel, "hospital">>;
  selectedId: string | null;
  onViewFinancials: (hospitalId: string) => void;
}) {
  const [impactId, setImpactId] = useState<string | null>(null);
  const impactHospital = hospitals.find((hospital) => hospital.hospitalId === impactId);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState(allKentuckyArea);
  const [mapFocus, setMapFocus] = useState<"kentucky" | "area" | "hospital">("kentucky");
  const [visibleIndex, setVisibleIndex] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const result = useMemo(() => {
    const filtered = filterExplorerHospitals(hospitals, filtersForArea(area), KY_COUNTY_NAMES);
    const items = filtered.items.filter((hospital) => hospitalMatchesArea(hospital, area));
    return { ...filtered, items, matchCount: items.length, emptyReason: items.length === 0 ? "no_matches" as const : "none" as const };
  }, [hospitals, area]);

  const cards = useMemo<HospitalCardModel[]>(
    () =>
      result.items.map((hospital) => ({
        hospital,
        netPatientRevenue: snapshots[hospital.hospitalId]?.netPatientRevenue ?? null,
        expenses: snapshots[hospital.hospitalId]?.expenses ?? null,
        cash: snapshots[hospital.hospitalId]?.cash ?? null,
      })),
    [result.items, snapshots],
  );
  const index = clampIndex(visibleIndex, cards.length);

  function chooseArea(next: ReturnType<typeof allKentuckyArea>, focus: "kentucky" | "area" = "area") {
    setArea(next);
    setMapFocus(next.kind === "all" ? "kentucky" : focus);
    setVisibleIndex(0);
    setListOpen(false);
  }

  function viewHospital(hospitalId: string) {
    const nextIndex = result.items.findIndex((item) => item.hospitalId === hospitalId);
    if (nextIndex >= 0) setVisibleIndex(nextIndex);
    setMapFocus("hospital");
    setListOpen(false);
    onViewFinancials(hospitalId);
  }

  return (
    <section id="hospitals" className="explorer" aria-labelledby="explorer-title">
      <div className="explorer-head">
        <h1 id="explorer-title">Hospital financial explorer</h1>
        <p className="tiny">Historical public finances for one hospital at a time — not a closure forecast.</p>
      </div>

      <div className="explorer-split">
        <div className="explorer-search-pane">
          <AreaSearch
            hospitals={hospitals}
            counties={KY_COUNTIES}
            query={query}
            open={searchOpen}
            onOpenChange={setSearchOpen}
            onQueryChange={setQuery}
            onChoose={(suggestion) => {
              setQuery(suggestion.label);
              chooseArea(areaFromSuggestion(suggestion));
            }}
            onClear={() => {
              setQuery("");
              chooseArea(allKentuckyArea(), "kentucky");
            }}
          />
        </div>
        <KentuckyMap
          hospitals={hospitals}
          area={area}
          mapFocus={mapFocus}
          selectedHospitalId={selectedId}
          onSelectCounty={(fips, name) => {
            setQuery(`${name} County`);
            chooseArea(areaFromCounty(fips, name));
            setSearchOpen(true);
          }}
          onSelectHospital={viewHospital}
          onShowAll={() => {
            setQuery("");
            chooseArea(allKentuckyArea(), "kentucky");
            setSearchOpen(false);
          }}
        />
      </div>

      <p className="result-count">
        {result.matchCount} matching {result.matchCount === 1 ? "hospital" : "hospitals"} in PulseLine
        {area.kind !== "all" ? ` · ${area.label}` : ""}
      </p>
      <p className="tiny">
        {DATASET_SCOPE_NOTE} {FILTER_LOCATION_HELP}
      </p>

      {result.matchCount === 0 ? (
        <div className="empty-copy">
          <p>{NO_MATCHING_HOSPITALS}</p>
          <p className="tiny">{NO_MATCHING_HOSPITALS_NOTE}</p>
        </div>
      ) : (
        <HospitalCards
          cards={cards}
          visibleIndex={index}
          selectedId={selectedId}
          onVisibleIndex={setVisibleIndex}
          onViewFinancials={viewHospital}
          onOpenList={() => setListOpen(true)}
          onViewImpact={setImpactId}
        />
      )}

      {impactHospital ? <CommunityImpact key={impactHospital.hospitalId} hospital={impactHospital} onClose={() => setImpactId(null)} /> : null}

      {listOpen ? (
        <ResultsList
          cards={cards}
          selectedId={selectedId}
          onViewFinancials={viewHospital}
          onClose={() => setListOpen(false)}
        />
      ) : null}
    </section>
  );
}
