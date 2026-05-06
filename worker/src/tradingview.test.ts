import { describe, expect, it } from "vitest";
import { trimIncomingCandlesForBatch } from "./tradingview";

describe("trimIncomingCandlesForBatch", () => {
  it("keeps the first oversized batch instead of slicing with -0", () => {
    expect(trimIncomingCandlesForBatch([1, 2, 3], [], 2)).toEqual([1, 2]);
  });

  it("trims overlap only when existing candles are present", () => {
    expect(trimIncomingCandlesForBatch([1, 2, 3, 4], [3, 4], 2)).toEqual([1, 2]);
  });
});
