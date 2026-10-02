# ══════════════════════════════════════════════════════════════════════════════
# MMR Engine — Makefile
# Professional-grade operations for the reconciliation engine.
#
# Usage: make <target>
# Run  : make help  — to see all available commands
# ══════════════════════════════════════════════════════════════════════════════

.DEFAULT_GOAL := help

# ─── Configuration ─────────────────────────────────────────────────────────────

COMPOSE_FILE     := docker-compose.yml
MONITORING_FILE  := docker-compose.monitoring.yml
PYTHON           := python
PG_USER          := postgres
PG_DB            := reconciliation

# ─── Phony Targets ─────────────────────────────────────────────────────────────

.PHONY: help doctor up down build restart rebuild logs logs-errors logs-api \
        shell migrate migrate-down \
        test test-unit test-integration test-contracts test-all coverage \
        lint format typecheck security-check \
        demo demo-data demo-data-week \
        webhook webhook-batch webhook-unmatched webhook-duplicate \
        replay matching smoke \
        demo-investor investor-reset \
        status clean clean-data clean-dashboard reset \
        dashboard dashboard-install dashboard-build

# ══════════════════════════════════════════════════════════════════════════════
# HELP
# ══════════════════════════════════════════════════════════════════════════════

help: ## Show all available commands grouped by category
	@awk 'BEGIN { \
		FS = ":.*##"; \
		print "\nMMR Engine — Available Commands\n"; \
		print "─────────────────────────────────────────────────────────\n"; \
	} \
	/^## ──/ { \
		gsub(/^## /, "", $$0); \
		printf "\n  \033[33m%s\033[0m\n", $$0; \
	} \
	/^[a-zA-Z_-]+:.*?##/ { \
		printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2; \
	}' $(MAKEFILE_LIST)
	@echo ""

# ══════════════════════════════════════════════════════════════════════════════
## ── Infrastructure ───────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

doctor: ## Run pre-flight checks (Docker, .env, ports, Python)
	@$(PYTHON) scripts/doctor.py

up: ## Start all core services (non-blocking)
	docker compose -f $(COMPOSE_FILE) up -d --build
	@echo ""
	@echo "  ✓ Services starting. Run 'make logs' to follow output."
	@echo "  ✓ Dashboard: http://localhost:3000"
	@echo "  ✓ API:       http://localhost:8000"
	@echo ""

down: ## Stop all services
	docker compose -f $(COMPOSE_FILE) down

build: ## Rebuild all Docker images (no cache)
	docker compose -f $(COMPOSE_FILE) build --no-cache

restart: ## Restart all services (preserves data)
	docker compose -f $(COMPOSE_FILE) restart

rebuild: ## Full rebuild: stop → build → start → migrate
	docker compose -f $(COMPOSE_FILE) down
	docker compose -f $(COMPOSE_FILE) up -d --build
	@$(PYTHON) scripts/wait_for_postgres.py
	docker compose -f $(COMPOSE_FILE) run --rm migrations alembic upgrade head
	@echo "✓ Rebuild complete"

# ══════════════════════════════════════════════════════════════════════════════
## ── Logs ─────────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

logs: ## Follow logs from all services
	docker compose -f $(COMPOSE_FILE) logs -f

logs-api: ## Follow API and worker logs only
	docker compose -f $(COMPOSE_FILE) logs -f api prefect_worker

logs-errors: ## Show only ERROR-level lines from all services (last 200 lines)
	@docker compose -f $(COMPOSE_FILE) logs --tail=200 2>&1 | grep -iE "error|exception|failed|traceback|critical" || echo "  (no errors found)"

shell: ## Open a bash shell in the API container
	docker compose -f $(COMPOSE_FILE) exec api /bin/bash

# ══════════════════════════════════════════════════════════════════════════════
## ── Database ─────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

migrate: ## Run all pending Alembic migrations
	docker compose -f $(COMPOSE_FILE) run --rm migrations alembic upgrade head

migrate-down: ## Roll back one migration
	docker compose -f $(COMPOSE_FILE) run --rm migrations alembic downgrade -1

# ══════════════════════════════════════════════════════════════════════════════
## ── Testing ──────────────────────────────────────────════════════════════════
# ══════════════════════════════════════════════════════════════════════════════

test: ## Run full test suite (unit + integration + contracts)
	pytest tests/ -v --asyncio-mode=auto --tb=short

test-unit: ## Run unit tests only
	pytest tests/unit/ -v

test-integration: ## Run integration tests only
	pytest tests/integration/ -v --asyncio-mode=auto

test-contracts: ## Run API contract / schema tests only
	pytest tests/contracts/ -v

test-all: ## Run all tests with coverage report
	pytest tests/ -v --asyncio-mode=auto --tb=short --cov=src --cov-report=term-missing --cov-report=html
	@echo ""
	@echo "  Coverage report: htmlcov/index.html"

coverage: ## Run tests and open HTML coverage report
	pytest tests/ --cov=src --cov-report=html --cov-report=term-missing
	@echo "  Coverage report: htmlcov/index.html"

# ══════════════════════════════════════════════════════════════════════════════
## ── Code Quality ─────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

lint: ## Lint Python source with ruff
	ruff check src/ tests/

format: ## Format Python source with ruff
	ruff format src/ tests/

typecheck: ## Run mypy type checker
	mypy src/ --ignore-missing-imports

security-check: ## Run security scanner (secrets, TLS, injection checks)
	$(PYTHON) scripts/security_check.py

# ══════════════════════════════════════════════════════════════════════════════
## ── Demo & Data ──────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

demo-data: ## Generate 30 days of synthetic transaction data
	$(PYTHON) scripts/generate_demo_data.py --days 30

demo-data-week: ## Generate 7 days of synthetic data (quick)
	$(PYTHON) scripts/generate_demo_data.py --days 7

webhook: ## Fire a single matched pair (Paystack + Flutterwave)
	$(PYTHON) scripts/simulate_webhooks.py matched-pair

webhook-batch: ## Fire 20 mixed webhook scenarios
	$(PYTHON) scripts/simulate_webhooks.py batch --count 20

webhook-unmatched: ## Fire an unmatched event (creates a discrepancy)
	$(PYTHON) scripts/simulate_webhooks.py unmatched --psp paystack

webhook-duplicate: ## Fire a duplicate event (tests idempotency handling)
	$(PYTHON) scripts/simulate_webhooks.py duplicate

replay: ## Replay all synthetic demo data through the API
	$(PYTHON) scripts/replay_demo_data.py

matching: ## Trigger the Silver→Gold matching flow manually
	docker compose exec prefect_worker $(PYTHON) -c \
		"import asyncio; from src.flows.matching_flow import silver_to_gold_matching_flow; print(asyncio.run(silver_to_gold_matching_flow()))"

smoke: ## Run smoke test against live stack (validates endpoints + data)
	@$(PYTHON) scripts/smoke_test.py

demo: ## Full demo setup: services + data + matching (dev)
	@$(PYTHON) scripts/investor_demo.py --days 7 --webhooks 30

# ══════════════════════════════════════════════════════════════════════════════
## ── Investor Demo ────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

demo-investor: ## Full investor demo: 30 days of data, verified pipeline
	@$(PYTHON) scripts/investor_demo.py --days 30 --webhooks 100 --monitoring

investor-reset: ## Clean + rebuild + full investor demo (fresh slate)
	@echo "⚠  This will destroy all current data. Starting fresh..."
	docker compose -f $(COMPOSE_FILE) down -v
	docker compose -f $(COMPOSE_FILE) up -d --build
	@$(PYTHON) scripts/wait_for_postgres.py
	docker compose -f $(COMPOSE_FILE) run --rm migrations alembic upgrade head
	@$(PYTHON) scripts/investor_demo.py --days 30 --webhooks 100 --monitoring

# ══════════════════════════════════════════════════════════════════════════════
## ── Dashboard ────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

dashboard: ## Start dashboard dev server (http://localhost:3000)
	cd dashboard && npm run dev

dashboard-install: ## Install dashboard npm dependencies
	cd dashboard && npm install

dashboard-build: ## Build dashboard for production
	cd dashboard && npm run build

# ══════════════════════════════════════════════════════════════════════════════
## ── Operations ───────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

status: ## Show container status, database tables, and record counts
	@echo ""
	@echo "  ── Containers ──────────────────────────────────────────────────"
	@docker compose -f $(COMPOSE_FILE) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
	@echo ""
	@echo "  ── Record Counts ───────────────────────────────────────────────"
	@docker compose -f $(COMPOSE_FILE) exec -T postgres psql -U $(PG_USER) -d $(PG_DB) -c \
		"SELECT \
		  'bronze_ingestion_log'           AS table_name, count(*) AS rows FROM bronze_ingestion_log \
		  UNION ALL SELECT 'silver_canonical_transactions', count(*) FROM silver_canonical_transactions \
		  UNION ALL SELECT 'gold_reconciliation_pairs',     count(*) FROM gold_reconciliation_pairs \
		  UNION ALL SELECT 'gold_discrepancies',            count(*) FROM gold_discrepancies \
		  ORDER BY table_name;" \
		2>/dev/null || echo "  (database not running — use 'make up')"
	@echo ""

# ══════════════════════════════════════════════════════════════════════════════
## ── Cleanup ──────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

clean: ## Remove containers, volumes, and generated files (DESTRUCTIVE)
	docker compose -f $(COMPOSE_FILE) down -v --remove-orphans
	$(PYTHON) scripts/clean_project.py

clean-dashboard: ## Remove dashboard node_modules and .next build cache
	$(PYTHON) scripts/clean_project.py --dashboard

clean-data: ## Remove only generated demo data files
	@$(PYTHON) -c "import shutil, os; shutil.rmtree('scripts/demo_data', ignore_errors=True); print('✓ Cleaned scripts/demo_data/')"

reset: ## Full reset: destroy all data + rebuild + migrate + seed (DESTRUCTIVE)
	@echo ""
	@echo "  ⚠  WARNING: This will permanently destroy all containers and data."
	@echo "  ⚠  Press Ctrl+C to cancel, or wait 5 seconds to continue..."
	@sleep 5
	docker compose -f $(COMPOSE_FILE) down -v --remove-orphans
	docker compose -f $(COMPOSE_FILE) up -d --build
	@$(PYTHON) scripts/wait_for_postgres.py
	docker compose -f $(COMPOSE_FILE) run --rm migrations alembic upgrade head
	$(PYTHON) scripts/generate_demo_data.py --days 7
	@echo ""
	@echo "  ✓ Full reset complete. System is clean and ready."
