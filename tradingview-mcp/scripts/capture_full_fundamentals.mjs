import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  // Capture symbol requests with fundamentals fields
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('scanner.tradingview.com/symbol') && url.includes('fields=')) {
      try {
        const body = await response.text();
        console.log('\n=== FUNDAMENTALS REQUEST ===');
        console.log('URL:', decodeURIComponent(url));
        console.log('Status:', response.status());
        console.log('Response:', body);
        
        // Save to file
        fs.appendFileSync('.fundamentals_responses.json', 
          JSON.stringify({
            url: decodeURIComponent(url),
            status: response.status(),
            response: body
          }, null, 2) + '\n');
      } catch (e) {
        // Ignore
      }
    }
  });
  
  // Navigate to a stock with full financial data
  console.log('→ Navigating to MSFT for fundamentals...');
  await page.goto('https://www.tradingview.com/symbols/NASDAQ-MSFT/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  
  // Wait for data to load
  await page.waitForTimeout(5000);
  
  await browser.close();
})();
