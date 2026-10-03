# Security policy

## Scope

MMR is a **frozen reference implementation** (v1.0.0). It has never been deployed with live merchant
data, and it is not offered as a hosted service. There are no supported production installations, so
there is no patch-release schedule.

That said, the repository makes specific security claims (fail-closed configuration, webhook
signature verification, least-privilege database grants, append-only audit tables, no API key in the
browser). They are listed with their tests in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model).
If you find a way to break one of them, please report it.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** on this repository (Security → *Report a
vulnerability*). Please do not open a public issue for a security problem.

Include the affected file or endpoint, steps to reproduce, and the impact you expect. You should get
an acknowledgement within 7 days. Valid reports are fixed on `main` and credited in the changelog
unless you prefer to stay anonymous.

## Out of scope

- Findings that require a `.env` with placeholder or deliberately weak secrets.
- Running with `ENVIRONMENT=development` and `API_AUTH_DISABLED=true`, which is documented as
  local-only.
- Denial of service against a local Docker stack.
- Vulnerabilities in third-party images or dependencies with no demonstrated impact on MMR
  (`pip-audit` runs in CI; please report those upstream).
