// Unit tests for ws-events decoders. Asserts the discriminated-union shape
// for every covered verb plus rejection of malformed frames.

import { describe, expect, it } from "vitest";
import { decodeWSEvent } from "./ws-events";

describe("decodeWSEvent", () => {
  it("decodes study_loading [slot, turnaround]", () => {
    const ev = decodeWSEvent({ m: "study_loading", p: ["st1", "sess1"] });
    expect(ev).toEqual({ kind: "study_loading", slot: "st1", turnaround: "sess1" });
  });

  it("returns invalid for malformed study_loading", () => {
    const ev = decodeWSEvent({ m: "study_loading", p: ["st1"] });
    expect(ev?.kind).toBe("invalid");
    expect((ev as any).method).toBe("study_loading");
  });

  it("decodes tickmark_update [slot, ...rest]", () => {
    const ev = decodeWSEvent({
      m: "tickmark_update",
      p: ["sds_1", { ev: "earnings", ts: 123 }],
    });
    expect(ev).toEqual({
      kind: "tickmark_update",
      slot: "sds_1",
      rest: [{ ev: "earnings", ts: 123 }],
    });
  });

  it("decodes index_update [slot, ...rest]", () => {
    const ev = decodeWSEvent({ m: "index_update", p: ["st1", { recompute: true }] });
    expect(ev).toEqual({
      kind: "index_update",
      slot: "st1",
      rest: [{ recompute: true }],
    });
  });

  it("decodes clear_data with [cs, slot] payload", () => {
    const ev = decodeWSEvent({ m: "clear_data", p: ["cs_1", "st1"] });
    expect(ev).toEqual({ kind: "clear_data", slot: "st1" });
  });

  it("decodes clear_data with [slot] alone", () => {
    const ev = decodeWSEvent({ m: "clear_data", p: ["sds_1"] });
    expect(ev).toEqual({ kind: "clear_data", slot: "sds_1" });
  });

  it("decodes studies_metadata payload as opaque", () => {
    const meta = [{ id: "STD;RSI", inputs: [] }];
    const ev = decodeWSEvent({ m: "studies_metadata", p: meta });
    expect(ev).toEqual({ kind: "studies_metadata", payload: meta });
  });

  it("decodes protocol_error [reason, ...]", () => {
    const ev = decodeWSEvent({
      m: "protocol_error",
      p: ["unknown_method", { detail: "x" }],
    });
    expect(ev).toEqual({
      kind: "protocol_error",
      reason: "unknown_method",
      rest: [{ detail: "x" }],
    });
  });

  it("decodes protocol_switched [version]", () => {
    const ev = decodeWSEvent({ m: "protocol_switched", p: ["v2"] });
    expect(ev).toEqual({ kind: "protocol_switched", version: "v2" });
  });

  it("decodes critical_error [reason]", () => {
    const ev = decodeWSEvent({ m: "critical_error", p: ["session_lost"] });
    expect(ev).toEqual({ kind: "critical_error", reason: "session_lost", rest: [] });
  });

  it("decodes replay_data_end [rs, slot]", () => {
    const ev = decodeWSEvent({ m: "replay_data_end", p: ["rs_1", "rs1s"] });
    expect(ev).toEqual({ kind: "replay_data_end", replaySession: "rs_1", slot: "rs1s" });
  });

  it("decodes replay_depth [rs, slot, depth]", () => {
    const ev = decodeWSEvent({ m: "replay_depth", p: ["rs_1", "rs1s", 5000] });
    expect(ev).toEqual({
      kind: "replay_depth",
      replaySession: "rs_1",
      slot: "rs1s",
      depth: 5000,
    });
  });

  it("decodes replay_resolutions [rs, slot, [resolutions]]", () => {
    const ev = decodeWSEvent({
      m: "replay_resolutions",
      p: ["rs_1", "rs1s", ["1", "5", "60", "1D"]],
    });
    expect(ev).toEqual({
      kind: "replay_resolutions",
      replaySession: "rs_1",
      slot: "rs1s",
      resolutions: ["1", "5", "60", "1D"],
    });
  });

  it("decodes replay_instance_id [rs, slot, instance_id]", () => {
    const ev = decodeWSEvent({
      m: "replay_instance_id",
      p: ["rs_1", "rs1s", "inst-abc"],
    });
    expect(ev).toEqual({
      kind: "replay_instance_id",
      replaySession: "rs_1",
      slot: "rs1s",
      instanceId: "inst-abc",
    });
  });

  it("decodes notify (n) as opaque payload", () => {
    const ev = decodeWSEvent({ m: "n", p: [{ tag: "alert" }] });
    expect(ev).toEqual({ kind: "notify", payload: [{ tag: "alert" }] });
  });

  it("decodes meta (m) as opaque payload", () => {
    const ev = decodeWSEvent({ m: "m", p: [42] });
    expect(ev).toEqual({ kind: "meta", payload: [42] });
  });

  it("decodes get_first_bar_time response with [cs, sds, ts]", () => {
    const ev = decodeWSEvent({
      m: "get_first_bar_time",
      p: ["cs_1", "sds_1", 946684800],
    });
    expect(ev).toEqual({
      kind: "get_first_bar_time",
      chartSession: "cs_1",
      seriesId: "sds_1",
      firstBarTime: 946684800,
    });
  });

  it("decodes get_first_bar_time response with [sds, ts] (compat)", () => {
    const ev = decodeWSEvent({ m: "get_first_bar_time", p: ["sds_1", 946684800] });
    expect(ev).toEqual({
      kind: "get_first_bar_time",
      chartSession: "",
      seriesId: "sds_1",
      firstBarTime: 946684800,
    });
  });

  it("returns null for unknown verbs (e.g. timescale_update, du)", () => {
    expect(decodeWSEvent({ m: "timescale_update", p: ["cs_1", {}] })).toBeNull();
    expect(decodeWSEvent({ m: "du", p: ["cs_1", {}] })).toBeNull();
    expect(decodeWSEvent({ m: "study_completed", p: ["st1", "sess1"] })).toBeNull();
  });

  it("returns null for missing/empty method", () => {
    expect(decodeWSEvent(null)).toBeNull();
    expect(decodeWSEvent(undefined)).toBeNull();
    expect(decodeWSEvent({})).toBeNull();
    expect(decodeWSEvent({ m: "" })).toBeNull();
  });

  it("accepts legacy `method` field as method alias", () => {
    const ev = decodeWSEvent({ method: "study_loading", p: ["st1", "s1"] });
    expect(ev).toEqual({ kind: "study_loading", slot: "st1", turnaround: "s1" });
  });

  it("returns invalid for malformed replay_depth (wrong types)", () => {
    const ev = decodeWSEvent({ m: "replay_depth", p: ["rs_1", "rs1s", "lots"] });
    expect(ev?.kind).toBe("invalid");
  });

  it("returns invalid for malformed replay_resolutions list elements", () => {
    const ev = decodeWSEvent({
      m: "replay_resolutions",
      p: ["rs_1", "rs1s", ["60", 60]],
    });
    expect(ev?.kind).toBe("invalid");
  });

  it("does not throw on completely malformed frame", () => {
    expect(() => decodeWSEvent({ m: "study_loading", p: undefined as any })).not.toThrow();
    expect(() => decodeWSEvent({ m: "studies_metadata" })).not.toThrow();
  });
});
