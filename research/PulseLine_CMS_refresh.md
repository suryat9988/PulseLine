# Automatic CMS financial refresh

PulseLine now reads `data/cms/dashboard-research.json`. The initial snapshot contains 29 fiscal reports for five reviewed Kentucky hospitals, including Paul B. Hall/Paintsville and Highlands. Original research files remain available as evidence.

## Activation

Push these project changes to the repository default branch. In GitHub, enable Actions, allow this workflow to write repository contents, and configure Pages to deploy with GitHub Actions. Run **Actions → Refresh CMS financial data → Run workflow** once to verify repository permissions and deployment. Branch protections or organization policies may require an approved bot or pull-request workflow instead of direct commits. This local implementation has not been activated or deployment-tested on GitHub.

The workflow checks daily at 10:23 UTC and can also run manually. GitHub schedules can be delayed; inactive public repositories may have schedules disabled after 60 days. This is polling, not a CMS push notification. Workflow failures appear in Actions; repository maintainers should enable their GitHub Actions failure notifications.

## What updates

The script discovers annual Hospital Provider Cost Report CSV links from the public CMS catalog, including newly listed cohorts, and re-downloads existing cohorts to detect revisions. It selects only reviewed CCNs and cities, preserving fiscal periods, report IDs, original fields, source URLs, access dates, and file hashes. Unknown numeric values stay null; zero and negative values remain distinct.

All downloads and continuity checks must succeed. Application tests, type checking, linting and a production build must then pass before the workflow commits the generated file and deploys the website. Download or validation failure retains the previously published dataset. If deployment itself fails, the previous site remains and Actions shows the failure; rerun after resolving it. No forced pushes are used.

The dashboard displays the last successful source check and latest source cohort, with an overdue notice after 48 hours. A fresh check does not imply current-year financials. CMS publication lag still applies.

## Review boundaries

Missing hospitals, changed cities, disappeared periods, duplicate reports, schema changes, and previously present numeric values becoming blank stop the refresh for review. New CCNs and hospital identities require a verified crosswalk. The workflow does not automatically rewrite event classifications, rural classifications, ownership, services, or clinician histories. It does not validate a predictive score.

Source publication dates remain unknown unless verified separately. Retrieval dates and revised reports must not be used as evidence of what was knowable before a historical event. Hospital/reporting-complex scope is preserved in each observation. Acquisition is not bankruptcy or closure.

## Verification and sources

Refresh safeguard tests: `python -m unittest discover -s scripts -p 'test_refresh_cms.py'`.
Application checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

- [CMS cost-report catalog](https://catalog.data.gov/dataset/hospital-provider-cost-report)
- [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub workflow triggering and GITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

The refresh workflow deploys explicitly because commits made with GITHUB_TOKEN do not trigger the normal push deployment workflow.
