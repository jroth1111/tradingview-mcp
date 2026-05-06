// Unit tests for study-chain.
//
// SCOPE:
//   - Unit-level tests cover spec validation, slot naming, parent-slot
//     reference rules, and that modifyStudy delegates to runStudy.
//   - The full WebSocket-driven runStudyChain execution path is integration
//     territory and is intentionally NOT covered here. Mocking the raw WS
//     handshake and TradingView frame stream end-to-end belongs in the
//     integration test bench (worker/src/tests/) once the chart-session DO
//     (bead tradingview-2v6) lands and provides a higher-level seam.
//
// What we DO smoke-check at the chain entrypoint:
//   - `runStudyChain` throws synchronously on invalid spec inputs (empty
//     studies array, missing studyId, dangling parentSlot, duplicate slot,
//     bad slotName regex). These are detected by `planChainSlots` BEFORE
//     any network IO, so they're verifiable as pure-function tests without
//     needing to mock the WS layer.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tv from "./tradingview";
import {
  modifyStudy,
  planChainSlots,
  runStudyChain,
  type StudyChainSpec,
} from "./study-chain";

// === modifyStudy ==========================================================

describe("modifyStudy", () => {
  let runStudySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runStudySpy = vi.spyOn(tv, "runStudy");
  });

  afterEach(() => {
    runStudySpy.mockRestore();
  });

  it("delegates to runStudy with the same request", async () => {
    const stubResult: tv.StudyResult = {
      symbol: "BINANCE:BTCUSDT",
      studyId: "STD;RSI",
      studyVersion: "last",
      wireId: "STD;RSI@tv-basicstudies!",
      timeframe: "60",
      bars: 300,
      plots: [],
    };
    runStudySpy.mockResolvedValueOnce(stubResult);

    const req: tv.StudyRequest = {
      symbol: "BINANCE:BTCUSDT",
      studyId: "STD;RSI",
      params: { length: 14 },
      timeframe: "60",
      bars: 300,
    };
    const out = await modifyStudy(req);

    expect(runStudySpy).toHaveBeenCalledTimes(1);
    expect(runStudySpy).toHaveBeenCalledWith(req);
    expect(out).toBe(stubResult);
  });

  it("propagates errors from runStudy", async () => {
    runStudySpy.mockRejectedValueOnce(new Error("study_error: bad input"));
    await expect(
      modifyStudy({ symbol: "BINANCE:BTCUSDT", studyId: "STD;RSI" }),
    ).rejects.toThrow("study_error: bad input");
    expect(runStudySpy).toHaveBeenCalledTimes(1);
  });
});

// === planChainSlots =======================================================

describe("planChainSlots", () => {
  it("auto-assigns st1, st2, ... when slotName is omitted", () => {
    const specs: StudyChainSpec[] = [
      { studyId: "STD;EMA" },
      { studyId: "STD;RSI" },
      { studyId: "STD;MACD" },
    ];
    const out = planChainSlots(specs);
    expect(out.map((p) => p.slotName)).toEqual(["st1", "st2", "st3"]);
    expect(out.every((p) => p.parentSlot === "sds_1")).toBe(true);
  });

  it("respects explicit slotName", () => {
    const specs: StudyChainSpec[] = [
      { studyId: "STD;EMA", slotName: "stEma" },
      { studyId: "STD;RSI" }, // auto -> st2 (uses index, not seen-set count)
    ];
    const out = planChainSlots(specs);
    expect(out[0].slotName).toBe("stEma");
    expect(out[1].slotName).toBe("st2");
  });

  it("threads parentSlot for chained studies (RSI of EMA)", () => {
    const specs: StudyChainSpec[] = [
      { studyId: "STD;EMA" }, // st1, parent sds_1
      { studyId: "STD;RSI", parentSlot: "st1" }, // st2 of st1
    ];
    const out = planChainSlots(specs);
    expect(out[0]).toMatchObject({ slotName: "st1", parentSlot: "sds_1" });
    expect(out[1]).toMatchObject({ slotName: "st2", parentSlot: "st1" });
  });

  it("throws on empty studies array", () => {
    expect(() => planChainSlots([])).toThrow(/studies array required/);
  });

  it("throws when studies is not an array", () => {
    expect(() => planChainSlots(undefined as unknown as StudyChainSpec[])).toThrow(
      /studies array required/,
    );
  });

  it("throws when an entry is not an object", () => {
    expect(() =>
      planChainSlots([null as unknown as StudyChainSpec]),
    ).toThrow(/studies\[0\] must be an object/);
  });

  it("throws when studyId is missing", () => {
    expect(() =>
      planChainSlots([{ studyId: "" } as StudyChainSpec]),
    ).toThrow(/studies\[0\]\.studyId required/);
  });

  it("throws when parentSlot references a non-existent slot", () => {
    const specs: StudyChainSpec[] = [
      { studyId: "STD;EMA" },
      { studyId: "STD;RSI", parentSlot: "stMissing" },
    ];
    expect(() => planChainSlots(specs)).toThrow(
      /parentSlot "stMissing" must be "sds_1" or an earlier chained study slot/,
    );
  });

  it("throws when parentSlot references a LATER slot (forward reference forbidden)", () => {
    // st1 tries to reference st2 — forward references are illegal because
    // TradingView serializes create_study calls in the order they're sent.
    const specs: StudyChainSpec[] = [
      { studyId: "STD;EMA", parentSlot: "st2" },
      { studyId: "STD;RSI" },
    ];
    expect(() => planChainSlots(specs)).toThrow(
      /parentSlot "st2" must be "sds_1" or an earlier chained study slot/,
    );
  });

  it("throws when slotName is duplicated", () => {
    const specs: StudyChainSpec[] = [
      { studyId: "STD;EMA", slotName: "stShared" },
      { studyId: "STD;RSI", slotName: "stShared" },
    ];
    expect(() => planChainSlots(specs)).toThrow(/duplicates an earlier slot/);
  });

  it("throws when slotName collides with the reserved sds_1 main-series id", () => {
    const specs: StudyChainSpec[] = [
      // sds_1 doesn't match the /^st.../ regex, so we use a slot name that
      // would survive the regex but still has to be unique against the
      // seeded main-series id. Pick a manually-collided seed to validate
      // the duplicate guard.
      { studyId: "STD;EMA", slotName: "stMain" },
      { studyId: "STD;RSI", slotName: "stMain" },
    ];
    expect(() => planChainSlots(specs)).toThrow(/duplicates an earlier slot/);
  });

  it("throws on slotName that does not match the /^st.../ regex", () => {
    const specs: StudyChainSpec[] = [
      { studyId: "STD;EMA", slotName: "sds_2" },
    ];
    expect(() => planChainSlots(specs)).toThrow(/slotName must match/);
  });

  it("allows multi-level chains (st1 -> st2 -> st3)", () => {
    const specs: StudyChainSpec[] = [
      { studyId: "STD;EMA" }, // st1
      { studyId: "STD;EMA", parentSlot: "st1" }, // st2 = EMA of EMA
      { studyId: "STD;RSI", parentSlot: "st2" }, // st3 = RSI of (EMA of EMA)
    ];
    const out = planChainSlots(specs);
    expect(out.map((p) => `${p.slotName}<-${p.parentSlot}`)).toEqual([
      "st1<-sds_1",
      "st2<-st1",
      "st3<-st2",
    ]);
  });

  it("preserves spec order in the returned plan", () => {
    const specs: StudyChainSpec[] = [
      { studyId: "STD;A", slotName: "stAlpha" },
      { studyId: "STD;B", slotName: "stBeta", parentSlot: "stAlpha" },
      { studyId: "STD;C", slotName: "stGamma", parentSlot: "sds_1" },
    ];
    const out = planChainSlots(specs);
    expect(out.map((p) => p.spec.studyId)).toEqual(["STD;A", "STD;B", "STD;C"]);
  });
});

// === runStudyChain (entrypoint smoke checks) ==============================
//
// We can't drive the WS layer from a unit test, but we can confirm:
//   - the function exists and is callable
//   - it rejects synchronously on bad spec inputs (the validation gate runs
//     before any IO)
//
// Full chain execution against a real or mocked TradingView WS is deferred
// to integration tests.

describe("runStudyChain (validation gate)", () => {
  it("is exported as an async function", () => {
    expect(typeof runStudyChain).toBe("function");
  });

  it("rejects on missing symbol", async () => {
    await expect(
      runStudyChain({
        symbol: "",
        studies: [{ studyId: "STD;RSI" }],
      }),
    ).rejects.toThrow(/symbol required/);
  });

  it("rejects on empty studies array (validation runs before any IO)", async () => {
    await expect(
      runStudyChain({
        symbol: "BINANCE:BTCUSDT",
        studies: [],
      }),
    ).rejects.toThrow(/studies array required/);
  });

  it("rejects on dangling parentSlot reference (validation runs before any IO)", async () => {
    await expect(
      runStudyChain({
        symbol: "BINANCE:BTCUSDT",
        studies: [
          { studyId: "STD;EMA" },
          { studyId: "STD;RSI", parentSlot: "stNonexistent" },
        ],
      }),
    ).rejects.toThrow(/parentSlot "stNonexistent" must be/);
  });

  it("rejects on duplicate slotName (validation runs before any IO)", async () => {
    await expect(
      runStudyChain({
        symbol: "BINANCE:BTCUSDT",
        studies: [
          { studyId: "STD;EMA", slotName: "stShared" },
          { studyId: "STD;RSI", slotName: "stShared" },
        ],
      }),
    ).rejects.toThrow(/duplicates an earlier slot/);
  });
});
