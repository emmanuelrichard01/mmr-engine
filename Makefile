# ══════════════════════════════════════════════════════════════════════════════
# MMR — Money Movement Reconciliation engine: Makefile
#
# Usage: make <target>      (make help lists everything)
# ══════════════════════════════════════════════════════════════════════════════

.DEFAULT_GOAL := help

COMPOSE_FILE    := docker-compose.yml
MONITORING_FILE := docker-compose.monitoring.yml
PYTHON          := $(if $(wildcard .venv/Scripts/python.exe),.venv/Scripts/python,$(if $(wildcard .venv/bin/python),.venv/bin/python,python))
PG_USER         := postgres
PG_DB           := reconciliation

.PHONY: help doctor up up-monitoring down build restart rebuild logs logs-api logs-errors shell \
        migrate migrate-down api-key \
        test test-unit test-db test-integration test-contracts test-all coverage \
        lint format typecheck security-check check \
        demo demo-full demo-reset demo-data demo-data-week \
        webhook webhook-batch webhook-unmatched webhook-duplicate replay matching smoke \
        status clean clean-data clean-dashboard reset \
        dashboard dashboard-install dashboard-build

help: ## Show all available commands grouped by category
	@awk 'BEGIN { FS = ":.*##"; print "\nMMR engine — available commands\n" } \
	/^## ──/ { gsub(/^## /, "", $$0); printf "\n  \033[33m%s\033[0m\n", $$0 } \
	/^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""

## ── Infrastructure ─────────────────────────────────────────────────────────

doctor: ## Pre-flight checks (Docker, .env, ports, Python)
	@$(PYTHON) scripts/doctor.py

up: ## Start the stack; migrations run automatically before the app services
	docker compose -f $(COMPOSE_FILE) up -d --build --wait
	@echo "  Dashboard  http://localhost:3000"
	@echo "  API docs   http://localhost:8000/docs"
	@echo "  Prefect    http://localhost:4200"

up-monitoring: ## Start the stack plus Prometheus (:9090) and Grafana (:3001)
	docker compose -f $(COMPOSE_FILE) -f $(MONITORING_FILE) up -d --build --wait

down: ## Stop all services (keeps data)
	docker compose -f $(COMPOSE_FILE) -f $(MONITORING_FILE) down

build: ## Rebuild images without cache
	docker compose -f $(COMPOSE_FILE) build --no-cache

restart: ## Restart services (keeps data)
	docker compose -f $(COMPOSE_FILE) restart

rebuild: ## Stop, rebuild and start (migrations run on start)
	docker compose -f $(COMPOSE_FILE) down
	docker compose -f $(COMPOSE_FILE) up -d --build --wait

## ── Logs ───────────────────────────────────────────────────────────────────

logs: ## Follow logs from all services
	docker compose -f $(COMPOSE_FILE) logs -f

logs-api: ## Follow API, consumer and scheduler logs
	docker compose -f $(COMPOSE_FILE) logs -f api consumer_worker scheduler

logs-errors: ## Show recent error lines from all services
	@docker compose -f $(COMPOSE_FILE) logs --tail=200 2>&1 | grep -iE "error|exception|failed|traceback|critical" || echo "  (no errors found)"

shell: ## Shell in the API container
	docker compose -f $(COMPOSE_FILE) exec api /bin/bash

## ── Database ───────────────────────────────────────────────────────────────

migrate: ## Apply pending migrations (also automatic on `make up`)
	docker compose -f $(COMPOSE_FILE) run --rm migrations alembic upgrade head

migrate-down: ## Roll back one migration
	docker compose -f $(COMPOSE_FILE) run --rm migrations alembic downgrade -1

api-key: ## Issue an API key: make api-key NAME=dashboard SCOPE=write
	docker compose -f $(COMPOSE_FILE) run --rm migrations \
		python scripts/create_api_key.py --name "$(NAME)" --scope "$(or $(SCOPE),read)"

## ── Quality ────────────────────────────────────────────────────────────────

test: ## Whole suite (DB tests use MMR_TEST_DATABASE_URL or an embedded Postgres)
	$(PYTHON) -m pytest tests/ --tb=short

test-unit: ## Unit + contract tests (no database)
	$(PYTHON) -m pytest tests/unit/ tests/contracts/

test-db: ## Database tests: migrations, constraints, triggers, concurrency
	$(PYTHON) -m pytest tests/integration/ -m db

test-integration: test-db ## Alias of test-db

test-contracts: ## Schema contract tests only
	$(PYTHON) -m pytest tests/contracts/

coverage: ## Whole suite with coverage (htmlcov/index.html)
	$(PYTHON) -m pytest tests/ --cov=src --cov-report=term-missing --cov-report=html

test-all: coverage ## Alias of coverage

lint: ## Ruff lint + format check
	$(PYTHON) -m ruff check src/ tests/
	$(PYTHON) -m ruff format --check src/ tests/

format: ## Format with ruff
	$(PYTHON) -m ruff format src/ tests/

typecheck: ## mypy --strict (configured in pyproject.toml)
	$(PYTHON) -m mypy src/

security-check: ## Secret / unsafe-pattern scanner
	$(PYTHON) scripts/security_check.py

check: lint typecheck security-check test ## Everything CI runs for Python

## ── Demo & data (all synthetic) ────────────────────────────────────────────

demo-full: ## Stack + 14 days of synthetic data (the matching lookback) + matching, verified
	@$(PYTHON) scripts/demo_full.py --days 14 --monitoring

demo: ## Quicker demo: 7 days of synthetic data
	@$(PYTHON) scripts/demo_full.py --days 7

demo-reset: ## Destroy all data, then demo-full on a fresh stack (DESTRUCTIVE)
	docker compose -f $(COMPOSE_FILE) -f $(MONITORING_FILE) down -v
	@$(PYTHON) scripts/demo_full.py --days 14 --monitoring

demo-data: ## Generate 30 days of synthetic events (scripts/demo_data/)
	$(PYTHON) scripts/generate_demo_data.py --days 30

demo-data-week: ## Generate 7 days of synthetic events
	$(PYTHON) scripts/generate_demo_data.py --days 7

replay: ## Replay generated events through the signed webhook endpoints
	$(PYTHON) scripts/replay_demo_data.py

webhook: ## Fire one matched pair (Paystack + Flutterwave)
	$(PYTHON) scripts/simulate_webhooks.py matched-pair

webhook-batch: ## Fire 20 mixed webhook scenarios
	$(PYTHON) scripts/simulate_webhooks.py batch --count 20

webhook-unmatched: ## Fire an unmatched event
	$(PYTHON) scripts/simulate_webhooks.py unmatched --psp paystack

webhook-duplicate: ## Fire a duplicate event (idempotency)
	$(PYTHON) scripts/simulate_webhooks.py duplicate

matching: ## Run the matching flow now (it also runs every 5 minutes)
	docker compose -f $(COMPOSE_FILE) exec -T scheduler python -c \
		"import asyncio; from src.flows.matching_flow import silver_to_gold_matching_flow; print(asyncio.run(silver_to_gold_matching_flow()))"

smoke: ## Probe liveness and readiness of the running stack
	@$(PYTHON) scripts/smoke_test.py

## ── Dashboard ──────────────────────────────────────────────────────────────

dashboard: ## Dashboard dev server (http://localhost:3000)
	cd dashboard && npm run dev

dashboard-install: ## Install dashboard dependencies
	cd dashboard && npm ci

dashboard-build: ## Production build of the dashboard
	cd dashboard && npm run build

## ── Operations ─────────────────────────────────────────────────────────────

status: ## Container status and row counts per layer
	@docker compose -f $(COMPOSE_FILE) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
	@docker compose -f $(COMPOSE_FILE) exec -T postgres psql -U $(PG_USER) -d $(PG_DB) -c \
		"SELECT 'bronze_ingestion_log' AS layer, count(*) FROM bronze_ingestion_log \
		 UNION ALL SELECT 'silver_canonical_transactions', count(*) FROM silver_canonical_transactions \
		 UNION ALL SELECT 'gold_matched_transactions', count(*) FROM gold_matched_transactions \
		 UNION ALL SELECT 'gold_discrepancies (open)', count(*) FROM gold_discrepancies WHERE status = 'open';" \
		2>/dev/null || echo "  (database not running: make up)"

## ── Cleanup ────────────────────────────────────────────────────────────────

clean: ## Remove containers, volumes and generated files (DESTRUCTIVE)
	docker compose -f $(COMPOSE_FILE) -f $(MONITORING_FILE) down -v --remove-orphans
	$(PYTHON) scripts/clean_project.py

clean-dashboard: ## Remove dashboard node_modules and .next
	$(PYTHON) scripts/clean_project.py --dashboard

clean-data: ## Remove generated demo data files
	@$(PYTHON) -c "import shutil; shutil.rmtree('scripts/demo_data', ignore_errors=True); print('removed scripts/demo_data/')"

reset: ## Destroy all data, rebuild, and load 7 days of demo data (DESTRUCTIVE)
	@echo "  WARNING: destroying all containers and data in 5 seconds (Ctrl+C to cancel)"
	@sleep 5
	docker compose -f $(COMPOSE_FILE) down -v --remove-orphans
	@$(PYTHON) scripts/demo_full.py --days 7
