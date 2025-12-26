import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const indexFile = join(__dirname, '..', 'src', 'tv', 'rest', 'index.ts');

const content = readFileSync(indexFile, 'utf-8');

// All 24 API methods that should be wired
const apiMethods = [
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
];

console.log('=== METHOD WIRING VERIFICATION ===\n');

let allWired = true;
for (const method of apiMethods) {
  // Check if method exists as async function in class
  const hasDefinition = content.includes(`async ${method}(`);
  
  // Check if method calls the module function
  const hasModuleCall = content.match(new RegExp(`await (\\w+)\\.${method}\\(this`, 'g'));
  
  const moduleName = hasModuleCall ? hasModuleCall[0].match(/await (\w+)\./)[1] : null;
  
  if (hasDefinition && moduleName) {
    console.log(`✅ ${method.padEnd(30)} → calls ${moduleName}.${method}()`);
  } else if (!hasDefinition) {
    console.log(`❌ ${method.padEnd(30)} → MISSING definition`);
    allWired = false;
  } else if (!moduleName) {
    console.log(`⚠️  ${method.padEnd(30)} → definition exists but NO MODULE CALL`);
    allWired = false;
  }
}

// Check for setCredentials
console.log('');
const hasSetCredentials = content.includes('setCredentials(credentials');
console.log(hasSetCredentials ? '✅ setCredentials() → defined' : '❌ setCredentials() → MISSING');
if (!hasSetCredentials) allWired = false;

// Count lines
console.log('');
console.log(`📊 Index file: ${content.split('\n').length} lines`);
console.log(`📊 Total methods: ${apiMethods.length + 1} (24 API + setCredentials)`);

console.log('');
if (allWired) {
  console.log('✅ ALL METHODS CORRECTLY WIRED!\n');
  process.exit(0);
} else {
  console.log('❌ SOME METHODS ARE NOT CORRECTLY WIRED!\n');
  process.exit(1);
}
