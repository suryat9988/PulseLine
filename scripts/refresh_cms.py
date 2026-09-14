"""Refresh only the reviewed CMS financial cohort; fail before publishing bad data.

stdlib only. The GitHub workflow runs application validation before committing.
Research originals and reviewed hospital identities are never rewritten.
"""
import csv
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CATALOG = "https://catalog.data.gov/dataset/hospital-provider-cost-report"
OUTPUT = ROOT / "data/cms/dashboard-research.json"
TRACKED = {
    "181319": ("KY-LIC-600070", 2020),
    "181307": ("KY-LIC-600058", 2020),
    "180139": ("KY-LIC-100620", 2020),
    "181334": ("KY-LIC-100620", 2020),
    "180078": ("case_paul_b_hall", 2017),
    "180005": ("case_highlands", 2017),
}
EXPECTED_CITIES = {
    "KY-LIC-600070": "HARDINSBURG", "KY-LIC-600058": "WEST LIBERTY",
    "KY-LIC-100620": "JACKSON", "case_paul_b_hall": "PAINTSVILLE",
    "case_highlands": "PRESTONSBURG",
}
NUMERIC = [
    "Net Patient Revenue", "Less Total Operating Expense", "Total Assets",
    "Total Liabilities", "Total Current Assets", "Total Current Liabilities",
    "Cash on Hand and in Banks", "Total Days (V + XVIII + XIX + Unknown)",
    "Total Discharges (V + XVIII + XIX + Unknown)", "Number of Beds",
    "Total Bed Days Available", "Cost of Uncompensated Care",
]
REQUIRED = ["Provider CCN", "rpt_rec_num", "Hospital Name", "City", "State Code",
            "Fiscal Year Begin Date", "Fiscal Year End Date", *NUMERIC]


def discover(html):
    urls = set(re.findall(r'https://data\.cms\.gov/[^\s"<>]+CostReport_\d{4}_Final\.csv', html))
    by_year = {}
    for url in sorted(urls):
        year = int(re.search(r"CostReport_(\d{4})_Final", url)[1])
        if year < 2017:
            continue
        if year in by_year and by_year[year] != url:
            raise ValueError(f"Ambiguous CMS release for {year}; review required")
        by_year[year] = url
    if not set(range(2017, 2024)).issubset(by_year):
        raise ValueError("CMS catalog changed or required cohorts disappeared")
    return by_year


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def check_url(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in {"catalog.data.gov", "data.cms.gov"}:
        raise ValueError("Unexpected source host; review required")


def fetch(url):
    check_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": "PulseLine-public-research/1.0"})
    with urllib.request.build_opener(OfficialRedirect()).open(req, timeout=90) as response:
        data = response.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise ValueError("Unexpectedly large source; review required")
    return data


def parse_reports(data, year):
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig")))
    if not set(REQUIRED).issubset(reader.fieldnames or []):
        raise ValueError(f"CMS {year} schema changed or download is not CSV")
    reports = []
    seen = set()
    for row in reader:
        ccn = row.get("Provider CCN")
        if ccn not in TRACKED or year < TRACKED[ccn][1]:
            continue
        hospital_id = TRACKED[ccn][0]
        if row.get("State Code") != "KY" or row.get("City", "").strip().upper() != EXPECTED_CITIES[hospital_id]:
            raise ValueError(f"Identity mismatch for CCN {ccn}; review required")
        if not row.get("Hospital Name") or not re.fullmatch(r"\d+", row.get("rpt_rec_num", "")):
            raise ValueError("Missing CMS identity/report ID")
        for key in NUMERIC:
            value = row.get(key)
            if value is None or (value != "" and not re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)", value.strip())):
                raise ValueError(f"Invalid numeric field {key} for {ccn}")
        start = dt.datetime.strptime(row["Fiscal Year Begin Date"], "%m/%d/%Y").date()
        end = dt.datetime.strptime(row["Fiscal Year End Date"], "%m/%d/%Y").date()
        if start > end:
            raise ValueError("Reversed fiscal dates")
        key = (ccn, row["rpt_rec_num"])
        if key in seen:
            raise ValueError("Duplicate report ID in release")
        seen.add(key)
        reports.append({
            "hospital_id": hospital_id, "source_id": f"LIVE_CMS_{year}", "file_cohort": year,
            "fiscal_start": str(start), "fiscal_end": str(end), "period_days": (end - start).days + 1,
            "report_record_id": row["rpt_rec_num"], "ccn_as_reported": ccn,
            "scope": "Hospital cost-report reporting entity/complex; parent consolidation not reconciled. Original public availability unknown. Preserve partial periods.",
            "original_cms_fields": {k: v if v != "" else None for k, v in row.items()},
        })
    return reports


def period_key(report):
    return (report["hospital_id"], report["fiscal_start"], report["fiscal_end"])


def validate_continuity(reports, previous):
    if set(EXPECTED_CITIES) - {r["hospital_id"] for r in reports}:
        raise ValueError("A tracked hospital is missing; retaining previous dataset")
    keys = [(r["ccn_as_reported"], r["report_record_id"]) for r in reports]
    if len(keys) != len(set(keys)):
        raise ValueError("Report ID repeated across cohorts")
    periods = [period_key(r) for r in reports]
    if len(periods) != len(set(periods)):
        raise ValueError("Multiple reports for the same fiscal period; review required")
    if {period_key(r) for r in previous} - set(periods):
        raise ValueError("Previously displayed fiscal periods disappeared; review required")
    old_by_period = {period_key(r): r for r in previous}
    for r in reports:
        old = old_by_period.get(period_key(r))
        if old:
            for field in NUMERIC:
                if old["original_cms_fields"].get(field) is not None and r["original_cms_fields"].get(field) is None:
                    raise ValueError(f"Previously available {field} became missing; review required")


def refresh(fetcher=fetch, output=OUTPUT, root=ROOT):
    base = json.loads((root / "research/PulseLine_three_hospital_data.json").read_text())
    cases = json.loads((root / "data/cms/historical-case-research.json").read_text())
    previous = json.loads(output.read_text()) if output.exists() else None
    baseline = previous or {"hospital_year_reports": base["hospital_year_reports"] + cases["hospital_year_reports"]}
    releases = discover(fetcher(CATALOG).decode("utf-8"))
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    reports, sources = [], {}
    for year, url in sorted(releases.items()):
        data = fetcher(url)
        reports.extend(parse_reports(data, year))
        sources[f"LIVE_CMS_{year}"] = {
            "url": url, "accessed": now[:10], "publication_date": None,
            "sha256": hashlib.sha256(data).hexdigest(),
            "limitations": "Revised CMS release. Download date is not original public availability. Publication date unverified; no pre-event eligibility inferred.",
        }
    reports.sort(key=lambda r: (r["hospital_id"], r["fiscal_start"], r["report_record_id"]))
    validate_continuity(reports, baseline["hospital_year_reports"])
    fingerprint = hashlib.sha256(json.dumps(reports, sort_keys=True).encode()).hexdigest()
    changed_at = now
    if previous and previous.get("refresh", {}).get("data_fingerprint") == fingerprint:
        changed_at = previous["refresh"]["last_data_change_at"]
    result = {
        "hospitals": base["hospitals"] + cases["hospitals"],
        "hospital_year_reports": reports, "sources": sources,
        "refresh": {"last_successful_check_at": now, "last_data_change_at": changed_at,
                    "data_fingerprint": fingerprint, "latest_source_cohort": max(releases),
                    "report_count": len(reports), "status": "validated_source_download",
                    "scope": "CMS financial releases for five reviewed hospitals only. Reviewed identities and event research are not automatically rewritten."},
    }
    # No destination write occurs until every source and the complete panel pass.
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=output.parent, delete=False) as f:
        json.dump(result, f, indent=2)
        f.write("\n")
        temp_path = f.name
    os.replace(temp_path, output)
    return result


if __name__ == "__main__":
    result = refresh()
    print(f"Checked CMS: {result['refresh']['report_count']} reports; latest source cohort {result['refresh']['latest_source_cohort']}")
