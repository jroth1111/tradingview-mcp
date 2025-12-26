import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('=== COMPREHENSIVE METHOD WIRING VERIFICATION ===\n');

// 1. Verify tv/index.ts exports rest
console.log('1️⃣  TV/INDEX.TS EXPORTS');
const tvIndexContent = readFileSync(join(__dirname, '..', 'src', 'tv', 'index.ts'), 'utf-8');
const exportsRest = tvIndexContent.includes("export * from \"./rest/index.js\"");
console.log(`   ${exportsRest ? '✅' : '❌'} Exports from rest/index.js`);
console.log('');

// 2. Verify rest/index.ts imports all modules
console.log('2️⃣  REST/INDEX.TS MODULE IMPORTS');
const restIndexContent = readFileSync(join(__dirname, '..', 'src', 'tv', 'rest', 'index.ts'), 'utf-8');
const modules = ['ta', 'symbols', 'news', 'fundamentals', 'scanner', 'options', 'market', 'calendar', 'bonds', 'indicators', 'pinescript'];
let allImported = true;
for (const mod of modules) {
  const imported = restIndexContent.includes(`import * as ${mod} from './${mod}.js'`);
  console.log(`   ${imported ? '✅' : '❌'} ${mod}`);
  if (!imported) allImported = false;
}
console.log('');

// 3. Verify rest/index.ts exports types
console.log('3️⃣  REST/INDEX.TS TYPE EXPORTS');
const typeExports = [
  'TASummary', 'SymbolSearchResult', 'NewsItem', 'NewsOptions',
  'SymbolDetails', 'ScannerRequestOptions', 'ScanOptions', 'MetainfoOptions', 'EnumOptions',
  'OptionsGreeks', 'VolatilityChartOptions', 'MoversOptions', 'MarketOverviewOptions',
  'SectorMoversOptions', 'CalendarOptions', 'BondOverviewOptions', 'PrivateIndicator',
  'CompileOptions', 'TranslateOptions'
];
let allTypesExported = true;
for (const type of typeExports) {
  const exported = restIndexContent.includes(`export type { ${type} }`) || 
                   restIndexContent.includes(`export { ${type} }`);
  if (!exported) {
    console.log(`   ❌ ${type}`);
    allTypesExported = false;
  }
}
if (allTypesExported) {
  console.log(`   ✅ All ${typeExports.length} type exports found`);
}
console.log('');

// 4. Verify all methods are in TVRestClient class
console.log('4️⃣  TVRESTCLIENT CLASS METHODS');
const apiMethods = [
  'getTASummary', 'searchSymbols', 'getNews', 'getFundamentals', 'getSymbolDetails',
  'scannerRequest', 'scan', 'getScannerMetainfo', 'getScannerEnumOrdered',
  'getOptionsGreeks', 'getOptionsVolatilityChart', 'getOptionsInTimeIV',
  'getMovers', 'getMarketOverview', 'getSectorMovers',
  'getEarningsCalendar', 'getDividendCalendar',
  'scanBonds', 'getBondMarketOverview',
  'searchIndicators', 'getIndicatorMeta', 'getPrivateIndicators',
  'compilePineDraft', 'translatePineLight',
  'setCredentials'
];
let allMethodsPresent = true;
for (const method of apiMethods) {
  const present = restIndexContent.includes(`  ${method}(`) || 
                 restIndexContent.includes(`  async ${method}(`);
  if (!present) {
    console.log(`   ❌ ${method}`);
    allMethodsPresent = false;
  }
}
if (allMethodsPresent) {
  console.log(`   ✅ All ${apiMethods.length} methods present`);
}
console.log('');

// 5. Verify method calls to modules
console.log('5️⃣  METHOD → MODULE CALLS');
const methodToModule = {
  'getTASummary': 'ta',
  'searchSymbols': 'symbols',
  'getNews': 'news',
  'getFundamentals': 'fundamentals',
  'getSymbolDetails': 'fundamentals',
  'scannerRequest': 'scanner',
  'scan': 'scanner',
  'getScannerMetainfo': 'scanner',
  'getScannerEnumOrdered': 'scanner',
  'getOptionsGreeks': 'options',
  'getOptionsVolatilityChart': 'options',
  'getOptionsInTimeIV': 'options',
  'getMovers': 'market',
  'getMarketOverview': 'market',
  'getSectorMovers': 'market',
  'getEarningsCalendar': 'calendar',
  'getDividendCalendar': 'calendar',
  'scanBonds': 'bonds',
  'getBondMarketOverview': 'bonds',
  'searchIndicators': 'indicators',
  'getIndicatorMeta': 'indicators',
  'getPrivateIndicators': 'indicators',
  'compilePineDraft': 'pinescript',
  'translatePineLight': 'pinescript',
};
let allWired = true;
for (const [method, module] of Object.entries(methodToModule)) {
  const wired = restIndexContent.includes(`${module}.${method}(this`);
  if (!wired) {
    console.log(`   ❌ ${method} → ${module}`);
    allWired = false;
  }
}
if (allWired) {
  console.log(`   ✅ All ${Object.keys(methodToModule).length} methods wired to modules`);
}
console.log('');

// 6. Verify each module exports its functions
console.log('6️⃣  MODULE FUNCTION EXPORTS');
const moduleFunctions = {
  'ta.ts': ['getTASummary'],
  'symbols.ts': ['searchSymbols'],
  'news.ts': ['getNews'],
  'fundamentals.ts': ['getFundamentals', 'getSymbolDetails'],
  'scanner.ts': ['scannerRequest', 'scan', 'getScannerMetainfo', 'getScannerEnumOrdered'],
  'options.ts': ['getOptionsGreeks', 'getOptionsVolatilityChart', 'getOptionsInTimeIV'],
  'market.ts': ['getMovers', 'getMarketOverview', 'getSectorMovers'],
  'calendar.ts': ['getEarningsCalendar', 'getDividendCalendar'],
  'bonds.ts': ['scanBonds', 'getBondMarketOverview'],
  'indicators.ts': ['searchIndicators', 'getIndicatorMeta', 'getPrivateIndicators'],
  'pinescript.ts': ['compilePineDraft', 'translatePineLight'],
};
let allModuleExports = true;
for (const [file, functions] of Object.entries(moduleFunctions)) {
  const moduleContent = readFileSync(join(__dirname, '..', 'src', 'tv', 'rest', file), 'utf-8');
  for (const func of functions) {
    const exported = moduleContent.includes(`export async function ${func}(`) || 
                     moduleContent.includes(`export function ${func}(`);
    if (!exported) {
      console.log(`   ❌ ${file}: ${func}`);
      allModuleExports = false;
    }
  }
}
if (allModuleExports) {
  console.log(`   ✅ All module functions exported`);
}
console.log('');

// Final summary
console.log('=== FINAL SUMMARY ===');
const allChecks = [
  exportsRest,
  allImported,
  allTypesExported,
  allMethodsPresent,
  allWired,
  allModuleExports
];

console.log('');
console.log(`   ✅ TV/INDEX exports REST: ${exportsRest ? 'YES' : 'NO'}`);
console.log(`   ✅ All modules imported: ${allImported ? 'YES' : 'NO'}`);
console.log(`   ✅ All types exported: ${allTypesExported ? 'YES' : 'NO'}`);
console.log(`   ✅ All methods present: ${allMethodsPresent ? 'YES' : 'NO'}`);
console.log(`   ✅ All methods wired: ${allWired ? 'YES' : 'NO'}`);
console.log(`   ✅ All module functions exported: ${allModuleExports ? 'YES' : 'NO'}`);
console.log('');

if (allChecks.every(check => check === true)) {
  console.log('✅ ✅ ✅  ALL METHODS CORRECTLY WIRED!  ✅ ✅ ✅\n');
  process.exit(0);
} else {
  console.log('❌ SOME WIRING ISSUES FOUND!\n');
  process.exit(1);
}
