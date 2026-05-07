import { describe, expect, it } from "vitest";

import { clampBarCount } from "./clamp-bars";

describe("clampBarCount(chart)", () => {
  it("uses plan cap when requested is undefined", () => {
    const r = clampBarCount(undefined, "chart", "premium");
    expect(r.bars).toBe(25_000);
    expect(r.cap).toBe(25_000);
    expect(r.clamped).toBe(false);
    expect(r.mode).toBe("chart");
    expect(r.plan).toBe("premium");
  });

  it("clamps requested above cap", () => {
    const r = clampBarCount(50_000, "chart", "pro");
    expect(r.bars).toBe(10_000);
    expect(r.cap).toBe(10_000);
    expect(r.clamped).toBe(true);
  });

  it("preserves requested when below cap", () => {
    const r = clampBarCount(300, "chart", "premium");
    expect(r.bars).toBe(300);
    expect(r.clamped).toBe(false);
  });

  it("treats unknown plan as 20k chart cap (legacy MAX_BATCH_SIZE)", () => {
    const r = clampBarCount(undefined, "chart", "unknown");
    expect(r.cap).toBe(20_000);
  });

  it("treats negative or NaN requested as cap fallback", () => {
    expect(clampBarCount(-1, "chart", "free").bars).toBe(5_000);
    expect(clampBarCount(Number.NaN, "chart", "free").bars).toBe(5_000);
    expect(clampBarCount(0, "chart", "free").bars).toBe(5_000);
  });

  it("floors fractional requested values", () => {
    expect(clampBarCount(123.7, "chart", "premium").bars).toBe(123);
  });

  it("plan caps follow the public documented limits", () => {
    expect(clampBarCount(undefined, "chart", "free").cap).toBe(5_000);
    expect(clampBarCount(undefined, "chart", "pro").cap).toBe(10_000);
    expect(clampBarCount(undefined, "chart", "pro_plus").cap).toBe(20_000);
    expect(clampBarCount(undefined, "chart", "premium").cap).toBe(25_000);
  });
});

describe("clampBarCount(chartExtended)", () => {
  it("multiplies the chart cap (premium x8)", () => {
    const r = clampBarCount(undefined, "chartExtended", "premium");
    expect(r.cap).toBe(200_000);
    expect(r.bars).toBe(200_000);
  });

  it("multiplies the chart cap (pro_plus x5)", () => {
    const r = clampBarCount(undefined, "chartExtended", "pro_plus");
    expect(r.cap).toBe(100_000);
  });

  it("clamps when requested exceeds extended cap", () => {
    const r = clampBarCount(500_000, "chartExtended", "premium");
    expect(r.bars).toBe(200_000);
    expect(r.clamped).toBe(true);
  });
});

describe("clampBarCount(deep)", () => {
  it("returns probeOnly:true and never clamps", () => {
    const r = clampBarCount(1_500_000, "deep", "premium");
    expect(r.probeOnly).toBe(true);
    expect(r.clamped).toBe(false);
    expect(r.bars).toBe(1_500_000);
    expect(r.cap).toBe(2_000_000);
  });

  it("uses the probe cap when requested is undefined", () => {
    const r = clampBarCount(undefined, "deep", "premium");
    expect(r.bars).toBe(2_000_000);
    expect(r.probeOnly).toBe(true);
  });
});

describe("clampBarCount(unknown plan handling)", () => {
  it("normalises an out-of-set plan to 'unknown'", () => {
    const r = clampBarCount(undefined, "chart", "elite" as never);
    expect(r.plan).toBe("unknown");
    expect(r.cap).toBe(20_000);
  });
});
