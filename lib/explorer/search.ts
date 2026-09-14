import { zipMatches } from "./locations.ts";
import { defaultExplorerFilters, type ExplorerFilters, type ExplorerHospital } from "./types.ts";

export const SEARCH_KINDS = ["hospital", "city", "county", "zip"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export type AreaKind = "all" | SearchKind;

export interface CountyRef {
  fips: string;
  name: string;
}

export interface SearchSuggestion {
  id: string;
  kind: SearchKind;
  label: string;
  detail: string;
  hospitalId: string | null;
  countyFips: string | null;
  countyName: string | null;
  city: string | null;
  zip: string | null;
}

export interface AreaSelection {
  kind: AreaKind;
  label: string;
  hospitalId: string | null;
  countyFips: string | null;
  countyName: string | null;
  city: string | null;
  zip: string | null;
  outline: "county" | "unavailable" | "none";
  outlineNote: string | null;
}

export const ZIP_OUTLINE_UNAVAILABLE =
  "ZIP area outline unavailable. Matching hospitals use the facility postal ZIP recorded in PulseLine, not Census ZCTA geography.";

export const CITY_OUTLINE_NOTE =
  "City limits are not drawn. The highlighted county is the documented county for this city, not a city-boundary polygon.";

export const NO_MATCHING_HOSPITALS = "No matching hospitals in PulseLine.";

export const NO_MATCHING_HOSPITALS_NOTE =
  "This does not mean no hospitals exist there. PulseLine only includes the current dataset.";

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hospitalLocation(hospital: ExplorerHospital): string {
  return [hospital.city, hospital.county ? `${hospital.county} County` : null, hospital.zip]
    .filter(Boolean)
    .join(" · ");
}

function hospitalToSuggestion(hospital: ExplorerHospital): SearchSuggestion {
  return {
    id: `hospital:${hospital.hospitalId}`,
    kind: "hospital",
    label: hospital.name,
    detail: hospitalLocation(hospital) || "Location pending",
    hospitalId: hospital.hospitalId,
    countyFips: hospital.countyFips,
    countyName: hospital.county,
    city: hospital.city,
    zip: hospital.zip,
  };
}

export function allHospitalSuggestions(hospitals: ExplorerHospital[]): SearchSuggestion[] {
  return [...hospitals]
    .sort((left, right) => left.name.localeCompare(right.name) || left.hospitalId.localeCompare(right.hospitalId))
    .map(hospitalToSuggestion);
}

function countyHospitalCount(hospitals: ExplorerHospital[], fips: string): number {
  return hospitals.filter((hospital) => hospital.countyFips === fips).length;
}

export function allKentuckyArea(): AreaSelection {
  return {
    kind: "all",
    label: "All Kentucky",
    hospitalId: null,
    countyFips: null,
    countyName: null,
    city: null,
    zip: null,
    outline: "none",
    outlineNote: null,
  };
}

export function areaFromSuggestion(suggestion: SearchSuggestion): AreaSelection {
  if (suggestion.kind === "county" && suggestion.countyFips) {
    return {
      kind: "county",
      label: `${suggestion.countyName ?? suggestion.label} County`,
      hospitalId: null,
      countyFips: suggestion.countyFips,
      countyName: suggestion.countyName,
      city: null,
      zip: null,
      outline: "county",
      outlineNote: "County outline uses U.S. Census Bureau cartographic county boundaries.",
    };
  }
  if (suggestion.kind === "zip" && suggestion.zip) {
    return {
      kind: "zip",
      label: `ZIP ${suggestion.zip}`,
      hospitalId: null,
      countyFips: suggestion.countyFips,
      countyName: suggestion.countyName,
      city: null,
      zip: suggestion.zip,
      outline: "unavailable",
      outlineNote: ZIP_OUTLINE_UNAVAILABLE,
    };
  }
  if (suggestion.kind === "city" && suggestion.city) {
    return {
      kind: "city",
      label: suggestion.city,
      hospitalId: null,
      countyFips: suggestion.countyFips,
      countyName: suggestion.countyName,
      city: suggestion.city,
      zip: null,
      outline: suggestion.countyFips ? "county" : "unavailable",
      outlineNote: suggestion.countyFips ? CITY_OUTLINE_NOTE : "City outline unavailable. Matching hospitals are listed without a fabricated boundary.",
    };
  }
  return {
    kind: "hospital",
    label: suggestion.label,
    hospitalId: suggestion.hospitalId,
    countyFips: suggestion.countyFips,
    countyName: suggestion.countyName,
    city: suggestion.city,
    zip: suggestion.zip,
    outline: suggestion.countyFips ? "county" : "unavailable",
    outlineNote: suggestion.countyFips
      ? "Highlighted county is the recorded facility county. Street coordinates are not shown unless sourced."
      : "Facility location outline unavailable. Street coordinates are not verified.",
  };
}

export function areaFromCounty(fips: string, name: string): AreaSelection {
  return areaFromSuggestion({
    id: `county:${fips}`,
    kind: "county",
    label: name,
    detail: "",
    hospitalId: null,
    countyFips: fips,
    countyName: name,
    city: null,
    zip: null,
  });
}

export function filtersForArea(area: AreaSelection): ExplorerFilters {
  const filters = defaultExplorerFilters();
  if (area.kind === "county" && area.countyFips) {
    return { ...filters, countyFips: [area.countyFips] };
  }
  if (area.kind === "zip" && area.zip) {
    return { ...filters, zips: [area.zip] };
  }
  if (area.kind === "city" && area.city) {
    return { ...filters, query: area.city };
  }
  if (area.kind === "hospital" && area.hospitalId) {
    return { ...filters, query: area.label };
  }
  return filters;
}

export function hospitalMatchesArea(hospital: ExplorerHospital, area: AreaSelection): boolean {
  if (area.kind === "all") return true;
  if (area.kind === "county") return Boolean(area.countyFips && hospital.countyFips === area.countyFips);
  if (area.kind === "zip") return Boolean(area.zip && zipMatches(hospital.zip, area.zip));
  if (area.kind === "city") return Boolean(area.city && hospital.city?.toLowerCase() === area.city.toLowerCase());
  return hospital.hospitalId === area.hospitalId;
}

export function matchingCountyFips(hospitals: ExplorerHospital[], area: AreaSelection): string[] {
  const matches = hospitals.filter((hospital) => hospitalMatchesArea(hospital, area));
  return [...new Set(matches.map((hospital) => hospital.countyFips).filter((fips): fips is string => Boolean(fips)))];
}

export function buildSearchSuggestions(
  hospitals: ExplorerHospital[],
  counties: CountyRef[],
  rawQuery: string,
  limit = 12,
): SearchSuggestion[] {
  const query = normalize(rawQuery);
  if (!query) return [];
  const zipQuery = query.replace(/\s+/g, "");
  const scored: Array<SearchSuggestion & { rank: number }> = [];

  for (const hospital of hospitals) {
    const name = hospital.name.toLowerCase();
    const tokens = query.split(" ");
    const hay = [
      hospital.name,
      hospital.city,
      hospital.county,
      hospital.county ? `${hospital.county} county` : null,
      hospital.zip,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesTokens = tokens.every((token) => hay.includes(token));
    const zipHit = /^\d{3,5}$/.test(zipQuery) && zipMatches(hospital.zip, zipQuery);
    if (!matchesTokens && !zipHit) continue;
    const rank = name.startsWith(query) ? 0 : name.includes(query) ? 1 : zipHit ? 2 : 3;
    scored.push({ ...hospitalToSuggestion(hospital), rank });
  }

  const cities = new Map<string, ExplorerHospital[]>();
  for (const hospital of hospitals) {
    if (!hospital.city) continue;
    const key = hospital.city;
    cities.set(key, [...(cities.get(key) ?? []), hospital]);
  }
  for (const [city, items] of cities) {
    if (!city.toLowerCase().includes(query) && !query.includes(city.toLowerCase())) continue;
    const first = items[0];
    scored.push({
      id: `city:${city}`,
      kind: "city",
      label: city,
      detail: first?.county
        ? `${first.county} County · ${items.length} ${items.length === 1 ? "hospital" : "hospitals"} in PulseLine`
        : `${items.length} ${items.length === 1 ? "hospital" : "hospitals"} in PulseLine`,
      hospitalId: items.length === 1 ? items[0]?.hospitalId ?? null : null,
      countyFips: first?.countyFips ?? null,
      countyName: first?.county ?? null,
      city,
      zip: null,
      rank: city.toLowerCase() === query ? 0 : 4,
    });
  }

  for (const county of counties) {
    const name = county.name.toLowerCase();
    if (!name.includes(query) && !query.includes(name) && !`${name} county`.includes(query)) continue;
    const count = countyHospitalCount(hospitals, county.fips);
    scored.push({
      id: `county:${county.fips}`,
      kind: "county",
      label: `${county.name} County`,
      detail: count === 0 ? "No matching hospitals in PulseLine" : `${count} ${count === 1 ? "hospital" : "hospitals"} in PulseLine`,
      hospitalId: null,
      countyFips: county.fips,
      countyName: county.name,
      city: null,
      zip: null,
      rank: name === query || `${name} county` === query ? 0 : 5,
    });
  }

  const zips = new Map<string, ExplorerHospital[]>();
  for (const hospital of hospitals) {
    if (!hospital.zip) continue;
    zips.set(hospital.zip, [...(zips.get(hospital.zip) ?? []), hospital]);
  }
  for (const [zip, items] of zips) {
    if (!/^\d{3,5}$/.test(zipQuery) || !zipMatches(zip, zipQuery)) continue;
    scored.push({
      id: `zip:${zip}`,
      kind: "zip",
      label: zip,
      detail: `Facility postal ZIP · ${items.map((item) => item.name).join("; ")}`,
      hospitalId: items.length === 1 ? items[0]?.hospitalId ?? null : null,
      countyFips: items[0]?.countyFips ?? null,
      countyName: items[0]?.county ?? null,
      city: items[0]?.city ?? null,
      zip,
      rank: zip === zipQuery ? 0 : 2,
    });
  }

  const seen = new Set<string>();
  return scored
    .sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label) || left.kind.localeCompare(right.kind))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      detail: item.detail,
      hospitalId: item.hospitalId,
      countyFips: item.countyFips,
      countyName: item.countyName,
      city: item.city,
      zip: item.zip,
    }));
}

export function groupSuggestions(suggestions: SearchSuggestion[]): { kind: SearchKind; label: string; items: SearchSuggestion[] }[] {
  const labels: Record<SearchKind, string> = {
    hospital: "Hospitals",
    city: "Cities",
    county: "Counties",
    zip: "Facility ZIP codes",
  };
  return SEARCH_KINDS.map((kind) => ({
    kind,
    label: labels[kind],
    items: suggestions.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);
}

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index));
}
