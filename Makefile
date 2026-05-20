.PHONY: up down build test test-unit test-integration test-contracts lint format \
        migrate data smoke logs shell clean security-check test-all help

## ── Environment ─────────────────────────────────────────────────────────────
up:          ## Start all core services
	docker compose up -d --build
	docker compose logs -f api prefect_worker

down:        ## Stop all services
	docker compose down

up-monitoring: ## Start core services + Prometheus + Grafana
	docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d

build:       ## Rebuild all Docker images
	docker compose build --no-cache

logs:        ## Follow logs for all services
	docker compose logs -f

shell:       ## Open a shell in the API container
	docker compose exec api /bin/bash

## ── Database ─────────────────────────────────────────────────────────────────
migrate:     ## Run Alembic migrations
	docker compose run --rm migrations alembic upgrade head

migrate-down: ## Rollback one migration
	docker compose run --rm migrations alembic downgrade -1

## ── Testing ──────────────────────────────────────────────────────────────────
test:        ## Run full test suite
	pytest tests/ -v --asyncio-mode=auto --tb=short

test-unit:   ## Run unit tests only
	pytest tests/unit/ -v

test-integration: ## Run integration tests only
	pytest tests/integration/ -v --asyncio-mode=auto

test-contracts: ## Run schema contract tests only
	pytest tests/contracts/ -v

coverage:    ## Run tests with coverage report
	pytest tests/ --cov=src --cov-report=html --cov-report=term-missing
	@echo "Coverage report: htmlcov/index.html"

## ── Code Quality ─────────────────────────────────────────────────────────────
lint:        ## Lint with ruff
	ruff check src/ tests/

format:      ## Format with ruff
	ruff format src/ tests/

typecheck:   ## Type check with mypy
	mypy src/ --ignore-missing-imports

security-check: ## Run CI security scanner (checks for secrets, disabled TLS, etc.)
	python scripts/security_check.py

test-all:    ## Run ALL test suites: unit + integration + contracts + coverage
	pytest tests/ -v --asyncio-mode=auto --tb=short --cov=src --cov-report=term-missing

## ── Demo & Data Simulation ──────────────────────────────────────────────────
demo-data:   ## Generate 30 days of synthetic transaction data
	python scripts/generate_demo_data.py --days 30

demo-data-week: ## Generate 7 days of synthetic data (quick)
	python scripts/generate_demo_data.py --days 7

webhook:     ## Fire a single matched pair (Paystack + Flutterwave)
	python scripts/simulate_webhooks.py matched-pair

webhook-batch: ## Fire 20 mixed webhook scenarios
	python scripts/simulate_webhooks.py batch --count 20

webhook-unmatched: ## Fire an unmatched event (creates discrepancy)
	python scripts/simulate_webhooks.py unmatched --psp paystack

webhook-duplicate: ## Fire a duplicate event (tests idempotency)
	python scripts/simulate_webhooks.py duplicate

demo:        ## Full demo setup: services + migrations + synthetic data + webhooks
	@echo "🚀 Starting full demo environment..."
	docker compose up -d --build
	@echo "⏳ Waiting for services to start..."
	sleep 10
	docker compose run --rm migrations alembic upgrade head
	@echo "📊 Generating synthetic data..."
	python scripts/generate_demo_data.py --days 7
	@echo "📡 Firing webhook batch..."
	python scripts/simulate_webhooks.py batch --count 30
	@echo ""
	@echo "✅ Demo ready!"
	@echo "   Dashboard: http://localhost:3000"
	@echo "   API:       http://localhost:8000/docs"
	@echo "   Health:    http://localhost:8000/health/ready"
	@echo "   Metrics:   http://localhost:8000/metrics"
	@echo "   Prefect:   http://localhost:4200"
	@echo "   MinIO:     http://localhost:9001"

## ── Dashboard ─────────────────────────────────────────────────────────────
dashboard:   ## Start dashboard dev server (local development)
	cd dashboard && npm run dev

dashboard-install: ## Install dashboard dependencies
	cd dashboard && npm install

dashboard-build: ## Build dashboard for production
	cd dashboard && npm run build

## ── Investor Demo ─────────────────────────────────────────────────────────
demo-investor: ## Full investor demo: all services + monitoring + 30-day data
	@echo "🎯 Preparing investor demo environment..."
	docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d --build
	@echo "⏳ Waiting for services..."
	sleep 15
	docker compose run --rm migrations alembic upgrade head
	@echo "📊 Generating 30 days of realistic data..."
	python scripts/generate_demo_data.py --days 30
	python scripts/simulate_webhooks.py batch --count 100
	@echo ""
	@echo "✅ Investor demo ready!"
	@echo ""
	@echo "   🖥️  Dashboard:  http://localhost:3000"
	@echo "   📊 Grafana:    http://localhost:3001 (admin/admin)"
	@echo "   🔗 API Docs:   http://localhost:8000/docs"
	@echo "   📈 Prometheus: http://localhost:9090"
	@echo "   📬 Prefect:    http://localhost:4200"

smoke:       ## Run smoke test against running stack
	@echo "Checking API health..."
	curl -sf http://localhost:8000/health | python -m json.tool
	@echo "\nChecking deep health..."
	curl -sf http://localhost:8000/health/ready | python -m json.tool
	@echo "\nSmoke test passed ✅"

## ── Cleanup ─────────────────────────────────────────────────────────────────
clean:       ## Remove all containers, volumes, and generated files
	docker compose down -v --remove-orphans
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	rm -rf .coverage htmlcov/ .pytest_cache/ scripts/demo_data/

clean-dashboard: ## Remove dashboard node_modules and build
	rm -rf dashboard/node_modules dashboard/.next

## ── Help ──────────────────────────────────────────────────────────────────
help:        ## Show available commands
	@echo "MMR Engine — Available Commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

