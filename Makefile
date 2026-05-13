.PHONY: up down build test test-unit test-integration test-contracts lint format \
        migrate seed data smoke logs shell clean

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

seed:        ## Seed settlement windows and test data
	docker compose exec prefect_worker python scripts/seed_settlement_windows.py

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
	@echo "   API:       http://localhost:8000/docs"
	@echo "   Health:    http://localhost:8000/health/ready"
	@echo "   Metrics:   http://localhost:8000/metrics"
	@echo "   Prefect:   http://localhost:4200"
	@echo "   MinIO:     http://localhost:9001"

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

