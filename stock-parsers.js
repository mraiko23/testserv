const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

// Function to fetch and parse stock data
async function fetchGamersbergStock() {
  const maxRetries = 3;
  const retryDelay = 5000; // 5 seconds between retries
  const timeout = 30000; // 30 seconds timeout for all operations
  const waitDelay = 30000; // Additional 30 second wait after exact minute mark
  
  const stockData = {
    seeds: [],
    gear: [],
    eggs: []
  };

  // Helper function for retrying requests
  async function makeRequest(url, attempt = 1) {
    let browser = null;
    try {
      console.log(`[DEBUG] Fetching data from ${url} (attempt ${attempt}/${maxRetries})...`);
      browser = await puppeteer.launch({ 
        headless: "new",
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--window-size=1920,1080'
        ]
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36');
      page.setDefaultTimeout(timeout);
      page.setDefaultNavigationTimeout(timeout);
      await page.goto(url, { waitUntil: 'networkidle0', timeout: timeout });
      // Debug: check if page loaded
      const html = await page.content();
      if (!html || html.length < 1000) {
        console.error('[DEBUG] Page content too short or empty');
      }
      // Wait for critical elements with extended timeout
      try {
        await Promise.all([
          page.waitForSelector('.stock-item-card', { timeout }),
          page.waitForSelector('.text-white.text-sm', { timeout }),
          page.waitForSelector('.stock-card-container', { timeout })
        ]);
      } catch (e) {
        console.error('[DEBUG] One or more selectors not found:', e.message);
      }
      // Make sure all sections are loaded with their content
      let sectionsLoaded = false;
      try {
        sectionsLoaded = await page.waitForFunction(() => {
          const sections = document.querySelectorAll('.stock-card-container');
          if (!sections || sections.length < 3) return false;
          let hasSeeds = false, hasGear = false, hasEggs = false;
          sections.forEach(section => {
            const headerEl = section.querySelector('h3');
            if (!headerEl) return;
            const headerText = headerEl.textContent.trim();
            if (headerText.includes('SEEDS STOCK')) hasSeeds = true;
            if (headerText.includes('GEAR STOCK')) hasGear = true;
            if (headerText.includes('EGG STOCK')) hasEggs = true;
          });
          return hasSeeds && hasGear && hasEggs;
        }, { timeout, polling: 1000 });
      } catch (e) {
        console.error('[DEBUG] Sections not loaded:', e.message);
      }
      if (!sectionsLoaded) {
        console.error('[DEBUG] Sections did not load as expected');
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Extract data using page context
      const data = await page.evaluate(() => {
        const stockData = { seeds: [], gear: [], eggs: [] };
        function cleanName(text) {
          if (!text) return '';
          // Remove asterisks, trailing 'x', and all underscores
          return text.replace(/\*/g, '')
            .replace(/\s*x$/, '')
            .replace(/^_+|_+$/g, '') // remove leading/trailing underscores
            .replace(/_/g, ' ') // replace internal underscores with space
            .trim();
        }
        function getQuantityFromSpan(span) {
          if (!span) return 0;
          const match = span.textContent.match(/(\d+)x/);
          return match ? parseInt(match[1], 10) : 0;
        }
        try {
          [
            { type: 'seeds', header: 'SEEDS STOCK', color: 'green' },
            { type: 'gear', header: 'GEAR STOCK', color: 'blue' },
            { type: 'eggs', header: 'EGG STOCK', color: 'yellow' }
          ].forEach(({ type, header, color }) => {
            const sections = Array.from(document.querySelectorAll('.stock-card-container')).filter(section => {
              const h3 = section.querySelector('h3');
              return h3 && h3.textContent.includes(header);
            });
            if (sections.length === 0) {
              console.error(`[DEBUG] No section found for ${header}`);
            }
            sections.forEach(section => {
              const items = section.querySelectorAll('.stock-item-card');
              if (items.length === 0) {
                console.error(`[DEBUG] No items found in section for ${header}`);
              }
              items.forEach(item => {
                try {
                  // Название — первый текст внутри .text-white.text-sm
                  const nameSpan = item.querySelector('.text-white.text-sm');
                  let name = '';
                  let quantity = 0;
                  if (nameSpan) {
                    // Название — текст до первого <span class="ml-2 font-medium ...">
                    const nameText = nameSpan.childNodes[0]?.textContent || nameSpan.textContent.split(/\d+x/)[0];
                    name = cleanName(nameText);
                    // Количество — <span class="ml-2 font-medium text-...-400">13x</span>
                    const qtySpan = nameSpan.querySelector(`.ml-2.font-medium.text-${color}-400`);
                    quantity = getQuantityFromSpan(qtySpan);
                  }
                  if (!name) {
                    console.error(`[DEBUG] Name not found in ${type}`);
                    return;
                  }
                  if (!quantity) {
                    console.error(`[DEBUG] Quantity not found for ${name} in ${type}`);
                  }
                  stockData[type].push({ name, quantity });
                } catch (error) {
                  console.error('[DEBUG] Error processing item:', error);
                }
              });
            });
          });
        } catch (error) {
          console.error('[DEBUG] Error processing page:', error);
        }
        return stockData;
      });
      if (!data || (!data.seeds.length && !data.gear.length && !data.eggs.length)) {
        console.error('[DEBUG] No stock data extracted from page');
      }
      return data;
    } catch (error) {
      console.error(`[DEBUG] Error fetching data (attempt ${attempt}/${maxRetries}):`, error.message);
      if (attempt < maxRetries) {
        console.log(`[DEBUG] Retrying in ${retryDelay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return makeRequest(url, attempt + 1);
      }
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
  
  try {
    // Fetch all stock data
    console.log('Fetching stock data...');
    const data = await makeRequest('https://arcaiuz.com/grow-a-garden-stock');
    
    // Copy the data to stockData
    stockData.seeds = data.seeds;
    stockData.gear = data.gear;
    stockData.eggs = data.eggs;
    
    console.log('Processed data counts:', {
      seeds: stockData.seeds.length,
      gear: stockData.gear.length,
      eggs: stockData.eggs.length
    });

    return stockData;
  } catch (error) {
    console.error('Failed to fetch stock data:', error.message);
    return null;
  }
}

// Function to normalize and combine stock data
function normalizeStockData(data) {
  if (!data) return { seeds: [], gear: [], eggs: [] };
  
  const normalizeName = (name) => {
    if (!name) return '';
    // Remove asterisks and clean up the name
    let cleanName = name.replace(/\*/g, '').trim();
    // Remove prefixes like "Seeds", "Gear", "Egg" from the beginning
    cleanName = cleanName.replace(/^(Seeds|Gear|Egg)/i, '').trim();
    return cleanName.toLowerCase();
  };
  
  // Remove duplicates and merge quantities
  const normalizeCategory = (items) => {
    const normalized = {};
    
    items.forEach(item => {
      if (!item?.name) return;
      const key = normalizeName(item.name);
      if (normalized[key]) {
        normalized[key].quantity += item.quantity || 0;
      } else {
        const cleanName = item.name.replace(/^(Seeds|Gear|Egg)/i, '').trim();
        normalized[key] = {
          name: cleanName,
          quantity: item.quantity || 0
        };
      }
    });
    
    return Object.values(normalized);
  };
  
  return {
    seeds: normalizeCategory(data.seeds || []),
    gear: normalizeCategory(data.gear || []),
    eggs: normalizeCategory(data.eggs || [])
  };
}

// Function to check if current time matches our schedule
function isScheduledTime() {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  
  // Only run exactly at minutes 0,5,10,15,etc and between 30-35 seconds
  const targetMinutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  const isTargetMinute = targetMinutes.includes(minutes);
  const isInWindow = seconds >= 30 && seconds <= 35; // Strict 5-second window
  
  const shouldRun = isTargetMinute && isInWindow;
  
  // Only log when we're close to target time to reduce spam
  if (isTargetMinute || seconds >= 25) {
    console.log(`[TIMING] Check: ${minutes}:${seconds} - ${shouldRun ? 'WILL RUN' : 'NOT YET'}`);
  }
  
  return shouldRun;
}

// Main function to get all stock data
// Track last successful run to prevent duplicate runs
let lastSuccessfulRun = 0;

async function getAllStockData() {
  try {
    // Check if we should run now
    if (!isScheduledTime()) {
      return null;
    }
    
    // Prevent duplicate runs in the same minute
    const now = Date.now();
    if (now - lastSuccessfulRun < 60000) { // 60 seconds
      return null;
    }
    
    console.log('[FETCH] Starting stock update...');
    
    const stockData = await fetchGamersbergStock();
    
    if (!stockData) {
      console.error('[ERROR] fetchGamersbergStock returned null - likely failed all retries');
      return {
        seeds: [],
        gear: [],
        eggs: []
      };
    }

    // Validate stock data structure
    if (!stockData.seeds || !stockData.gear || !stockData.eggs) {
      console.error('[ERROR] Invalid stock data structure:', stockData);
      return {
        seeds: [],
        gear: [],
        eggs: []
      };
    }

    const normalizedData = normalizeStockData(stockData);
    
    // Validate we got some data
    const totalItems = normalizedData.seeds.length + normalizedData.gear.length + normalizedData.eggs.length;
    if (totalItems === 0) {
      console.error('[ERROR] No items found after normalization');
    } else {
      console.log(`[SUCCESS] Found ${totalItems} total items:`,
        `Seeds: ${normalizedData.seeds.length},`,
        `Gear: ${normalizedData.gear.length},`,
        `Eggs: ${normalizedData.eggs.length}`);
      lastSuccessfulRun = Date.now(); // Update last successful run time
    }
    
    return normalizedData;
  } catch (error) {
    console.error('Error getting stock data:', error.message);
    return {
      seeds: [],
      gear: [],
      eggs: []
    };
  }
}

module.exports = {
  fetchGamersbergStock,
  getAllStockData
};
