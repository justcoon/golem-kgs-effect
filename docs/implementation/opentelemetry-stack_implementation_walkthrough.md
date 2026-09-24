# Implementation Walkthrough: OpenTelemetry Integration & Observability Stack

- **Feature ID / Slug**: `opentelemetry-stack`
- **Date**: 2026-09-24
- **Status**: Completed

---

## 1. Executive Summary

This implementation provides full-stack OpenTelemetry observability for `golem-kgs-effect`:
1. **Docker Compose Observability Suite**: Added OpenTelemetry Collector Contrib, Jaeger (distributed tracing UI), Prometheus (metric TSDB), and Grafana (pre-provisioned dashboards) both under profile `otel` in [docker-compose.yml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/docker-compose.yml) and via standalone [docker-compose.otel.yml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/docker-compose.otel.yml).
2. **Golem OTLP Plugin Configuration**: Enabled Golem's built-in `golem-otlp-exporter` (version `1.5.0`) on `golem-kgs-effect:effect-main` in [golem.yaml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/golem.yaml) for `local` development.
3. **E2E Test Isolation**: Explicitly disabled the OTLP plugin in the `test` preset using `pluginsMergeMode: replace` and `plugins: []`, ensuring `./run_e2e_test.sh` runs with zero external telemetry dependencies and no overhead.
4. **Zero Code Changes**: Leveraged Golem host runtime's automatic invocation root spans, host operation spans (database, S3, external HTTP), log correlation, and runtime metrics without altering any agent TypeScript code in `src/`.

---

## 2. Changes Implemented

### Observability Configuration Files
- [telemetry/otel-collector-config.yaml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/telemetry/otel-collector-config.yaml) `[NEW]`:
  - Receivers: OTLP HTTP (`:4318`) and gRPC (`:4317`).
  - Processors: `memory_limiter`, `batch`.
  - Exporters: `otlp/jaeger` (`jaeger:4317`), `prometheus` (`:8889`), `debug` logging.
  - Pipelines: Configured for traces, metrics, and logs.
- [telemetry/prometheus.yml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/telemetry/prometheus.yml) `[NEW]`:
  - Scrapes OTel Collector metrics endpoint at `otel-collector:8889` every 5 seconds.
- [telemetry/grafana/provisioning/datasources/datasources.yaml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/telemetry/grafana/provisioning/datasources/datasources.yaml) `[NEW]`:
  - Auto-provisions Prometheus (`http://prometheus:9090`) and Jaeger (`http://jaeger:16686`) datasources with zero manual configuration.

### Docker Compose
- [docker-compose.yml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/docker-compose.yml) `[MODIFY]`:
  - Added `otel-collector`, `jaeger`, `prometheus`, and `grafana` services under `profiles: ["otel"]` attached to `golem-kg-network`.
  - Added `prometheus_data` and `grafana_data` volumes.
- [docker-compose.otel.yml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/docker-compose.otel.yml) `[NEW]`:
  - Standalone compose file to start or manage the telemetry stack independently.

### Application Manifest & Environment
- [golem.yaml](file:///Users/coon/workspace-zv/git/golem-kgs-effect/golem.yaml) `[MODIFY]`:
  - Configured `plugins` on `golem-kgs-effect:effect-main` with `golem-otlp-exporter:1.5.0` pointing to `{{ OTLP_ENDPOINT }}` exporting `traces,logs,metrics`.
  - Configured `presets.test` with `pluginsMergeMode: replace` and `plugins: []` to guarantee the plugin is completely deactivated during E2E test runs.
- [.env](file:///Users/coon/workspace-zv/git/golem-kgs-effect/.env) & [.env.example](file:///Users/coon/workspace-zv/git/golem-kgs-effect/.env.example) `[MODIFY]`:
  - Added `OTLP_ENDPOINT`, `OTLP_PORT`, `OTLP_GRPC_PORT`, `JAEGER_PORT`, `PROMETHEUS_PORT`, `GRAFANA_PORT`.
- [.env.e2e](file:///Users/coon/workspace-zv/git/golem-kgs-effect/.env.e2e) & [.env.e2e.example](file:///Users/coon/workspace-zv/git/golem-kgs-effect/.env.e2e.example) `[MODIFY]`:
  - Added `OTLP_ENDPOINT=http://localhost:4318` to satisfy deploy-time template substitution during E2E tests.

---

## 3. Validation Results

All verification suites ran cleanly:

| Validation Step | Command | Result | Details |
|---|---|---|---|
| **Code Formatting** | `npm run format:check` | `PASS` | All TypeScript files match Prettier standard |
| **Type Check** | `npm run typecheck` | `PASS` | 0 compiler errors (`tsc --noEmit`) |
| **Linter** | `npm run lint` | `PASS` | 0 lint errors (`eslint src/ test/`) |
| **Golem Component Build** | `npm run build` | `PASS` | WASM component built cleanly (`golem build --yes`) |
| **Unit & Integration Tests** | `npm test` | `PASS` | 143 passed, 0 failed across 49 test suites |
| **End-to-End Test Suite** | `./run_e2e_test.sh` | `PASS` | 21 passed, 0 failed across 8 suites (telemetry isolated) |
| **Docker Compose Config** | `docker compose config --quiet` | `PASS` | Valid compose specification with telemetry enabled by default |
| **Standalone Compose Config** | `docker compose -f docker-compose.otel.yml config --quiet` | `PASS` | Valid standalone telemetry compose specification |

---

## 4. Usage & Verification Guide

### 1. Starting the Telemetry Stack

All observability services are enabled by default in `docker-compose.yml`. Start the entire local environment including telemetry:
```bash
docker compose up -d
```

*(Alternatively, to run only the telemetry stack independently, use `docker compose -f docker-compose.otel.yml up -d`).*

### 2. Available Endpoints

| Service | Protocol / Port | URL | Description |
|---|---|---|---|
| **OTel Collector** | HTTP `4318` / gRPC `4317` | `http://localhost:4318` | Ingestion endpoint for Golem exporter |
| **Jaeger UI** | HTTP `16686` | `http://localhost:16686` | Search and explore trace waterfalls |
| **Prometheus UI** | HTTP `9090` | `http://localhost:9090` | Query runtime metrics (`golem_invocation_*`) |
| **Grafana UI** | HTTP `3000` | `http://localhost:3000` | Dashboards (pre-configured datasources, no password needed) |

### 3. Deploying & Observing Invocations

Deploy with Golem in local mode:
```bash
./deploy.sh
# or
golem deploy --yes
```

When an agent method is invoked (e.g. via HTTP Gateway `http://localhost:9006/api/knowledge/overview` or MCP), Golem automatically streams:
- **Traces to Jaeger**: Open `http://localhost:16686`, select service `golem-kgs-effect:effect-main`, and click **Find Traces** to view invocation execution spans and host calls.
- **Metrics to Prometheus**: Open `http://localhost:9090` and query `golem_invocation_count` or `golem_invocation_duration_ns`.
- **Grafana**: Open `http://localhost:3000/explore` to run queries across both Prometheus and Jaeger datasources.

### 4. Running E2E Tests (Telemetry Isolated)

Run the standard E2E test runner:
```bash
./run_e2e_test.sh
```
Because the `test` preset overrides `plugins: []`, the E2E test runs with the OTLP exporter completely disabled.
