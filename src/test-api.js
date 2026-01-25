import fetch from 'node-fetch';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m'
};

async function testEndpoint(name, url) {
  console.log(`\n${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}Testing: ${name}${colors.reset}`);
  console.log(`${colors.yellow}URL: ${url}${colors.reset}`);
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`${colors.green}✅ Success${colors.reset}`);
    console.log(`${colors.cyan}Response:${colors.reset}`);
    console.log(JSON.stringify(data, null, 2));
    
    return data;
  } catch (error) {
    console.log(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
    return null;
  }
}

async function runTests() {
  console.log(`${colors.bright}${colors.green}🔬 POLYMARKET API EXPLORATION${colors.reset}`);
  console.log(`${colors.cyan}Testing endpoints to understand data structure...${colors.reset}\n`);

  // Test 1: Find Bitcoin Up/Down markets
  console.log(`${colors.bright}\n📋 TEST 1: Search for Bitcoin Up/Down markets${colors.reset}`);
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const marketInterval = 900; // 15 minutes
  const currentTimestamp = Math.floor(nowSeconds / marketInterval) * marketInterval;
  
  // Try a few timestamps
  let activeMarket = null;
  for (let i = 0; i < 5; i++) {
    const timestamp = currentTimestamp - (i * marketInterval);
    const slug = `btc-updown-15m-${timestamp}`;
    
    console.log(`\n${colors.yellow}Trying: ${slug}${colors.reset}`);
    const data = await testEndpoint(
      `Event by slug: ${slug}`,
      `${GAMMA_API}/events?slug=${slug}`
    );
    
    if (data && data.length > 0) {
      activeMarket = data[0];
      console.log(`\n${colors.green}✅ Found active market!${colors.reset}`);
      break;
    }
  }

  if (!activeMarket) {
    console.log(`${colors.red}No active market found. Exiting.${colors.reset}`);
    return;
  }

  // Test 2: Examine market structure
  console.log(`${colors.bright}\n📋 TEST 2: Examine market structure${colors.reset}`);
  console.log(`\n${colors.cyan}Key fields in event:${colors.reset}`);
  console.log(`  - id: ${activeMarket.id}`);
  console.log(`  - slug: ${activeMarket.slug}`);
  console.log(`  - title: ${activeMarket.title}`);
  console.log(`  - active: ${activeMarket.active}`);
  console.log(`  - closed: ${activeMarket.closed}`);
  console.log(`  - startDate: ${activeMarket.startDate}`);
  console.log(`  - endDate: ${activeMarket.endDate}`);
  console.log(`  - createdAt: ${activeMarket.createdAt}`);
  
  if (activeMarket.markets && activeMarket.markets.length > 0) {
    const market = activeMarket.markets[0];
    console.log(`\n${colors.cyan}Market details:${colors.reset}`);
    console.log(`  - conditionId: ${market.conditionId}`);
    console.log(`  - question: ${market.question}`);
    console.log(`  - outcomes: ${market.outcomes}`);
    console.log(`  - outcomePrices: ${market.outcomePrices}`);
    console.log(`  - clobTokenIds: ${JSON.stringify(market.clobTokenIds)}`);
    console.log(`  - volume: ${market.volume}`);
    console.log(`  - volumeNum: ${market.volumeNum}`);
    console.log(`  - liquidity: ${market.liquidity}`);
    
    // Test 3: Get prices from CLOB
    if (market.clobTokenIds && market.clobTokenIds.length > 0) {
      console.log(`${colors.bright}\n📋 TEST 3: Get current prices from CLOB${colors.reset}`);
      
      const outcomes = JSON.parse(market.outcomes);
      for (let i = 0; i < market.clobTokenIds.length; i++) {
        const tokenId = market.clobTokenIds[i];
        const outcome = outcomes[i];
        
        await testEndpoint(
          `Price for ${outcome} (token ${tokenId})`,
          `${CLOB_API}/price?token_id=${tokenId}&side=buy`
        );
      }
    }
  }

  // Test 4: Search for a CLOSED market to see resolution data
  console.log(`${colors.bright}\n📋 TEST 4: Find a closed market to see resolution data${colors.reset}`);
  
  // Try older timestamps (markets that should be closed)
  for (let i = 10; i < 20; i++) {
    const timestamp = currentTimestamp - (i * marketInterval);
    const slug = `btc-updown-15m-${timestamp}`;
    
    const data = await fetch(`${GAMMA_API}/events?slug=${slug}`).then(r => r.json()).catch(() => null);
    
    if (data && data.length > 0) {
      const market = data[0];
      if (market.closed) {
        console.log(`\n${colors.green}✅ Found closed market: ${market.slug}${colors.reset}`);
        console.log(`\n${colors.cyan}Closed market data:${colors.reset}`);
        console.log(JSON.stringify(market, null, 2));
        
        // Check if there's outcome information
        if (market.markets && market.markets.length > 0) {
          const m = market.markets[0];
          console.log(`\n${colors.cyan}Outcome prices after resolution:${colors.reset}`);
          console.log(`  outcomes: ${m.outcomes}`);
          console.log(`  outcomePrices: ${m.outcomePrices}`);
        }
        break;
      }
    }
  }

  // Test 5: Check market data structure for metadata
  console.log(`${colors.bright}\n📋 TEST 5: Check for additional metadata fields${colors.reset}`);
  console.log(`\n${colors.cyan}Full active market object:${colors.reset}`);
  console.log(JSON.stringify(activeMarket, null, 2));

  // Test 6: Try market endpoint instead of events endpoint
  console.log(`${colors.bright}\n📋 TEST 6: Try /markets endpoint${colors.reset}`);
  await testEndpoint(
    `Markets by slug: ${activeMarket.slug}`,
    `${GAMMA_API}/markets?slug=${activeMarket.slug}`
  );

  console.log(`\n${colors.bright}${colors.green}✅ API Exploration Complete${colors.reset}\n`);
}

// Run tests
runTests().catch(error => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
