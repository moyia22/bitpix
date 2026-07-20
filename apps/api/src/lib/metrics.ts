import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: "bitpix_" });

export const httpRequests = new Counter({
  name: "bitpix_http_requests_total",
  help: "Total de requisições HTTP",
  labelNames: ["method", "route", "status"] as const,
  registers: [metricsRegistry],
});

export const httpDuration = new Histogram({
  name: "bitpix_http_request_duration_seconds",
  help: "Duração das requisições HTTP",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const dependencyHealth = new Gauge({
  name: "bitpix_dependency_health",
  help: "Estado de saúde das dependências (1 saudável, 0 indisponível)",
  labelNames: ["dependency"] as const,
  registers: [metricsRegistry],
});

export const oldPendingCharges = new Gauge({
  name: "bitpix_pending_charges_old",
  help: "Cobranças pendentes há mais de quinze minutos",
  registers: [metricsRegistry],
});
