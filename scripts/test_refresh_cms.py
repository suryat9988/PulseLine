import csv
import io
import json
from pathlib import Path
import tempfile
import unittest
from refresh_cms import REQUIRED, parse_reports, discover, refresh, validate_continuity


def release(year, invalid=False):
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=REQUIRED)
    writer.writeheader()
    for ccn, city in [("181319", "HARDINSBURG"), ("181307", "WEST LIBERTY"),
                      ("180139", "JACKSON"), ("180078", "PAINTSVILLE"), ("180005", "PRESTONSBURG")]:
        row = {field: "0" for field in REQUIRED}
        row.update({"Provider CCN": ccn, "rpt_rec_num": str(year) + ccn,
                    "Hospital Name": "FICTIONAL TEST ROW", "City": city, "State Code": "KY",
                    "Fiscal Year Begin Date": f"01/01/{year}", "Fiscal Year End Date": f"12/31/{year}",
                    "Cash on Hand and in Banks": "", "Total Liabilities": "-5"})
        if invalid:
            row["Net Patient Revenue"] = "not numeric"
        writer.writerow(row)
    return out.getvalue().encode()


class RefreshTests(unittest.TestCase):
    def test_preserve_missing_zero_negative(self):
        r = parse_reports(release(2023), 2023)[0]
        self.assertIsNone(r["original_cms_fields"]["Cash on Hand and in Banks"])
        self.assertEqual(r["original_cms_fields"]["Net Patient Revenue"], "0")
        self.assertEqual(r["original_cms_fields"]["Total Liabilities"], "-5")

    def test_bad_schema_and_numeric_fail(self):
        for data in [b"<html>Error</html>", release(2023, invalid=True)]:
            with self.assertRaises(ValueError):
                parse_reports(data, 2023)

    def test_missing_history_and_identity_fail(self):
        reports = parse_reports(release(2023), 2023)
        with self.assertRaises(ValueError):
            validate_continuity(reports[:-1], reports)
        with self.assertRaises(ValueError):
            parse_reports(release(2023).replace(b"PRESTONSBURG", b"WRONG CITY"), 2023)

    def test_new_cohort_discovered(self):
        html = " ".join(f'https://data.cms.gov/test/CostReport_{year}_Final.csv' for year in range(2017, 2025))
        self.assertEqual(max(discover(html)), 2024)

    def test_disappearing_values_and_duplicate_periods_fail(self):
        reports = parse_reports(release(2023), 2023)
        changed = json.loads(json.dumps(reports))
        changed[0]["original_cms_fields"]["Net Patient Revenue"] = None
        with self.assertRaises(ValueError):
            validate_continuity(changed, reports)
        with self.assertRaises(ValueError):
            validate_continuity(reports + [reports[0]], reports)

    def test_catalog_failure(self):
        with self.assertRaises(ValueError):
            discover("<html>temporarily unavailable</html>")

    def test_success_and_failure_are_atomic(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "research").mkdir()
            (root / "data/cms").mkdir(parents=True)
            seed = {"hospitals": [], "hospital_year_reports": []}
            (root / "research/PulseLine_three_hospital_data.json").write_text(json.dumps(seed))
            (root / "data/cms/historical-case-research.json").write_text(json.dumps(seed))
            output = root / "data/cms/dashboard-research.json"
            html = " ".join(f'https://data.cms.gov/test/CostReport_{year}_Final.csv' for year in range(2017, 2024))
            def fetcher(url):
                if url.endswith("hospital-provider-cost-report"):
                    return html.encode()
                return release(int(url.split("CostReport_")[1][:4]))
            first = refresh(fetcher, output, root)
            self.assertEqual(len(first["hospital_year_reports"]), 26)
            second = refresh(fetcher, output, root)
            self.assertEqual(first["refresh"]["last_data_change_at"], second["refresh"]["last_data_change_at"])
            before = output.read_bytes()
            def broken(url):
                if "2023" in url:
                    raise OSError("CMS unavailable")
                return fetcher(url)
            with self.assertRaises(OSError):
                refresh(broken, output, root)
            self.assertEqual(before, output.read_bytes())


if __name__ == "__main__":
    unittest.main()
