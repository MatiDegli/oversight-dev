# Changelog

Release notes describe delivered changes. Unreleased collects landed work for the next release;
planned milestones remain in docs/roadmap.md. DEVLOG.md is frozen history, and README.md retains
its "Built during the hackathon" section.

## Unreleased

- Recorded the approved canvas, WSL and Linux own-repository admission plans and decisions, including engine A, the M6 composition gate and the CPython 3.8 venv floor; implementation and acceptance remain pending.

- Added the approved post-hackathon roadmap and its decisions, with milestone gates separating
  current capabilities from future language, provider, harness, platform and IDE work.
- Revised agent rules and product documentation for the post-hackathon baseline. Ended the
  new-since-kickoff requirement; retained security, authority, contracts, license controls,
  cross-provider merge review, hooks, fake-only checks and the submission freeze.
- Recorded the maintainer's three product criteria and the requirement for recommendations to
  address each one. Documented safe defaults, person-owned configurable limits and future
  revision-bound settings proposals, including verifiable native-agent goals; these mechanisms
  are planned, not implemented by the documentation changes.
- Replaced daily devlog duties with per-release changelog updates and an Unreleased section.
- Hardened four load-sensitive tests and corrected dot-field test measurements and thresholds.
- Gave the Vite development server the backend's preview port pool, with launcher and
  configuration regression coverage.
