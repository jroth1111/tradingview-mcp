const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  // Load stored cookies if available
  try {
    const cookies = JSON.parse(require('fs').readFileSync('.tradingview_cookies.json', 'utf8'));
    await context.addCookies(cookies);
    console.log('✓ Loaded stored cookies');
  } catch (e) {
    console.log('✓ No stored cookies - using public endpoints');
  }
  
  const page = await context.newPage();
  
  // Capture network requests
  const requests = [];
  page.on('request', request => {
    const url = request.url();
    if (url.includes('scanner.tradingview.com') || 
        url.includes('options-charting.tradingview.com')) {
      const data = {
        url,
        method: request.method(),
        headers: request.headers()
      };
      const post = request.postData();
      if (post) data.postData = post;
      requests.push(data);
    }
  });
  
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('scanner.tradingview.com/symbol')) {
      try {
        const body = await response.text();
        console.log('\n=== SYMBOL ENDPOINT ===');
        console.log('URL:', url);
        console.log('Status:', response.status());
        console.log('Response:', body.substring(0, 300));
      } catch (e) {
        // Ignore
      }
    }
  });
  
  // Navigate to AAPL page
  console.log('→ Navigating to NASDAQ:AAPL...');
  await page.goto('https://www.tradingview.com/symbols/NASDAQ-AAPL/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  
  // Wait for page to load
  await page.waitForTimeout(3000);
  
  // Save cookies for future use
  const cookies = await context.cookies();
  require('fs').writeFileSync('.tradingview_cookies.json', JSON.stringify(cookies, null, 2));
  console.log('✓ Saved cookies');
  
  // Save captured requests
  require('fs').writeFileSync('.scanner_requests.json', JSON.stringify(requests, null, 2));
  console.log('✓ Captured', requests.length, 'requests');
  
  await browser.close();
})();
