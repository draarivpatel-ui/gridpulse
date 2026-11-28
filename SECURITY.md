# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/gridpulse/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static GridPulse browser application and its Node modules, including grid simulation, resilience advice, laboratory controls, imported or shared state, charts, reports and export generation.

In scope:

- A cross-site scripting or HTML injection path through imported state, scenario text, chart labels, advisor output or rendered report content.
- A state decoder, serialization or validation flaw that bypasses bounds, corrupts another simulation state or executes attacker-controlled code.
- A CSV, Markdown, JSON or report export flaw that makes generated output execute a formula or script when opened.
- A cache, digest or report integrity flaw that makes altered output validate as untampered.
- An injection path from untrusted grid data into generated markup, spreadsheet cells or downloadable artifacts.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- Engineering accuracy of a user-selected grid scenario without a security impact.
- Denial of service that only affects the attacker's own browser tab.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
