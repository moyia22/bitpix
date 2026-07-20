const counters = new Map<string, number>();
const timings = new Map<string, { count: number; totalMs: number; maxMs: number }>();

export function incrementPaymentMetric(name: string, amount = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + amount);
}

export function observePaymentMetric(name: string, durationMs: number): void {
  const current = timings.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
  timings.set(name, { count: current.count + 1, totalMs: current.totalMs + durationMs, maxMs: Math.max(current.maxMs, durationMs) });
}

export function paymentMetricsSnapshot(): Record<string, unknown> {
  return {
    counters: Object.fromEntries(counters),
    timings: Object.fromEntries([...timings].map(([key, value]) => [key, { ...value, averageMs: value.count ? Math.round(value.totalMs / value.count) : 0 }])),
  };
}
