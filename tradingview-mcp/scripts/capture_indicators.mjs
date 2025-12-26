import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  // Capture indicator-related requests
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('pine-facade') || 
        url.includes('pubscripts-suggest-json') ||
        url.includes('pine-facade/translate')) {
      try {
        console.log('\n=== INDICATOR REQUEST ===');
        console.log('URL:', decodeURIComponent(url));
        console.log('Status:', response.status());
      } catch (e) {
        // Ignore
      }
    }
  });
  
  console.log('→ Navigating to indicators...');
  await page.goto('https://www.tradingview.com/scripts/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  
  await page.waitForTimeout(3000);
  
  await browser.close();
})();
