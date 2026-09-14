import { useEffect, useMemo, useRef, useState } from "react";
import kyCounties from "../../../data/geo/ky-counties.json";
import type { AreaSelection } from "../../../lib/explorer/search.ts";
import { matchingCountyFips, pluralHospitals, type ExplorerHospital } from "../../../lib/explorer/index.ts";
import {
  MAP_ZOOM_FIT,
  MAP_ZOOM_STEP,
  clampMapZoom,
  fitAspectViewBox,
  projectedBounds,
  scaleViewBox,
  viewBoxString,
} from "../../../lib/geo/bounds.ts";
import { geometryCentroid, geometryToPath, projectKentucky } from "../../../lib/geo/project.ts";

const WIDTH = 800;
const HEIGHT = 480;

type CountyFeature = {
  id: string;
  properties: { geoid: string; name: string };
  geometry: { type: string; coordinates: unknown };
};

const features = kyCounties.features as CountyFeature[];

export const KY_COUNTY_NAMES = Object.fromEntries(features.map((feature) => [feature.id, feature.properties.name]));

export const KY_COUNTIES = features.map((feature) => ({ fips: feature.id, name: feature.properties.name }));

export function KentuckyMap({
  hospitals,
  area,
  mapFocus,
  selectedHospitalId,
  onSelectCounty,
  onSelectHospital,
  onShowAll,
}: {
  hospitals: ExplorerHospital[];
  area: AreaSelection;
  mapFocus: "kentucky" | "area" | "hospital";
  selectedHospitalId: string | null;
  onSelectCounty: (fips: string, name: string) => void;
  onSelectHospital?: (hospitalId: string) => void;
  onShowAll: () => void;
}) {
  const [zoom, setZoom] = useState(MAP_ZOOM_FIT);
  const selectedHospital = hospitals.find((item) => item.hospitalId === selectedHospitalId) ?? null;
  const matchFips = useMemo(() => new Set(matchingCountyFips(hospitals, area)), [hospitals, area]);
  const focusFips =
    mapFocus === "hospital"
      ? selectedHospital?.countyFips ?? area.countyFips
      : area.outline === "county"
        ? area.countyFips
        : null;
  const fitBox = useMemo(() => {
    const statewide = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
    if (mapFocus === "kentucky" || !focusFips) return statewide;
    const feature = features.find((item) => item.id === focusFips);
    if (!feature) return statewide;
    const box = projectedBounds(feature.geometry, WIDTH, HEIGHT);
    if (!box) return statewide;
    return fitAspectViewBox(box, WIDTH, HEIGHT, mapFocus === "hospital" ? 18 : 28);
  }, [focusFips, mapFocus]);

  useEffect(() => {
    setZoom(MAP_ZOOM_FIT);
  }, [focusFips, mapFocus]);

  const viewBox = useMemo(() => viewBoxString(scaleViewBox(fitBox, zoom)), [fitBox, zoom]);

  const svgRef = useRef<SVGSVGElement>(null);

  function adjustZoom(delta: number) {
    setZoom((current) => clampMapZoom(current + delta));
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(event: WheelEvent) {
      const focused = svg === document.activeElement || svg.contains(document.activeElement);
      if (!event.ctrlKey && !event.metaKey && !focused) return;
      event.preventDefault();
      adjustZoom(event.deltaY < 0 ? MAP_ZOOM_STEP : -MAP_ZOOM_STEP);
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const markers = hospitals.filter((hospital) => hospital.latitude != null && hospital.longitude != null);

  return (
    <figure className="ky-map">
      <div className="map-toolbar">
        <button type="button" className="chip chip-quiet" onClick={onShowAll}>
          Show all Kentucky
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        tabIndex={0}
        aria-label="Kentucky counties. Shading is hospital count in the current dataset, not a risk score. Zoom with Ctrl + scroll, or click the map and scroll. Scrolling without Ctrl still moves the page."
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            adjustZoom(MAP_ZOOM_STEP);
          }
          if (event.key === "-" || event.key === "_") {
            event.preventDefault();
            adjustZoom(-MAP_ZOOM_STEP);
          }
        }}
      >
        <title>Kentucky hospital explorer map</title>
        {features.map((feature) => {
          const inArea = matchFips.has(feature.id) || feature.id === area.countyFips;
          const selected = feature.id === focusFips && area.outline === "county";
          const className = [
            "ky-county",
            inArea ? "has-hospitals" : "",
            inArea && area.kind !== "all" ? "is-match" : "",
            selected ? "is-selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const count = hospitals.filter((hospital) => hospital.countyFips === feature.id).length;
          return (
            <path
              key={feature.id}
              className={className}
              d={geometryToPath(feature.geometry, WIDTH, HEIGHT)}
              tabIndex={0}
              role="button"
              aria-pressed={selected}
              aria-label={`${feature.properties.name} County. ${count} ${pluralHospitals(count)} in the current dataset.`}
              onClick={() => onSelectCounty(feature.id, feature.properties.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectCounty(feature.id, feature.properties.name);
                }
              }}
            />
          );
        })}
        {markers.map((hospital) => {
          const point = projectKentucky(hospital.longitude as number, hospital.latitude as number, WIDTH, HEIGHT);
          const selected = hospital.hospitalId === selectedHospitalId;
          return (
            <circle
              key={hospital.hospitalId}
              className={selected ? "ky-marker is-selected" : "ky-marker"}
              cx={point.x}
              cy={point.y}
              r={selected ? 7 : 5}
              tabIndex={0}
              role="button"
              aria-label={hospital.name}
              onClick={(event) => {
                event.stopPropagation();
                onSelectHospital?.(hospital.hospitalId);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectHospital?.(hospital.hospitalId);
                }
              }}
            />
          );
        })}
        {focusFips
          ? features
              .filter((feature) => feature.id === focusFips)
              .map((feature) => {
                const centroid = geometryCentroid(feature.geometry);
                if (!centroid) return null;
                const point = projectKentucky(centroid.lon, centroid.lat, WIDTH, HEIGHT);
                return (
                  <text key={`${feature.id}-label`} className="ky-count on-selected" x={point.x} y={point.y} textAnchor="middle" dominantBaseline="middle">
                    {feature.properties.name}
                  </text>
                );
              })
          : null}
      </svg>
      <figcaption className="tiny">
        {area.outlineNote ??
          "County shading is dataset hospital presence, not risk. Boundaries: U.S. Census Bureau cartographic county polygons, public domain. No commercial basemap and no runtime geocoding."}
        {markers.length === 0
          ? " Hospital street markers are omitted because sourced latitude and longitude are not verified."
          : " Markers appear only for hospitals with sourced coordinates."}{" "}
        After a county is selected, zoom with Ctrl + scroll, or click the map and use + and −. Scrolling without Ctrl
        still moves the page.
      </figcaption>
    </figure>
  );
}
