// Unit tests for ws-verbs framing helpers. One test per verb asserts wire
// shape against the documented positional layout in
// /tmp/tv-recon/agents/01-websocket.md and 16-chart-session-indicators.md.
//
// Invariants asserted:
//   - Frame envelope is `~m~<byte-len>~m~{json}` with byte-accurate length.
//   - JSON body has exactly `{m: <verb>, p: [...positional args]}` in the
//     documented order.
//   - Required-arg validation throws a descriptive Error.

import { describe, expect, it } from "vitest";
import * as v from "./ws-verbs";

const parseFrame = (framed: string): { name: string; params: any[]; len: number } => {
  const match = framed.match(/^~m~(\d+)~m~(.+)$/s);
  if (!match) throw new Error(`not a TV frame: ${framed}`);
  const len = Number(match[1]);
  const body = JSON.parse(match[2]);
  return { name: body.m, params: body.p, len };
};

const expectByteLen = (framed: string) => {
  const match = framed.match(/^~m~(\d+)~m~(.+)$/s);
  expect(match).toBeTruthy();
  const declared = Number(match![1]);
  const actual = new TextEncoder().encode(match![2]).length;
  expect(declared).toBe(actual);
};

describe("ws-verbs framing", () => {
  it("modify_series wires [cs, sds, source, sym, tf, count]", () => {
    const out = v.modifySeries({
      chartSession: "cs_1",
      seriesId: "sds_1",
      sourceId: "s1",
      symbolId: "sds_sym_1",
      timeframe: "60",
      count: 300,
    });
    const f = parseFrame(out);
    expect(f.name).toBe("modify_series");
    expect(f.params).toEqual(["cs_1", "sds_1", "s1", "sds_sym_1", "60", 300]);
    expectByteLen(out);
  });

  it("modify_series rejects missing chart session", () => {
    expect(() =>
      v.modifySeries({
        chartSession: "",
        seriesId: "sds_1",
        sourceId: "s1",
        symbolId: "sds_sym_1",
        timeframe: "60",
        count: 300,
      }),
    ).toThrow(/chartSession/);
  });

  it("remove_series wires [cs, sds]", () => {
    const f = parseFrame(v.removeSeries({ chartSession: "cs_1", seriesId: "sds_1" }));
    expect(f.name).toBe("remove_series");
    expect(f.params).toEqual(["cs_1", "sds_1"]);
  });

  it("series_timeframe wires [cs, sds, source, tf] without range", () => {
    const f = parseFrame(
      v.seriesTimeframe({
        chartSession: "cs_1",
        seriesId: "sds_1",
        sourceId: "s1",
        timeframe: "60",
      }),
    );
    expect(f.name).toBe("series_timeframe");
    expect(f.params).toEqual(["cs_1", "sds_1", "s1", "60"]);
  });

  it("series_timeframe wires [cs, sds, source, tf, {from,to}] with range", () => {
    const f = parseFrame(
      v.seriesTimeframe({
        chartSession: "cs_1",
        seriesId: "sds_1",
        sourceId: "s1",
        timeframe: "60",
        range: { from: 1577836800, to: 1893456000 },
      }),
    );
    expect(f.params).toEqual([
      "cs_1",
      "sds_1",
      "s1",
      "60",
      { from: 1577836800, to: 1893456000 },
    ]);
  });

  it("set_data_quality wires [cs, 'low'|'high'] and rejects bad values", () => {
    const f = parseFrame(v.setDataQuality({ chartSession: "cs_1", quality: "low" }));
    expect(f.name).toBe("set_data_quality");
    expect(f.params).toEqual(["cs_1", "low"]);
    expect(() =>
      v.setDataQuality({ chartSession: "cs_1", quality: "medium" as any }),
    ).toThrow(/low.*high/);
  });

  it("switch_timezone wires [cs, tz]", () => {
    const f = parseFrame(
      v.switchTimezone({ chartSession: "cs_1", timezone: "Etc/UTC" }),
    );
    expect(f.name).toBe("switch_timezone");
    expect(f.params).toEqual(["cs_1", "Etc/UTC"]);
  });

  it("set_future_tickmarks_mode wires [cs, mode]", () => {
    const f = parseFrame(
      v.setFutureTickmarksMode({ chartSession: "cs_1", mode: 1 }),
    );
    expect(f.name).toBe("set_future_tickmarks_mode");
    expect(f.params).toEqual(["cs_1", 1]);
  });

  it("request_more_tickmarks wires [cs, slot, count]", () => {
    const f = parseFrame(
      v.requestMoreTickmarks({ chartSession: "cs_1", slot: "sds_1", count: 10 }),
    );
    expect(f.name).toBe("request_more_tickmarks");
    expect(f.params).toEqual(["cs_1", "sds_1", 10]);
  });

  it("request_studies_metadata wires [cs]", () => {
    const f = parseFrame(v.requestStudiesMetadata({ chartSession: "cs_1" }));
    expect(f.name).toBe("request_studies_metadata");
    expect(f.params).toEqual(["cs_1"]);
  });

  it("request_data_problems wires [cs]", () => {
    const f = parseFrame(v.requestDataProblems({ chartSession: "cs_1" }));
    expect(f.name).toBe("request_data_problems");
    expect(f.params).toEqual(["cs_1"]);
  });

  it("set_broker wires [cs, broker_id]", () => {
    const f = parseFrame(v.setBroker({ chartSession: "cs_1", brokerId: "ALPACA" }));
    expect(f.name).toBe("set_broker");
    expect(f.params).toEqual(["cs_1", "ALPACA"]);
  });

  it("remove_study wires [cs, st_id]", () => {
    const f = parseFrame(v.removeStudy({ chartSession: "cs_1", studyId: "st1" }));
    expect(f.name).toBe("remove_study");
    expect(f.params).toEqual(["cs_1", "st1"]);
  });

  it("notify_study wires [cs, st_id, ...args]", () => {
    const f = parseFrame(
      v.notifyStudy({ chartSession: "cs_1", studyId: "st1", args: [{ ack: true }, 7] }),
    );
    expect(f.name).toBe("notify_study");
    expect(f.params).toEqual(["cs_1", "st1", { ack: true }, 7]);
  });

  it("chart_delete_session wires [cs]", () => {
    const f = parseFrame(v.chartDeleteSession({ chartSession: "cs_1" }));
    expect(f.name).toBe("chart_delete_session");
    expect(f.params).toEqual(["cs_1"]);
  });

  it("get_first_bar_time wires [cs, sds]", () => {
    const f = parseFrame(
      v.getFirstBarTime({ chartSession: "cs_1", seriesId: "sds_1" }),
    );
    expect(f.name).toBe("get_first_bar_time");
    expect(f.params).toEqual(["cs_1", "sds_1"]);
  });

  it("create_pointset wires [cs, ps, ...args]", () => {
    const f = parseFrame(
      v.createPointset({
        chartSession: "cs_1",
        pointsetId: "ps_1",
        args: [{ id: "p1", x: 1, y: 2 }],
      }),
    );
    expect(f.name).toBe("create_pointset");
    expect(f.params).toEqual(["cs_1", "ps_1", { id: "p1", x: 1, y: 2 }]);
  });

  it("modify_pointset wires [cs, ps, ...args]", () => {
    const f = parseFrame(
      v.modifyPointset({
        chartSession: "cs_1",
        pointsetId: "ps_1",
        args: [{ id: "p1", x: 9 }],
      }),
    );
    expect(f.name).toBe("modify_pointset");
    expect(f.params).toEqual(["cs_1", "ps_1", { id: "p1", x: 9 }]);
  });

  it("remove_pointset wires [cs, ps]", () => {
    const f = parseFrame(
      v.removePointset({ chartSession: "cs_1", pointsetId: "ps_1" }),
    );
    expect(f.name).toBe("remove_pointset");
    expect(f.params).toEqual(["cs_1", "ps_1"]);
  });

  it("replay_set_resolution wires [rs, slot, tf]", () => {
    const f = parseFrame(
      v.replaySetResolution({ replaySession: "rs_1", slot: "rs1s", timeframe: "60" }),
    );
    expect(f.name).toBe("replay_set_resolution");
    expect(f.params).toEqual(["rs_1", "rs1s", "60"]);
  });

  it("replay_get_depth wires [rs, slot]", () => {
    const f = parseFrame(v.replayGetDepth({ replaySession: "rs_1", slot: "rs1s" }));
    expect(f.name).toBe("replay_get_depth");
    expect(f.params).toEqual(["rs_1", "rs1s"]);
  });

  it("replay_remove_series wires [rs, slot]", () => {
    const f = parseFrame(
      v.replayRemoveSeries({ replaySession: "rs_1", slot: "rs1s" }),
    );
    expect(f.name).toBe("replay_remove_series");
    expect(f.params).toEqual(["rs_1", "rs1s"]);
  });

  it("replay_delete_session wires [rs]", () => {
    const f = parseFrame(v.replayDeleteSession({ replaySession: "rs_1" }));
    expect(f.name).toBe("replay_delete_session");
    expect(f.params).toEqual(["rs_1"]);
  });

  it("replay_start wires [rs, slot, ...args]", () => {
    const f = parseFrame(
      v.replayStart({ replaySession: "rs_1", slot: "rs1s", args: ["interval_1d", 1] }),
    );
    expect(f.name).toBe("replay_start");
    expect(f.params).toEqual(["rs_1", "rs1s", "interval_1d", 1]);
  });

  it("replay_stop wires [rs, slot]", () => {
    const f = parseFrame(v.replayStop({ replaySession: "rs_1", slot: "rs1s" }));
    expect(f.name).toBe("replay_stop");
    expect(f.params).toEqual(["rs_1", "rs1s"]);
  });

  it("quote_delete_session wires [qs]", () => {
    const f = parseFrame(v.quoteDeleteSession({ quoteSession: "qs_1" }));
    expect(f.name).toBe("quote_delete_session");
    expect(f.params).toEqual(["qs_1"]);
  });

  it("quote_remove_symbols wires [qs, ...symbols]", () => {
    const f = parseFrame(
      v.quoteRemoveSymbols({
        quoteSession: "qs_1",
        symbols: ["NASDAQ:AAPL", "NASDAQ:MSFT"],
      }),
    );
    expect(f.name).toBe("quote_remove_symbols");
    expect(f.params).toEqual(["qs_1", "NASDAQ:AAPL", "NASDAQ:MSFT"]);
  });

  it("quote_remove_symbols rejects empty list", () => {
    expect(() =>
      v.quoteRemoveSymbols({ quoteSession: "qs_1", symbols: [] }),
    ).toThrow(/symbols/);
  });

  it("quote_hibernate_all wires [qs]", () => {
    const f = parseFrame(v.quoteHibernateAll({ quoteSession: "qs_1" }));
    expect(f.name).toBe("quote_hibernate_all");
    expect(f.params).toEqual(["qs_1"]);
  });

  it("quote_list_fields wires [qs]", () => {
    const f = parseFrame(v.quoteListFields({ quoteSession: "qs_1" }));
    expect(f.name).toBe("quote_list_fields");
    expect(f.params).toEqual(["qs_1"]);
  });

  it("declared byte-length matches utf-8 byte length for non-ASCII", () => {
    const out = v.switchTimezone({ chartSession: "cs_1", timezone: "Europe/Zürich" });
    expectByteLen(out);
  });
});
