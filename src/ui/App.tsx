import { useCallback, useEffect, useMemo, useState } from "react";
import evidencePack from "../../research/PulseLine_expanded_evidence_v1.json";
import { dashboardResearchPack, cmsRefresh } from "../../lib/dashboard-research.ts";
import { adaptEvidencePack, eventsForHospital, observationsForHospital } from "../../lib/adapt-evidence.ts";
import { researchAskContext, scoredAskContext, type PulseAnswer } from "../../lib/ask/index.ts";
import { buildExplorerCatalog } from "../../lib/explorer/index.ts";
import { loadResearchDashboard } from "../../lib/pipeline.ts";
import { AboutPulseLine } from "./about/AboutPulseLine.tsx";
import { HospitalExplorer } from "./explorer/HospitalExplorer.tsx";
import { HospitalWorkspace } from "./HospitalWorkspace.tsx";
import { SiteHeader } from "./SiteHeader.tsx";

export function App() {
  const [checkedNow, setCheckedNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setCheckedNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const loaded = useMemo(() => loadResearchDashboard(dashboardResearchPack), []);
  const evidence = useMemo(() => adaptEvidencePack(evidencePack), []);
  const [page, setPage] = useState<"explore" | "about">(() =>
    window.location.hash.startsWith("#about") ? "about" : "explore",
  );
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedResearchId, setSelectedResearchId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Record<string, PulseAnswer[]>>({});
  const [selectedByHospital, setSelectedByHospital] = useState<Record<string, string[]>>({});

  const researchCases = useMemo(
    () => evidence.ledger?.hospitals.filter((hospital) => hospital.financialCoverage === "pending" && !loaded.facilities.some((facility) => facility.hospitalId === hospital.hospitalId)) ?? [],
    [evidence.ledger, loaded.facilities],
  );
  const catalog = useMemo(
    () => buildExplorerCatalog(loaded.ok ? loaded.facilities : [], researchCases, evidence.ledger?.events ?? []),
    [loaded, researchCases, evidence.ledger],
  );
  const snapshots = useMemo(() => {
    const next: Record<string, { netPatientRevenue: number | null; expenses: number | null; cash: number | null }> = {};
    if (loaded.ok) {
      for (const facility of loaded.facilities) {
        const financials = facility.latest.hospital.financials;
        next[facility.hospitalId] = {
          netPatientRevenue: financials.netPatientRevenue,
          expenses: financials.operatingExpenses,
          cash: financials.cash,
        };
      }
    }
    return next;
  }, [loaded]);
  const selectedFacility = loaded.facilities.find((facility) => facility.hospitalId === selectedHospitalId) ?? null;
  const selected =
    selectedFacility?.reports.find((report) => report.hospital.id === selectedReportId) ??
    selectedFacility?.latest ??
    null;
  const selectedResearch = researchCases.find((hospital) => hospital.hospitalId === selectedResearchId) ?? null;
  const otherNames = [
    ...loaded.facilities.map((facility) => facility.name),
    ...researchCases.map((hospital) => hospital.name),
  ];

  const openHospital = useCallback((hospitalId: string) => {
    const facility = loaded.facilities.find((item) => item.hospitalId === hospitalId);
    if (facility) {
      setSelectedResearchId(null);
      setSelectedHospitalId(facility.hospitalId);
      setSelectedReportId(facility.latest.hospital.id);
      window.requestAnimationFrame(() => {
        document.getElementById("hospital-financials")?.scrollIntoView({ behavior: prefersSmooth() ? "smooth" : "auto", block: "start" });
      });
      return;
    }
    const research = researchCases.find((item) => item.hospitalId === hospitalId);
    if (research) {
      setSelectedHospitalId(null);
      setSelectedReportId(null);
      setSelectedResearchId(research.hospitalId);
      window.requestAnimationFrame(() => {
        document.getElementById("hospital-financials")?.scrollIntoView({ behavior: prefersSmooth() ? "smooth" : "auto", block: "start" });
      });
    }
  }, [loaded.facilities, researchCases]);

  const closeFacility = useCallback(() => {
    setSelectedHospitalId(null);
    setSelectedReportId(null);
  }, []);
  const closeResearch = useCallback(() => {
    setSelectedResearchId(null);
  }, []);

  return (
    <div className="page">
      <SiteHeader
        page={page}
        onExplore={() => {
          setPage("explore");
          window.location.hash = "hospitals";
        }}
        onAbout={() => {
          setPage("about");
          window.location.hash = "about";
        }}
      />

      <p className="cms-freshness" style={{ margin: "12px 24px", fontSize: "0.875rem" }}>
        CMS financial data checked {cmsRefresh.last_successful_check_at.slice(0, 10)} (UTC).
        {" "}Latest source cohort: {cmsRefresh.latest_source_cohort}; fiscal periods vary by hospital.
        {checkedNow - Date.parse(cmsRefresh.last_successful_check_at) > 48 * 60 * 60 * 1000
          ? " The scheduled check is overdue; showing the last validated snapshot."
          : " Checks do not mean CMS has published newer financial periods."}
      </p>

      {page === "about" ? (
        <AboutPulseLine hospitalView={selected} />
      ) : !loaded.ok ? (
        <section className="extract-error" role="alert">
          <h2>Dashboard extract failed validation</h2>
          <p>The hospital explorer is not shown because the extract is invalid. Nothing was scored.</p>
          <ul>
            {loaded.errors.map((error) => (
              <li key={`${error.code}-${error.path}`}>
                [{error.code}] {error.path}: {error.message}
              </li>
            ))}
          </ul>
        </section>
      ) : !evidence.ok ? (
        <section className="extract-error" role="alert">
          <p>Evidence ledger failed validation. Research cases are withheld.</p>
        </section>
      ) : (
        <>
          <HospitalExplorer
            hospitals={catalog}
            snapshots={snapshots}
            selectedId={selectedHospitalId ?? selectedResearchId}
            onViewFinancials={openHospital}
          />

          {selected && selectedFacility ? (
            <HospitalWorkspace
              key={selectedFacility.hospitalId}
              title={selectedFacility.name}
              subtitle={`${selected.hospital.city}, ${selected.hospital.state}`}
              pending={false}
              view={selected}
              reports={selectedFacility.reports}
              events={eventsForHospital(evidence.ledger, selectedFacility.hospitalId)}
              observations={observationsForHospital(evidence.ledger, selectedFacility.hospitalId)}
              research={null}
              askContext={scoredAskContext(selectedFacility, selected.hospital.id, evidence.ledger, otherNames)}
              answers={conversations[selectedFacility.hospitalId] ?? []}
              selectedIds={selectedByHospital[selectedFacility.hospitalId] ?? []}
              onAnswers={(next) => setConversations((current) => ({ ...current, [selectedFacility.hospitalId]: next }))}
              onSelectedIds={(next) => setSelectedByHospital((current) => ({ ...current, [selectedFacility.hospitalId]: next }))}
              onClearConversation={() => {
                setConversations((current) => ({ ...current, [selectedFacility.hospitalId]: [] }));
                setSelectedByHospital((current) => ({ ...current, [selectedFacility.hospitalId]: [] }));
              }}
              onSelectReport={setSelectedReportId}
              onClose={closeFacility}
              onOpenAbout={() => {
                setPage("about");
                window.location.hash = "about-scoring";
              }}
            />
          ) : null}

          {selectedResearch ? (
            <HospitalWorkspace
              key={selectedResearch.hospitalId}
              title={selectedResearch.name}
              subtitle={selectedResearch.city}
              pending
              view={null}
              reports={[]}
              events={eventsForHospital(evidence.ledger, selectedResearch.hospitalId)}
              observations={observationsForHospital(evidence.ledger, selectedResearch.hospitalId)}
              research={selectedResearch}
              askContext={researchAskContext(selectedResearch, evidence.ledger, otherNames)}
              answers={conversations[selectedResearch.hospitalId] ?? []}
              selectedIds={selectedByHospital[selectedResearch.hospitalId] ?? []}
              onAnswers={(next) => setConversations((current) => ({ ...current, [selectedResearch.hospitalId]: next }))}
              onSelectedIds={(next) => setSelectedByHospital((current) => ({ ...current, [selectedResearch.hospitalId]: next }))}
              onClearConversation={() => {
                setConversations((current) => ({ ...current, [selectedResearch.hospitalId]: [] }));
                setSelectedByHospital((current) => ({ ...current, [selectedResearch.hospitalId]: [] }));
              }}
              onSelectReport={() => undefined}
              onClose={closeResearch}
              onOpenAbout={() => {
                setPage("about");
                window.location.hash = "about-scoring";
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function prefersSmooth(): boolean {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
