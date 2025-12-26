import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  // Capture scan requests (used for fundamentals)
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/scan') && url.includes('scanner.tradingview.com')) {
      try {
        const body = await response.text();
        console.log('\n=== SCAN REQUEST ===');
        console.log('URL:', decodeURIComponent(url));
        console.log('Status:', response.status());
        console.log('Response:', body.substring(0, 500));
      } catch (e) {
        // Ignore
      }
    }
  });
  
  // Navigate to screener page
  console.log('→ Navigating to screener...');
  await page.goto('https://www.tradingview.com/screener/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  
  // Wait for data
  await page.waitForTimeout(5000);
  
  await browser.close();
})();
