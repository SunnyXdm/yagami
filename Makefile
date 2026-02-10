# Yagami — test runner
# Run `make test` to run all unit tests, `make test-integration` for full pipeline.

.PHONY: test test-python test-go test-elixir test-rust test-integration test-workflow

# ── All unit tests ───────────────────────────────────────────
test: test-python test-go test-elixir test-rust
	@echo "\n✓ All unit tests passed"

# ── Individual services ──────────────────────────────────────
test-python:
	@echo "═══ Python (telegram-client) ═══"
	cd services/telegram-client && python -m pytest tests/ -v --tb=short

test-go:
	@echo "═══ Go (api-gateway) ═══"
	cd services/api-gateway && go test ./... -v -race

test-elixir:
	@echo "═══ Elixir (youtube-poller) ═══"
	cd services/youtube-poller && mix test --trace

test-rust:
	@echo "═══ Rust (downloader) ═══"
	cd services/downloader && cargo test --verbose

# ── Integration tests (requires docker compose up -d postgres nats) ──
test-integration:
	@echo "═══ Integration Tests ═══"
	python -m pytest tests/test_integration.py -v --tb=short

test-workflow:
	@echo "═══ Workflow Tests ═══"
	python -m pytest tests/test_workflow.py -v --tb=short

# ── Full test suite (unit + integration) ─────────────────────
test-all: test
	@echo "\n═══ Starting infrastructure for integration tests... ═══"
	docker compose up -d postgres nats
	sleep 5
	$(MAKE) test-integration
	$(MAKE) test-workflow
	docker compose down
	@echo "\n✓ All tests passed"
