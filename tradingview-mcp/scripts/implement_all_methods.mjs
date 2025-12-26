import fs from 'fs';

// Read current rest.ts
let restTs = fs.readFileSync('src/tv/rest.ts', 'utf8');

// Helper to replace a method implementation
function replaceMethod(methodName, implementation) {
  const regex = new RegExp(
    `async ${methodName}\\([^)]*\\)[^:]*: [^]+?throw new Error\\("not implemented[^\"]*"\\);`,
    's'
  );
  
  if (restTs.match(regex)) {
    console.log(`✓ Replacing ${methodName}`);
    restTs = restTs.replace(regex, implementation);
  } else {
    console.log(`✗ Pattern not found for ${methodName}`);
  }
}

// Implement getFundamentals
replaceMethod(
  'getFundamentals',
  `async getFundamentals(symbol: string, fields?: string[]): Promise<Record<string, unknown>> {
    if (!symbol) throw new Error("symbol required");
    
    const fieldsToFetch = fields?.length ? fields : FUNDAMENTAL_FIELDS;
    const url = new URL("https://scanner.tradingview.com/symbol");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("fields", fieldsToFetch.join(","));
    url.searchParams.set("no_404", "true");
    url.searchParams.set("label-product", "symbol-info");
    
    const headers: Record<string, string> = {
      Origin: "https://www.tradingview.com",
      Referer: "https://www.tradingview.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json",
    };
    
    if (this.credentials?.sessionId) {
      headers.Cookie = this.credentials.sessionSign
        ? \`sessionid=\${this.credentials.sessionId}; sessionid_sign=\${this.credentials.sessionSign}\`
        : \`sessionid=\${this.credentials.sessionId}\`;
    }
    
    const resp = await rateLimitedFetch(url.toString(), { method: "GET", headers });
    
    if (!resp.ok) {
      throw new Error(\`Fundamentals failed: \${resp.status} \${resp.statusText}\`);
    }
    
    return await resp.json() as Record<string, unknown>;
  }`
);

// Implement getSymbolDetails
replaceMethod(
  'getSymbolDetails',
  `async getSymbolDetails(symbol: string): Promise<{symbol: string; fundamentals?: Record<string, unknown>; performance?: Record<string, unknown>; greeks?: Record<string, unknown>; [key: string]: unknown}> {
    if (!symbol) throw new Error("symbol required");
    
    const details: Record<string, unknown> = { symbol };
    
    // Fetch fundamentals
    try {
      details.fundamentals = await this.getFundamentals(symbol);
    } catch (e) {
      // Ignore if fundamentals fail
    }
    
    // Fetch performance
    try {
      const perfUrl = new URL("https://scanner.tradingview.com/symbol");
      perfUrl.searchParams.set("symbol", symbol);
      perfUrl.searchParams.set("fields", "change,Perf.5D,Perf.W,Perf.1M,Perf.6M,Perf.YTD,Perf.Y,Perf.5Y,Perf.All");
      perfUrl.searchParams.set("no_404", "true");
      perfUrl.searchParams.set("label-product", "symbols-performance");
      
      const perfResp = await rateLimitedFetch(perfUrl.toString(), {
        method: "GET",
        headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/", Accept: "application/json" }
      });
      
      if (perfResp.ok) {
        details.performance = await perfResp.json();
      }
    } catch (e) {
      // Ignore if performance fails
    }
    
    // Fetch technicals
    try {
      const taUrl = new URL("https://scanner.tradingview.com/symbol");
      taUrl.searchParams.set("symbol", symbol);
      taUrl.searchParams.set("fields", "Recommend.Other,Recommend.All,Recommend.MA");
      taUrl.searchParams.set("no_404", "true");
      taUrl.searchParams.set("label-product", "symbols-technicals");
      
      const taResp = await rateLimitedFetch(taUrl.toString(), {
        method: "GET",
        headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/", Accept: "application/json" }
      });
      
      if (taResp.ok) {
        details.technicals = await taResp.json();
      }
    } catch (e) {
      // Ignore if technicals fail
    }
    
    return details as any;
  }`
);

console.log('\\n=== FUNDAMENTALS & DETAILS METHODS IMPLEMENTED ===');

// Write updated file
fs.writeFileSync('src/tv/rest.ts', restTs);
console.log('✓ Saved rest.ts');
