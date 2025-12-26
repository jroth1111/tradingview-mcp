import { z } from "zod";
import { McpError, withErrorHandling } from "../utils/errors.js";
import { positiveIntSchema } from "../utils/validators.js";
import type { ToolContext } from "./context.js";

export function registerChartDataTools(ctx: ToolContext): void {
  const { server } = ctx;

  server.tool(
    "chart_extract_active_chart",
    "Extract metadata from the active TradingView chart in the browser (requires Chrome DevTools MCP). Returns a JavaScript code snippet to execute in the browser console.",
    {},
    withErrorHandling(async () => {
      const script = `(function() {
  const widget = window._exposed_chartWidgetCollection?.activeChartWidget?.value?.();
  if (!widget) {
    return { error: "No active chart widget found. Make sure TradingView is open with a chart loaded." };
  }

  const model = widget?.model?.();
  if (!model) {
    return { error: "Could not access chart model." };
  }

  const sources = model.dataSources?.();
  const sourcesArr = Array.isArray(sources) ? sources : (sources ? Array.from(sources) : []);

  const mainSeries = model.mainSeries?.();
  const symbolInfo = mainSeries?.symbolInfo?.();

  return {
    symbol: symbolInfo?.name || mainSeries?.symbol || "Unknown",
    exchange: symbolInfo?.exchange || "Unknown",
    description: symbolInfo?.description || "",
    timeframe: model.timeframe?.() || "Unknown",
    dataSourcesCount: sourcesArr.length,
    hasMainSeries: !!mainSeries,
  };
})();`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              note: "Execute this JavaScript in your browser's DevTools console while TradingView is open with an active chart.",
              script,
            }, null, 2),
          },
        ],
      };
    })
  );

  server.tool(
    "chart_extract_series_data",
    "Extract historical bar data from the active TradingView chart's main series or a specific indicator (requires Chrome DevTools MCP). Returns a JavaScript code snippet to execute in the browser console.",
    {
      sourceName: z.string().optional().describe("Optional: Name of the indicator/data source to extract. If omitted, extracts main price series (OHLCV)."),
      count: positiveIntSchema.max(10000, "Count cannot exceed 10000").default(500)
        .describe("Number of bars to extract (from most recent backwards)"),
    },
    withErrorHandling(async ({ sourceName, count }) => {
      const findSourceFn = sourceName
        ? `const sourcesArr = Array.isArray(sources) ? sources : (sources ? Array.from(sources) : []);
const query = "${sourceName}".toLowerCase();
const target = sourcesArr.find(s => {
  const title = typeof s.title === 'function' ? s.title() : s.title;
  return typeof title === 'string' && title.toLowerCase().includes(query);
});

if (!target) {
  return { error: "Indicator not found: ${sourceName}. Run chart_list_sources to see available indicators." };
}

const series = target.series?.();`
        : `const mainSeries = model.mainSeries?.();
if (!mainSeries) {
  return { error: "Main series not found on chart." };
}
const series = mainSeries;`;

      const script = `(function() {
  const widget = window._exposed_chartWidgetCollection?.activeChartWidget?.value?.();
  if (!widget) {
    return { error: "No active chart widget found. Make sure TradingView is open with a chart loaded." };
  }

  const model = widget?.model?.();
  if (!model) {
    return { error: "Could not access chart model." };
  }

  const sources = model.dataSources?.();
${findSourceFn}

  if (!series) {
    return { error: "Could not access series data." };
  }

  const bars = series.bars?.();
  if (!bars || bars.size() === 0) {
    return { error: "No bars available in series." };
  }

  const barsCount = Math.min(${count}, bars.size());
  const startIndex = bars.size() - barsCount;
  const result = [];

  for (let i = startIndex; i < bars.size(); i++) {
    const bar = bars.at(i);
    if (!bar) continue;

    const data = bar.value || {};
    const time = data.time || (typeof bar.time === 'function' ? bar.time() : undefined);

    const item: Record<string, unknown> = {
      index: i,
      time: time,
      timeStr: time ? new Date(time * 1000).toISOString() : undefined,
    };

    if (data.open !== undefined) {
      item.open = data.open;
      item.high = data.high;
      item.low = data.low;
      item.close = data.close;
    }

    if (data.volume !== undefined) {
      item.volume = data.volume;
    }

    if (data.value !== undefined) {
      item.value = data.value;
    }

    if (typeof bar.value === 'object') {
      Object.keys(bar.value).forEach(key => {
        if (key !== 'time' && key !== 'open' && key !== 'high' && key !== 'low' && key !== 'close' && key !== 'volume' && key !== 'value') {
          item[key] = bar.value[key];
        }
      });
    }

    result.push(item);
  }

  return {
    source: ${sourceName ? `"${sourceName}"` : '"main"'},
    barsExtracted: result.length,
    totalBarsAvailable: bars.size(),
    data: result,
  };
})();`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              note: "Execute this JavaScript in your browser's DevTools console while TradingView is open with an active chart.",
              script,
            }, null, 2),
          },
        ],
      };
    })
  );

  server.tool(
    "chart_list_sources",
    "List all data sources (indicators/studies) attached to the active TradingView chart (requires Chrome DevTools MCP). Returns a JavaScript code snippet to execute in the browser console.",
    {},
    withErrorHandling(async () => {
      const script = `(function() {
  const widget = window._exposed_chartWidgetCollection?.activeChartWidget?.value?.();
  if (!widget) {
    return { error: "No active chart widget found. Make sure TradingView is open with a chart loaded." };
  }

  const model = widget?.model?.();
  if (!model) {
    return { error: "Could not access chart model." };
  }

  const sources = model.dataSources?.();
  if (!sources) {
    return { error: "No data sources found on chart." };
  }

  const sourcesArr = Array.isArray(sources) ? sources : Array.from(sources);
  const result = sourcesArr.map((s, idx) => {
    const title = typeof s.title === 'function' ? s.title() : s.title;
    const meta = typeof s.metaInfo === 'function' ? s.metaInfo() : s.metaInfo;
    const isMain = s === model.mainSeries?.();

    return {
      index: idx,
      name: typeof title === 'string' ? title : (meta?.name || 'Unknown'),
      type: meta?.type || 'Unknown',
      description: meta?.description || '',
      isMain,
      hasSeries: !!s.series,
    };
  });

  return {
    totalSources: result.length,
    sources: result,
  };
})();`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              note: "Execute this JavaScript in your browser's DevTools console while TradingView is open with an active chart.",
              script,
            }, null, 2),
          },
        ],
      };
    })
  );
}
