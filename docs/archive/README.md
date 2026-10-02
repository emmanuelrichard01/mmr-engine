# Archived design documents

These documents were written before and during the build of mmr-engine as aspirational design specifications. They record what the system was intended to become, not what it is.

**They are not authoritative.** Where anything here disagrees with the code, the code wins, followed by the top-level [README.md](../../README.md) and [docs/ARCHITECTURE.md](../ARCHITECTURE.md).

Many components described here were never built, including:

- an M-Pesa connector (only Paystack and Flutterwave exist)
- dbt models
- pgaudit
- the managed deployment option and its AES credential vault
- several API endpoints
- multi-tenancy

They are kept for design history only. Each file carries a banner saying so, and a light pass has removed unsupported claims (unsourced statistics, overstated delivery guarantees, regulatory-compliance and production-readiness language).

## Contents

| File | What it covers |
|------|----------------|
| [Header.md](Header.md) | Original reading-order index for the specification set |
| [PRD.md](PRD.md) | Product requirements: problem statement, personas, functional and non-functional requirements |
| [DATA ARCHITECTURE.md](DATA%20ARCHITECTURE.md) | End-to-end data flow and the Bronze/Silver/Gold medallion design |
| [ERD.md](ERD.md) | Entity-relationship model and the planned DDL for every table |
| [DATA DICTIONARY.md](DATA%20DICTIONARY.md) | Field-level definitions, sensitivity labels and data sources |
| [TDD.md](TDD.md) | Technical design: repo layout, configuration, pipeline flows, observability, build plan |
| [API SPECIFICATION.md](API%20SPECIFICATION.md) | Planned OpenAPI 3.1 contract for the REST API |
| [DATA GOVERNANCE & SECURITY.md](DATA%20GOVERNANCE%20%26%20SECURITY.md) | Data classification, threat model, access control, NDPA 2023 data-protection and incident response design |
| [QUALITY ASSURANCE.md](QUALITY%20ASSURANCE.md) | Test strategy, correctness properties and performance targets |
| [CDA.md](CDA.md) | Credential and deployment architecture: self-hosted, managed and read-only key models |
| [RELEVANCE AND THREAT ASSESSMENT.md](RELEVANCE%20AND%20THREAT%20ASSESSMENT.md) | Competitive landscape and intended market positioning |
| [GTM_STRATEGY.md](GTM_STRATEGY.md) | Data acquisition options and go-to-market messaging by audience |
