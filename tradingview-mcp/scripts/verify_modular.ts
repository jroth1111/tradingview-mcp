import { TVRestClient } from '../dist/tv/rest/index.js';

// Verify client can be instantiated
const client = new TVRestClient();

// Verify all methods exist
const methods = [
  'getTASummary',
  'searchSymbols',
  'getNews',
  'getFundamentals',
  'getSymbolDetails',
  'scannerRequest',
  'scan',
  'getScannerMetainfo',
  'getScannerEnumOrdered',
  'getOptionsGreeks',
  'getOptionsVolatilityChart',
  'getOptionsInTimeIV',
  'getMovers',
  'getMarketOverview',
  'getSectorMovers',
  'getEarningsCalendar',
  'getDividendCalendar',
  'scanBonds',
  'getBondMarketOverview',
  'searchIndicators',
  'getIndicatorMeta',
  'getPrivateIndicators',
  'compilePineDraft',
  'translatePineLight',
  'setCredentials',
];

console.log('=== MODULAR REST CLIENT VERIFICATION ===\n');

let missing = 0;
for (const method of methods) {
  if (typeof (client as any)[method] !== 'function') {
    console.log(`❌ Missing method: ${method}`);
    missing++;
  }
}

console.log(`\n✅ Found: ${methods.length - missing}/${methods.length} methods`);
if (missing === 0) {
  console.log('✅ All methods verified!');
  process.exit(0);
} else {
  console.log(`❌ Missing: ${missing} methods`);
  process.exit(1);
}
