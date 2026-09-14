import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { adaptEvidencePack } from "../lib/adapt-evidence.ts";
import {
  allHospitalSuggestions,
  allKentuckyArea,
  areaFromSuggestion,
  buildExplorerCatalog,
  buildSearchSuggestions,
  clampIndex,
  clusterPoints,
  defaultExplorerFilters,
  filterExplorerHospitals,
  groupSuggestions,
  hospitalMatchesArea,
  hospitalMatchesQuery,
  matchingCountyFips,
  pluralHospitals,
  removeFilterChip,
  visibleSelectedHospitalId,
  ZIP_OUTLINE_UNAVAILABLE,
} from "../lib/explorer/index.ts";
import { fitAspectViewBox, geometryBounds, padViewBox, projectedBounds, scaleViewBox } from "../lib/geo/bounds.ts";
import { geometryToPath, projectKentucky } from "../lib/geo/project.ts";
import { loadResearchDashboard } from "../lib/pipeline.ts";
import { SCALE_FIXTURE_SIZE, scaleExplorerFixture } from "./fixtures/explorer-scale.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const researchPack = JSON.parse(readFileSync(join(root, "research", "PulseLine_three_hospital_data.json"), "utf8"));
const evidencePack = JSON.parse(readFileSync(join(root, "research", "PulseLine_expanded_evidence_v1.json"), "utf8"));
const counties = JSON.parse(readFileSync(join(root, "data", "geo", "ky-counties.json"), "utf8")) as {
  features: { id: string; properties: { name: string }; geometry: { type: string; coordinates: unknown } }[];
};

const loaded = loadResearchDashboard(researchPack);
const evidence = adaptEvidencePack(evidencePack);
assert.equal(loaded.ok, true);
assert.ok(evidence.ledger);

const catalog = buildExplorerCatalog(
  loaded.facilities,
  evidence.ledger.hospitals.filter((hospital) => hospital.financialCoverage === "pending"),
  evidence.ledger.events,
);

describe("hospital explorer catalog", () => {
  it("lists only actual scored hospitals and research cases", () => {
    assert.equal(catalog.length, 5);
    assert.ok(catalog.every((item) => !item.hospitalId.startsWith("dev_scale_")));
    assert.equal(catalog.filter((item) => item.kind === "scored").length, 3);
    assert.equal(catalog.filter((item) => item.kind === "research").length, 2);
    assert.ok(catalog.every((item) => item.latitude === null && item.longitude === null));
  });

  it("keeps Kentucky River address discrepancy and pending coordinates", () => {
    const river = catalog.find((item) => item.name.includes("Kentucky River"));
    assert.ok(river);
    assert.equal(river.county, "Breathitt");
    assert.equal(river.countyFips, "21025");
    assert.equal(river.locationStatus, "facility_county");
    assert.match(river.locationNote, /does not place a fabricated marker/i);
    const facility = loaded.facilities.find((item) => item.name.includes("Kentucky River"));
    assert.ok(facility?.latest.hospital.dataQuality.addressMismatch);
  });

  it("marks research-case street location pending while using documented city county", () => {
    const highlands = catalog.find((item) => item.name.includes("Highlands"));
    assert.ok(highlands);
    assert.equal(highlands.financialStatus, "pending");
    assert.equal(highlands.score, null);
    assert.equal(highlands.zip, null);
    assert.equal(highlands.county, "Floyd");
    assert.equal(highlands.locationStatus, "city_county");
    assert.equal(highlands.ownershipCategory, null);
    assert.equal(highlands.latestFiscalKey, "pending");
    assert.equal(highlands.evidenceGap, "Financial data pending");
  });

  it("keeps unknown ownership selectable and does not invent a financial status for pending cases", () => {
    const pending = catalog.filter((item) => item.kind === "research");
    assert.equal(pending.length, 2);
    assert.ok(pending.every((item) => item.score === null && item.financialStatus === "pending"));
    const unknownOwnership = filterExplorerHospitals(catalog, {
      ...defaultExplorerFilters(),
      ownerships: ["unknown"],
    });
    assert.ok(unknownOwnership.items.every((item) => item.ownershipCategory == null));
    assert.ok(unknownOwnership.items.length >= 2);
  });
});

describe("hospital explorer filters", () => {
  it("filters by name, county, and ZIP without inventing records", () => {
    const byName = filterExplorerHospitals(catalog, { ...defaultExplorerFilters(), query: "morgan" });
    assert.equal(byName.items.length, 1);
    assert.match(byName.items[0]?.name ?? "", /Morgan/);
    const byCounty = filterExplorerHospitals(catalog, { ...defaultExplorerFilters(), countyFips: ["21027"] });
    assert.equal(byCounty.items.length, 1);
    assert.match(byCounty.items[0]?.name ?? "", /Breckinridge/);
    const morgan = catalog.find((item) => item.name.includes("Morgan"));
    assert.ok(morgan?.zip);
    const byZip = filterExplorerHospitals(catalog, { ...defaultExplorerFilters(), query: morgan.zip });
    assert.equal(byZip.items.length, 1);
    assert.equal(byZip.items[0]?.hospitalId, morgan.hospitalId);
  });

  it("uses no-matching-records copy instead of claiming hospitals do not exist", () => {
    const result = filterExplorerHospitals(catalog, { ...defaultExplorerFilters(), query: "louisville" });
    assert.equal(result.emptyReason, "no_matches");
    assert.equal(result.emptyMessage, "No matching hospitals in PulseLine.");
    assert.match(result.datasetLabel, /Showing 5 hospitals in the current dataset/);
    assert.ok(!result.emptyMessage?.toLowerCase().includes("no hospitals exist"));
  });

  it("filters concern and coverage, then resets chips", () => {
    const pending = filterExplorerHospitals(catalog, {
      ...defaultExplorerFilters(),
      concerns: ["pending"],
      coverages: ["pending"],
    });
    assert.equal(pending.items.length, 2);
    assert.ok(pending.chips.length >= 2);
    const cleared = removeFilterChip(pending.chips[0] ? { ...defaultExplorerFilters(), concerns: ["pending"], coverages: ["pending"] } : defaultExplorerFilters(), pending.chips[0]!);
    const after = filterExplorerHospitals(catalog, cleared);
    assert.ok(after.items.length >= 2);
  });

  it("sorts concern before pending and score high to low", () => {
    const concern = filterExplorerHospitals(catalog, { ...defaultExplorerFilters(), sort: "concern" });
    assert.equal(concern.items[0]?.financialStatus, "High Concern");
    assert.equal(concern.items.at(-1)?.financialStatus, "pending");
    const score = filterExplorerHospitals(catalog, { ...defaultExplorerFilters(), sort: "score" });
    const scored = score.items.filter((item) => item.score !== null);
    for (let index = 1; index < scored.length; index += 1) {
      assert.ok((scored[index - 1]?.score ?? 0) >= (scored[index]?.score ?? 0));
    }
    assert.equal(score.items.at(-1)?.score, null);
  });

  it("filters sourced event types and fiscal periods without inventing records", () => {
    const property = filterExplorerHospitals(catalog, {
      ...defaultExplorerFilters(),
      eventTypes: ["property_transaction"],
    });
    assert.ok(property.items.every((item) => item.eventTypes.includes("property_transaction")));
    const pendingPeriod = filterExplorerHospitals(catalog, {
      ...defaultExplorerFilters(),
      fiscalPeriods: ["pending"],
    });
    assert.ok(pendingPeriod.items.every((item) => item.latestFiscalKey === "pending"));
    const cah = filterExplorerHospitals(catalog, { ...defaultExplorerFilters(), ruralStatuses: ["cah"] });
    assert.ok(cah.items.every((item) => item.ruralClassification));
    assert.ok(!cah.items.some((item) => item.kind === "research"));
  });

  it("treats ZIP as a string and matches the production catalog plus isolated scale fixtures", () => {
    assert.equal(hospitalMatchesQuery(catalog[0]!, "not-a-hospital"), false);
    const fixtures = scaleExplorerFixture();
    assert.equal(fixtures.length, SCALE_FIXTURE_SIZE);
    const filtered = filterExplorerHospitals(fixtures, { ...defaultExplorerFilters(), query: "40010" });
    assert.ok(filtered.items.every((item) => item.hospitalId.startsWith("dev_scale_")));
    assert.ok(filtered.items.length >= 1);
  });
});

describe("map and list matching", () => {
  it("keeps list selection inside the filtered matches", () => {
    const breathitt = filterExplorerHospitals(catalog, { ...defaultExplorerFilters(), countyFips: ["21025"] });
    const paul = catalog.find((item) => item.name.includes("Paul B. Hall"));
    assert.ok(paul);
    assert.equal(visibleSelectedHospitalId(breathitt.items, paul.hospitalId), breathitt.items[0]?.hospitalId);
    assert.equal(visibleSelectedHospitalId(breathitt.items, breathitt.items[0]?.hospitalId ?? null), breathitt.items[0]?.hospitalId);
    const empty = filterExplorerHospitals(catalog, { ...defaultExplorerFilters(), query: "louisville" });
    assert.equal(visibleSelectedHospitalId(empty.items, paul.hospitalId), null);
    assert.equal(pluralHospitals(1), "hospital");
    assert.equal(pluralHospitals(0), "hospitals");
  });

  it("matches catalog hospitals to Kentucky county polygons by FIPS", () => {
    assert.equal(counties.features.length, 120);
    for (const hospital of catalog) {
      if (!hospital.countyFips) continue;
      const feature = counties.features.find((item) => item.id === hospital.countyFips);
      assert.ok(feature, `missing county ${hospital.countyFips}`);
      assert.equal(feature.properties.name, hospital.county);
    }
  });

  it("projects Kentucky and keeps unknown coordinates off the marker layer", () => {
    const point = projectKentucky(-83.3, 37.5, 800, 480);
    assert.ok(point.x > 0 && point.x < 800);
    assert.ok(point.y > 0 && point.y < 480);
    const path = geometryToPath(
      { type: "Polygon", coordinates: [[[-84, 38], [-83, 38], [-83, 37], [-84, 37], [-84, 38]]] },
      800,
      480,
    );
    assert.match(path, /^M/);
    const pendingMarkers = catalog.filter((item) => item.latitude === null);
    assert.equal(pendingMarkers.length, catalog.length);
  });

  it("lists every hospital when search is asked to show all", () => {
    const listed = allHospitalSuggestions(catalog);
    assert.equal(listed.length, catalog.length);
    assert.ok(listed.every((item) => item.kind === "hospital"));
    assert.equal(buildSearchSuggestions(catalog, [], "").length, 0);
  });

  it("suggests hospitals, cities, counties, and facility ZIPs without inventing ZCTA outlines", () => {
    const countyList = counties.features.map((feature) => ({ fips: feature.id, name: feature.properties.name }));
    const suggestions = buildSearchSuggestions(catalog, countyList, "jackson");
    assert.ok(suggestions.some((item) => item.kind === "city" && item.label.toLowerCase() === "jackson"));
    assert.ok(suggestions.some((item) => item.kind === "hospital" && item.label.includes("Kentucky River")));
    const breathittCounty = buildSearchSuggestions(catalog, countyList, "Breathitt County");
    assert.ok(breathittCounty.some((item) => item.kind === "hospital" && item.label.includes("Kentucky River")));
    const jefferson = buildSearchSuggestions(catalog, countyList, "jefferson");
    const county = jefferson.find((item) => item.kind === "county" && item.countyName === "Jefferson");
    assert.ok(county);
    assert.match(county.detail, /No matching hospitals in PulseLine/);
    const morgan = catalog.find((item) => item.name.includes("Morgan"));
    assert.ok(morgan?.zip);
    const zipHits = buildSearchSuggestions(catalog, countyList, morgan.zip);
    const zip = zipHits.find((item) => item.kind === "zip");
    assert.ok(zip);
    const area = areaFromSuggestion(zip);
    assert.equal(area.outline, "unavailable");
    assert.equal(area.outlineNote, ZIP_OUTLINE_UNAVAILABLE);
    assert.ok(!groupSuggestions(zipHits).some((group) => group.kind === "zip" && group.label.toLowerCase().includes("zcta")));
  });

  it("keeps card browse index inside the result set and does not place unknown hospitals at a county center", () => {
    assert.equal(clampIndex(8, 5), 4);
    assert.equal(clampIndex(-2, 5), 0);
    assert.equal(clampIndex(0, 0), 0);
    const area = allKentuckyArea();
    assert.ok(catalog.every((hospital) => hospitalMatchesArea(hospital, area)));
    assert.ok(catalog.every((hospital) => hospital.latitude === null));
    const breathitt = matchingCountyFips(catalog, {
      ...areaFromSuggestion({
        id: "county:21025",
        kind: "county",
        label: "Breathitt County",
        detail: "",
        hospitalId: null,
        countyFips: "21025",
        countyName: "Breathitt",
        city: null,
        zip: null,
      }),
    });
    assert.deepEqual(breathitt, ["21025"]);
  });

  it("fits a county outline from sourced geometry and does not invent a ZIP polygon", () => {
    const feature = counties.features.find((item) => item.id === "21025");
    assert.ok(feature);
    const bounds = geometryBounds(feature.geometry);
    assert.ok(bounds);
    const box = projectedBounds(feature.geometry, 800, 480);
    assert.ok(box);
    const padded = padViewBox(box, 24);
    assert.ok(padded.width <= 800 && padded.height <= 480);
    const fitted = fitAspectViewBox(box, 800, 480, 28);
    assert.ok(Math.abs(fitted.width / fitted.height - 800 / 480) < 0.001);
    const closer = scaleViewBox(fitted, 2);
    assert.ok(closer.width < fitted.width && closer.height < fitted.height);
    assert.ok(Math.abs(closer.x + closer.width / 2 - (fitted.x + fitted.width / 2)) < 0.001);
  });

  it("clusters overlapping fixture coordinates without touching production records", () => {
    const clustered = clusterPoints([
      { id: "a", latitude: 37.5, longitude: -84.5 },
      { id: "b", latitude: 37.51, longitude: -84.49 },
      { id: "c", latitude: 38.2, longitude: -85.7 },
    ]);
    assert.equal(clustered.length, 2);
    assert.ok(clustered.some((group) => group.pointIds.includes("a") && group.pointIds.includes("b")));
    assert.ok(!catalog.some((item) => item.hospitalId.startsWith("dev_scale_")));
  });
});
