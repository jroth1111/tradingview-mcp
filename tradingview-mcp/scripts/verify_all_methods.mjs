import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const restDir = join(__dirname, '..', 'src', 'tv', 'rest');

// Expected exports from each module
const expectedExports = {
  'ta.ts': ['TASummary', 'getTASummary'],
  'symbols.ts': ['SymbolSearchResult', 'searchSymbols'],
  'news.ts': ['NewsItem', 'NewsOptions', 'getNews'],
  'fundamentals.ts': ['SymbolDetails', 'getFundamentals', 'getSymbolDetails'],
  'scanner.ts': ['ScannerRequestOptions', 'ScanOptions', 'MetainfoOptions', 'EnumOptions', 'scannerRequest', 'scan', 'getScannerMetainfo', 'getScannerEnumOrdered'],
  'options.ts': ['OptionsGreeks', 'VolatilityChartOptions', 'getOptionsGreeks', 'getOptionsVolatilityChart', 'getOptionsInTimeIV'],
  'market.ts': ['MoversOptions', 'MarketOverviewOptions', 'SectorMoversOptions', 'getMovers', 'getMarketOverview', 'getSectorMovers'],
  'calendar.ts': ['CalendarOptions', 'getEarningsCalendar', 'getDividendCalendar'],
  'bonds.ts': ['BondOverviewOptions', 'scanBonds', 'getBondMarketOverview'],
  'indicators.ts': ['PrivateIndicator', 'searchIndicators', 'getIndicatorMeta', 'getPrivateIndicators'],
  'pinescript.ts': ['CompileOptions', 'TranslateOptions', 'compilePineDraft', 'translatePineLight'],
  'utils.ts': ['SCANNER_BASE', 'SCAN_URL', 'SCAN_INDICATORS', 'OPTIONS_CHARTING_BASE', 'OPTIONS_GREEKS_FIELDS', 'AUTH_HEADERS_BASE', 'FUNDAMENTAL_FIELDS', 'buildAuthHeaders', 'rateLimitedFetch'],
  'types.ts': ['TVRestClient'],
  'index.ts': ['TVRestClient']
};

console.log('=== MODULE EXPORT VERIFICATION ===\n');

const files = readdirSync(restDir).filter(f => f.endsWith('.ts') && f !== 'scanner-cache.ts');

let allOk = true;

for (const file of files) {
  const filepath = join(restDir, file);
  const content = readFileSync(filepath, 'utf-8');
  const expected = expectedExports[file] || [];
  
  console.log(`📄 ${file}:`);
  
  const missing = [];
  for (const exp of expected) {
    if (file === 'index.ts') {
      // Check if class is exported
      if (!content.includes(`export class ${exp}`)) {
        missing.push(exp);
      }
    } else if (exp.startsWith('get') || exp.startsWith('scan') || exp === 'rateLimitedFetch' || exp === 'buildAuthHeaders') {
      // Function export
      const hasExport = content.includes(`export async function ${exp}`) || 
                       content.includes(`export function ${exp}`);
      if (!hasExport) {
        missing.push(exp);
      }
    } else if (file === 'utils.ts') {
      // Constant export
      const hasExport = content.includes(`export const ${exp}`) || 
                       content.includes(`export { ${exp} }`);
      if (!hasExport) {
        missing.push(exp);
      }
    } else {
      // Type/interface export
      const hasExport = content.includes(`export interface ${exp}`) || 
                       content.includes(`export type ${exp}`) ||
                       content.includes(`export const ${exp}`);
      if (!hasExport) {
        missing.push(exp);
      }
    }
  }
  
  if (missing.length === 0) {
    console.log(`  ✅ All ${expected.length} exports found\n`);
  } else {
    console.log(`  ❌ Missing exports: ${missing.join(', ')}\n`);
    allOk = false;
  }
}

console.log('\n=== INDEX.TS WIRING VERIFICATION ===\n');

// Read index.ts
const indexContent = readFileSync(join(restDir, 'index.ts'), 'utf-8');

const methodWiring = [
  { module: 'ta', methods: ['getTASummary'] },
  { module: 'symbols', methods: ['searchSymbols'] },
  { module: 'news', methods: ['getNews'] },
  { module: 'fundamentals', methods: ['getFundamentals', 'getSymbolDetails'] },
  { module: 'scanner', methods: ['scannerRequest', 'scan', 'getScannerMetainfo', 'getScannerEnumOrdered'] },
  { module: 'options', methods: ['getOptionsGreeks', 'getOptionsVolatilityChart', 'getOptionsInTimeIV'] },
  { module: 'market', methods: ['getMovers', 'getMarketOverview', 'getSectorMovers'] },
  { module: 'calendar', methods: ['getEarningsCalendar', 'getDividendCalendar'] },
  { module: 'bonds', methods: ['scanBonds', 'getBondMarketOverview'] },
  { module: 'indicators', methods: ['searchIndicators', 'getIndicatorMeta', 'getPrivateIndicators'] },
  { module: 'pinescript', methods: ['compilePineDraft', 'translatePineLight'] },
];

for (const { module, methods } of methodWiring) {
  console.log(`🔗 ${module}:`);
  for (const method of methods) {
    const hasMethod = indexContent.includes(`async ${method}(`);
    const hasCall = indexContent.includes(`${module}.${method}(this`);
    
    if (hasMethod && hasCall) {
      console.log(`  ✅ ${method} - wired and called`);
    } else if (!hasMethod) {
      console.log(`  ❌ ${method} - method definition missing`);
      allOk = false;
    } else if (!hasCall) {
      console.log(`  ❌ ${method} - not calling module function`);
      allOk = false;
    }
  }
  console.log('');
}

if (allOk) {
  console.log('\n✅ ALL METHODS CORRECTLY WIRED!\n');
  process.exit(0);
} else {
  console.log('\n❌ SOME METHODS ARE NOT CORRECTLY WIRED!\n');
  process.exit(1);
}
