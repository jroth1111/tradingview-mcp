// Simple test for TradingView MCP

import { TradingViewClient, TVRestClient } from "./tv/index.js";
import { loadConfig, getConfigPath } from "./config.js";
import { validatePineSyntax } from "./utils/pine-validator.js";
import { buildStudyInputs } from "./utils/study-inputs.js";
import type { TVCredentials } from "./tv/types.js";
import type { PineTranslateLightResponse } from "./tv/types-pinescript.js";

async function resolveUsername(credentials?: TVCredentials): Promise<string | undefined> {
  if (!credentials?.sessionId) return undefined;
  const cookies = credentials.sessionSign
    ? `sessionid=${credentials.sessionId}; sessionid_sign=${credentials.sessionSign}`
    : `sessionid=${credentials.sessionId}`;

  try {
    const resp = await fetch("https://www.tradingview.com/", {
      headers: { Cookie: cookies },
      redirect: "manual",
    });
    const text = await resp.text();
    return text.match(/"username":"(.*?)"/)?.[1];
  } catch {
    return undefined;
  }
}

async function test() {
  console.log("Testing TradingView MCP components...\n");
  const config = loadConfig();
  const credentials = config.credentials;
  const endpoint = config.endpoint ?? (credentials?.sessionId ? "prodata" : "data");
  const timeoutMs = config.timeoutMs ?? 15000;
  const debug = config.debug ?? false;
  const authUsername = credentials?.sessionId ? await resolveUsername(credentials) : undefined;

  console.log(`Auth config: ${credentials?.sessionId ? "found" : "missing"} (${getConfigPath()})`);
  if (credentials?.sessionId) {
    console.log(`Auth username: ${authUsername || "unavailable"}`);
  }
  console.log("");

  // Test local PineScript validation first
  console.log("0. Testing local PineScript syntax validation...");
  const validScript = `//@version=6
indicator("Test RSI", overlay=false)
length = input.int(14, "RSI Length")
rsi = ta.rsi(close, length)
plot(rsi, "RSI", color=color.blue)`;

  const invalidScript = `//@version=6
indicator("Test", overlay=true)
plot()`;  // Missing argument

  const validResult = validatePineSyntax(validScript);
  console.log(`   Valid script: valid=${validResult.valid}, type=${validResult.type}, version=${validResult.version}`);

  const invalidResult = validatePineSyntax(invalidScript);
  console.log(`   Invalid script: valid=${invalidResult.valid}, errors=${invalidResult.errors.length}`);
  if (invalidResult.errors.length > 0) {
    console.log(`   Error: ${invalidResult.errors[0].message}`);
  }
  console.log("   ✓ Local validation works\n");

  // Test REST client (no auth required)
  console.log("1. Testing REST client (symbol search)...");
  const rest = new TVRestClient(credentials);

  try {
    const symbols = await rest.symbols.search("AAPL");
    console.log(`   Found ${symbols.length} symbols matching 'AAPL'`);
    if (symbols.length > 0) {
      console.log(`   First match: ${symbols[0].id} - ${symbols[0].description}`);
    }
    console.log("   ✓ Symbol search works\n");
  } catch (err) {
    console.log(`   ✗ Symbol search failed: ${err}\n`);
  }

  // Test indicator search
  console.log("2. Testing indicator search...");
  try {
    const indicators = await rest.indicators.search("RSI");
    console.log(`   Found ${indicators.length} indicators matching 'RSI'`);
    if (indicators.length > 0) {
      console.log(`   First match: ${indicators[0].name} by ${indicators[0].author.username}`);
    }
    console.log("   ✓ Indicator search works\n");
  } catch (err) {
    console.log(`   ✗ Indicator search failed: ${err}\n`);
  }

  // Test TA summary
  console.log("3. Testing TA summary...");
  try {
    const ta = await rest.ta.summary("NASDAQ:AAPL", "1D");
    console.log(`   TA Summary for AAPL: ${JSON.stringify(ta)}`);
    console.log("   ✓ TA summary works\n");
  } catch (err) {
    console.log(`   ✗ TA summary failed: ${err}\n`);
  }

  // Test WebSocket client (may require auth for some features)
  console.log("4. Testing WebSocket client (quotes)...");
  const ws = new TradingViewClient({
    credentials,
    endpoint,
    timeoutMs,
    debug,
  });

  try {
    const quotes = await ws.getQuotes(["NASDAQ:AAPL"]);
    console.log(`   Quote for AAPL: $${quotes["NASDAQ:AAPL"]?.lp || "N/A"}`);
    console.log("   ✓ WebSocket quotes work\n");
  } catch (err) {
    console.log(`   ✗ WebSocket quotes failed: ${err}\n`);
  }

  // Test candles
  console.log("5. Testing candles fetch...");
  try {
    const candles = await ws.getCandles({
      symbol: "NASDAQ:AAPL",
      timeframe: "1D",
      amount: 5,
    });
    console.log(`   Fetched ${candles.length} candles`);
    if (candles.length > 0) {
      const last = candles[candles.length - 1];
      console.log(`   Latest: O=${last.open} H=${last.high} L=${last.low} C=${last.close}`);
    }
    console.log("   ✓ Candles fetch works\n");
  } catch (err) {
    console.log(`   ✗ Candles fetch failed: ${err}\n`);
  }

  // Test PineScript validation
  console.log("6. Testing PineScript validation...");
  try {
    const result = await ws.validatePineScript({
      code: validScript,
      symbol: "NASDAQ:AAPL",
      timeframe: "1D",
    });

    console.log(`   Valid script result: valid=${result.valid}`);
    if (result.errors.length > 0) {
      console.log(`   Errors: ${JSON.stringify(result.errors)}`);
    }
    console.log("   ✓ PineScript validation works\n");
  } catch (err) {
    console.log(`   ✗ PineScript validation failed: ${err}\n`);
  }

  if (credentials?.sessionId && authUsername) {
    let validationResult: PineTranslateLightResponse | null = null;

    console.log("7. Testing Pine translate_light (valid script)...");
    try {
      const validated = await rest.pinescript.translateLightValidate(validScript, authUsername);
      validationResult = validated;
      const errorCount = validated.result?.errors?.length ?? 0;
      const varCount = validated.result?.variables?.length ?? 0;
      console.log(`   Validation: success=${validated.success} errors=${errorCount} variables=${varCount}`);
      console.log("   ✓ translate_light works\n");
    } catch (err) {
      console.log(`   ✗ translate_light failed: ${err}\n`);
    }

    console.log("8. Testing Pine translate_light (invalid script)...");
    try {
      const validated = await rest.pinescript.translateLightValidate(invalidScript, authUsername);
      const errorCount = validated.result?.errors?.length ?? 0;
      console.log(`   Validation: success=${validated.success} errors=${errorCount}`);
      if (validated.result?.errors && validated.result.errors.length > 0) {
        console.log(`   Error: ${validated.result.errors[0].message}`);
      }
      console.log("   ✓ translate_light errors surfaced\n");
    } catch (err) {
      console.log(`   ✗ translate_light (invalid) failed: ${err}\n`);
    }

    console.log("9. Testing inline study run (Script@tv-scripting-101!)...");
    try {
      // For inline execution, pass raw Pine Script code
      const inlineInputs = {
        text: validScript,
        pineVersion: "6",
      };

      const study = await ws.runStudy({
        symbol: "NASDAQ:AAPL",
        studyId: "Script@tv-scripting-101!",
        inputs: inlineInputs,
        timeframe: "1D",
        count: 20,
      });
      console.log(`   Inline study points: ${study.data.length}`);
      console.log("   ✓ Inline study run works\n");
    } catch (err) {
      console.log(`   ✗ Inline study run failed: ${err}\n`);
    }
  } else {
    console.log("7. Skipping auth-required Pine tests (no session/username available).\n");
  }

  console.log("Tests complete!");
}

test().catch(console.error);
