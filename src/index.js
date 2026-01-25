import fetch from 'node-fetch';
import readline from 'readline';
import config, { validateConfig } from '../config/index.js';
import PaperTradingPortfolio from './paper-trading.js';
import HedgeStrategy from './strategy.js';
import PriceTracker from './price-tracker.js';

// Validate configuration on startup
try {
  validateConfig();
} catch (error) {
  console.error('❌ Configuration Error:', error.message);
  process.exit(1);
}

const GAMMA_API = config.api.gammaUrl;
const CLOB_API = config.api.clobUrl;
const POLL_INTERVAL = config.bot.pollInterval;
const MIN_EXPECTED_RETURN = config.strategy.minExpectedReturn;

// Initialize paper trading portfolio, strategy, and price tracker
const portfolio = new PaperTradingPortfolio(config.files.portfolio);
const strategy = new HedgeStrategy(portfolio, config.files.strategyResults);
const priceTracker = new PriceTracker();

// Extract timestamp from URL if provided, otherwise use current time
const extractTimestampFromUrl = (url) => {
  const match = url.match(/btc-updown-15m-(\d+)/);
  return match ? parseInt(match[1]) : Math.floor(Date.now() / 1000);
};

// ANSI color codes for better console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m'
};

async function fetchEventData(slug) {
  try {
    const response = await fetch(`${GAMMA_API}/events?slug=${slug}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return data[0]; // Returns first matching event
  } catch (error) {
    console.error(`${colors.red}Error fetching event data:${colors.reset}`, error.message);
    return null;
  }
}


function generateMarketTimestamps() {
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  
  // These markets are created every 15 minutes (900 seconds)
  // They align to :00, :15, :30, :45 of each hour in ET
  // Generate timestamps for a wider range to account for timezone differences
  const timestamps = [];
  const marketInterval = 900; // 15 minutes in seconds
  
  // Try current time aligned to 15-min intervals
  // Go back 2 hours and forward 2 hours to be safe
  const baseTimestamp = Math.floor(nowSeconds / marketInterval) * marketInterval;
  
  for (let i = -12; i <= 12; i++) {
    timestamps.push(baseTimestamp + (i * marketInterval));
  }
  
  // Also try timestamps from the URL pattern provided by user (1769263200)
  // This helps us understand the alignment
  timestamps.push(1769263200);
  
  // Sort and deduplicate
  return [...new Set(timestamps)].sort((a, b) => b - a);
}

async function tryFetchMarketByTimestamp(timestamp) {
  const slug = `btc-updown-15m-${timestamp}`;
  
  try {
    const response = await fetch(`${GAMMA_API}/events?slug=${slug}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    return null;
  }
}

async function searchBitcoinUpDownMarkets() {
  console.log(`${colors.cyan}Searching for Bitcoin Up/Down markets by timestamp...${colors.reset}`);
  
  const timestamps = generateMarketTimestamps();
  console.log(`${colors.cyan}Trying ${timestamps.length} timestamp combinations...${colors.reset}`);
  
  // Show a few sample timestamps we're trying
  console.log(`${colors.cyan}Sample timestamps: ${timestamps.slice(0, 3).join(', ')}${colors.reset}`);
  
  const markets = [];
  let foundCount = 0;
  
  // Try fetching markets for each timestamp
  for (const timestamp of timestamps) {
    const market = await tryFetchMarketByTimestamp(timestamp);
    if (market) {
      foundCount++;
      markets.push(market);
      // Show first few found markets
      if (foundCount <= 3) {
        console.log(`${colors.green}✓ Found: btc-updown-15m-${timestamp}${colors.reset}`);
      }
    }
  }
  
  if (markets.length > 0) {
    console.log(`${colors.green}Total: Found ${markets.length} markets${colors.reset}`);
  } else {
    console.log(`${colors.red}No markets found with timestamp patterns${colors.reset}`);
  }
  
  // DON'T sort here - let the calling function sort as needed
  return markets;
}

async function findCurrentActiveMarket() {
  const markets = await searchBitcoinUpDownMarkets();
  const now = Date.now();
  
  console.log(`${colors.cyan}Found ${markets.length} Bitcoin Up/Down markets${colors.reset}`);
  console.log(`${colors.cyan}Current time: ${formatTimestamp(now)}${colors.reset}`);
  
  if (markets.length === 0) {
    console.log(`${colors.yellow}No markets found. Debug info:${colors.reset}`);
    console.log(`${colors.yellow}Current time (UTC): ${new Date(now).toISOString()}${colors.reset}`);
    console.log(`${colors.yellow}Current Unix timestamp: ${Math.floor(now / 1000)}${colors.reset}`);
    return null;
  }
  
  // Sort markets by end date ASCENDING (earliest ending first)
  markets.sort((a, b) => {
    return new Date(a.endDate || 0).getTime() - new Date(b.endDate || 0).getTime();
  });
  
  console.log(`${colors.cyan}Markets (sorted by end time):${colors.reset}`);
  markets.slice(0, 10).forEach((m, i) => {
    const endTime = new Date(m.endDate).getTime();
    const timeUntilEnd = endTime - now;
    const minutesUntilEnd = Math.floor(timeUntilEnd / 60000);
    const secondsUntilEnd = Math.floor((timeUntilEnd % 60000) / 1000);
    let status;
    if (timeUntilEnd > 0 && timeUntilEnd <= 15 * 60 * 1000) {
      // Currently active market (ends within 15 minutes from now)
      status = `🔴 CURRENT (${minutesUntilEnd}m ${secondsUntilEnd}s left)`;
    } else if (timeUntilEnd > 0) {
      status = `🟢 Future (${minutesUntilEnd}m until end)`;
    } else {
      const minutesSinceEnd = Math.abs(Math.floor(timeUntilEnd / 60000));
      status = `⚫ Ended (${minutesSinceEnd}m ago)`;
    }
    console.log(`  ${i + 1}. ${status}`);
    console.log(`     ${m.title}`);
    console.log(`     ${colors.cyan}Ends: ${formatTimestamp(m.endDate)}${colors.reset}`);
  });
  
  // Find the market that is currently active: hasn't ended yet and ends soonest
  // The current active market should have: now < endDate AND endDate - now <= 15 minutes
  const activeMarket = markets.find(market => {
    const marketEnd = new Date(market.endDate).getTime();
    const timeUntilEnd = marketEnd - now;
    // Market is active if it hasn't ended yet and ends within the next 15 minutes
    return timeUntilEnd > 0 && timeUntilEnd <= 15 * 60 * 1000;
  });
  
  if (!activeMarket) {
    console.log(`${colors.yellow}No currently active market found${colors.reset}`);
    console.log(`${colors.yellow}Finding the next upcoming market instead...${colors.reset}`);
    // Fall back to the next market that hasn't ended yet
    const nextMarket = markets.find(market => {
      const marketEnd = new Date(market.endDate).getTime();
      return marketEnd > now;
    });
    return nextMarket;
  }
  
  return activeMarket;
}

async function findNextMarket(currentEndDate) {
  console.log(`${colors.cyan}Searching for next market after current one ends...${colors.reset}`);
  
  const now = Date.now();
  const currentEnd = currentEndDate ? new Date(currentEndDate).getTime() : now;
  
  // Calculate the timestamp for the NEXT market
  // Markets end every 15 minutes (900 seconds)
  const currentEndSeconds = Math.floor(currentEnd / 1000);
  const marketInterval = 900; // 15 minutes
  
  // The next market should end 15 minutes after the current one
  const nextTimestamp = currentEndSeconds + marketInterval;
  
  console.log(`${colors.cyan}Current market ended at: ${new Date(currentEnd).toISOString()}${colors.reset}`);
  console.log(`${colors.cyan}Looking for market with timestamp: ${nextTimestamp}${colors.reset}`);
  
  // Try to fetch the next market directly
  const slug = `btc-updown-15m-${nextTimestamp}`;
  
  try {
    const response = await fetch(`${GAMMA_API}/events?slug=${slug}`);
    if (!response.ok) {
      console.log(`${colors.yellow}Market ${slug} not found yet (HTTP ${response.status})${colors.reset}`);
      return null;
    }
    
    const data = await response.json();
    if (data && data.length > 0) {
      const market = data[0];
      console.log(`${colors.green}✅ Found next market: ${market.title}${colors.reset}`);
      console.log(`${colors.cyan}   Ends at: ${new Date(market.endDate).toISOString()}${colors.reset}`);
      return market;
    }
  } catch (error) {
    console.log(`${colors.yellow}Error fetching next market: ${error.message}${colors.reset}`);
  }
  
  console.log(`${colors.yellow}Next market not available yet. Will retry...${colors.reset}`);
  return null;
}

async function fetchAllMarkets(slug) {
  try {
    // Try searching by slug via markets endpoint
    const response = await fetch(`${GAMMA_API}/markets?slug=${slug}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error(`${colors.red}Error fetching market via slug:${colors.reset}`, error.message);
    return null;
  }
}

async function fetchMarketPrice(tokenId, side = 'buy') {
  try {
    const response = await fetch(`${CLOB_API}/price?token_id=${tokenId}&side=${side}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.price;
  } catch (error) {
    console.error(`${colors.red}Error fetching price:${colors.reset}`, error.message);
    return null;
  }
}

async function fetchOrderbook(tokenId) {
  try {
    const response = await fetch(`${CLOB_API}/book?token_id=${tokenId}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`${colors.red}Error fetching orderbook:${colors.reset}`, error.message);
    return null;
  }
}

function parseOutcomes(outcomesStr) {
  try {
    return JSON.parse(outcomesStr);
  } catch {
    return [];
  }
}

function parseOutcomePrices(pricesStr) {
  try {
    return JSON.parse(pricesStr);
  } catch {
    return [];
  }
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
}

function logSeparator() {
  console.log(`${colors.cyan}${'='.repeat(80)}${colors.reset}`);
}

async function streamMarketData(eventSlugOrMarket = null, isTransition = false) {
  if (isTransition) {
    logSeparator();
    console.log(`\n${colors.bright}${colors.green}🔄 TRANSITIONING TO NEXT MARKET${colors.reset}\n`);
    logSeparator();
  }
  
  console.log(`${colors.bright}${colors.blue}🔄 Fetching Polymarket Event Data...${colors.reset}\n`);
  
  let event = null;
  
  // If a specific slug is provided, try to fetch it
  if (typeof eventSlugOrMarket === 'string') {
    event = await fetchEventData(eventSlugOrMarket);
  } else if (eventSlugOrMarket && typeof eventSlugOrMarket === 'object') {
    // If a market object is passed directly, use it
    event = eventSlugOrMarket;
  }
  
  // If no event or event has ended, find current active market
  if (!event || (event.endDate && Date.now() > new Date(event.endDate).getTime())) {
    if (event) {
      console.log(`${colors.yellow}⚠️  Market has already ended.${colors.reset}`);
    }
    
    console.log(`${colors.blue}Searching for currently active market...${colors.reset}\n`);
    
    const activeMarket = await findCurrentActiveMarket();
    
    if (activeMarket) {
      console.log(`${colors.green}✅ Found active market: ${activeMarket.title}${colors.reset}`);
      console.log(`${colors.yellow}End time: ${formatTimestamp(activeMarket.endDate)}${colors.reset}\n`);
      return streamMarketData(activeMarket, false);
    }
    
    console.error(`${colors.red}No active markets found. Exiting.${colors.reset}`);
    return;
  }

  console.log(`${colors.bright}${colors.green}✅ Event Found${colors.reset}`);
  console.log(`${colors.yellow}Title:${colors.reset} ${event.title}`);
  console.log(`${colors.yellow}Slug:${colors.reset} ${event.slug}`);
  console.log(`${colors.yellow}Active:${colors.reset} ${event.active ? '🟢 Yes' : '🔴 No'}`);
  console.log(`${colors.yellow}Closed:${colors.reset} ${event.closed ? '🔴 Yes' : '🟢 No'}`);
  
  if (event.endDate) {
    console.log(`${colors.yellow}End Date:${colors.reset} ${formatTimestamp(event.endDate)}`);
    
    // Check if we're starting mid-market (only check if not a transition)
    if (!isTransition) {
      const now = Date.now();
      const endTime = new Date(event.endDate).getTime();
      const marketDuration = 15 * 60 * 1000; // 15 minutes
      const startTime = endTime - marketDuration;
      const timeElapsed = now - startTime;
      const minutesElapsed = Math.floor(timeElapsed / 60000);
      const timeRemaining = endTime - now;
      const minutesRemaining = Math.floor(timeRemaining / 60000);
      
      // If more than configured time has elapsed, wait for next market
      const MIN_TIME_TO_START = config.bot.minTimeToStart;
      
      if (timeElapsed > MIN_TIME_TO_START && timeRemaining > 0) {
        console.log(`\n${colors.yellow}⚠️  MID-MARKET DETECTION${colors.reset}`);
        console.log(`   Market started: ${minutesElapsed} minutes ago`);
        console.log(`   Time remaining: ${minutesRemaining} minutes`);
        console.log(`\n${colors.cyan}📋 Bot Strategy:${colors.reset}`);
        console.log(`   • Only trades at market open for optimal entry prices`);
        console.log(`   • Skipping this market to wait for fresh start`);
        console.log(`\n${colors.yellow}⏳ Waiting for current market to end...${colors.reset}`);
        
        // Show countdown
        let remainingSeconds = Math.ceil(timeRemaining / 1000);
        const countdownInterval = setInterval(() => {
          const mins = Math.floor(remainingSeconds / 60);
          const secs = remainingSeconds % 60;
          process.stdout.write(`\r${colors.cyan}   Time until next market: ${mins}m ${secs}s${colors.reset}`);
          remainingSeconds--;
          
          if (remainingSeconds < 0) {
            clearInterval(countdownInterval);
            process.stdout.write('\n');
          }
        }, 1000);
        
        // Wait for market to end + buffer time
        await new Promise(resolve => setTimeout(resolve, timeRemaining + 10000));
        clearInterval(countdownInterval);
        console.log(`\n\n${colors.green}✅ Market ended. Finding next market...${colors.reset}\n`);
        
        // Retry logic to find next market
        let nextMarket = null;
        let retries = 0;
        const maxRetries = 5;
        
        while (!nextMarket && retries < maxRetries) {
          nextMarket = await findNextMarket(event.endDate);
          
          if (!nextMarket) {
            retries++;
            console.log(`${colors.yellow}Retry ${retries}/${maxRetries} - waiting 5 seconds...${colors.reset}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
        
        if (nextMarket) {
          return streamMarketData(nextMarket, true);
        } else {
          console.error(`${colors.red}Could not find next market after ${maxRetries} attempts. Exiting.${colors.reset}`);
          return;
        }
      } else if (timeElapsed > 0) {
        console.log(`${colors.green}✅ Market started ${minutesElapsed} minute(s) ago - good timing!${colors.reset}`);
      } else {
        console.log(`${colors.green}✅ Market starting soon${colors.reset}`);
      }
    }
  }
  
  if (!event.markets || event.markets.length === 0) {
    console.error(`${colors.red}No markets found for this event.${colors.reset}`);
    return;
  }

  const marketPreview = event.markets[0];
  
  // Try to get detailed market data, fall back to event data if needed
  console.log(`\n${colors.bright}${colors.blue}🔍 Fetching detailed market data...${colors.reset}`);
  let market = await fetchAllMarkets(event.slug);
  
  if (!market) {
    console.log(`${colors.yellow}Using market data from event response...${colors.reset}`);
    market = marketPreview;
  }

  // Parse outcomes and token IDs
  let outcomes, clobTokenIds;
  
  try {
    outcomes = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : market.outcomes;
    clobTokenIds = market.clobTokenIds || [];
    
    // Handle potential string formatting of token IDs
    if (typeof clobTokenIds === 'string') {
      clobTokenIds = JSON.parse(clobTokenIds);
    }
  } catch (error) {
    console.error(`${colors.red}Error parsing market data:${colors.reset}`, error.message);
    console.log(`${colors.yellow}Raw outcomes:${colors.reset}`, market.outcomes);
    console.log(`${colors.yellow}Raw clobTokenIds:${colors.reset}`, market.clobTokenIds);
    return;
  }

  console.log(`\n${colors.bright}${colors.yellow}Market Question:${colors.reset} ${market.question}`);
  console.log(`${colors.yellow}Outcomes:${colors.reset} ${outcomes.join(' | ')}`);
  console.log(`${colors.yellow}Condition ID:${colors.reset} ${market.conditionId}`);
  console.log(`${colors.yellow}Token IDs:${colors.reset}`);
  
  if (!clobTokenIds || clobTokenIds.length === 0) {
    console.error(`${colors.red}No token IDs found. This market may not be tradeable.${colors.reset}`);
    console.log(`${colors.yellow}Market object:${colors.reset}`, JSON.stringify(market, null, 2));
    return;
  }
  
  outcomes.forEach((outcome, i) => {
    if (clobTokenIds[i]) {
      console.log(`  ${outcome}: ${clobTokenIds[i]}`);
    }
  });

  console.log(`\n${colors.bright}${colors.green}🔴 STREAMING LIVE DATA (polling every ${POLL_INTERVAL/1000}s)...${colors.reset}`);
  console.log(`${colors.cyan}Press Ctrl+C to stop${colors.reset}`);
  console.log(`${colors.yellow}📊 COMMANDS:${colors.reset}`);
  console.log(`   ${colors.cyan}buy up [amount] / buy down [amount]${colors.reset} - Manual trades`);
  console.log(`   ${colors.cyan}portfolio${colors.reset} - View positions`);
  console.log(`   ${colors.cyan}stats${colors.reset} - Trading statistics`);
  console.log(`   ${colors.cyan}strategy${colors.reset} - View strategy performance\n`);
  
  console.log(`${colors.bright}${colors.green}🤖 AUTOMATED STRATEGY ACTIVE${colors.reset}`);
  console.log(`   Goal: Buy positions with >110% ROI independently`);
  console.log(`   Investment: $100 per position`);
  console.log(`   Min Return: $${MIN_EXPECTED_RETURN} per position (110% ROI)`);
  console.log(`   Executes: Up if return >$210, Down if return >$210 (independent)\n`);

  let iteration = 0;
  let intervalId = null;
  let hasEnded = false;
  
  // Store prices for tracking
  let startPrices = { up: null, down: null, timestamp: null }; // Initial prices
  let currentPrices = { up: 0, down: 0 }; // Current prices
  
  // Setup readline for interactive commands
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  
  // Handle user commands
  rl.on('line', (input) => {
    const cmd = input.trim().toLowerCase();
    
    if (cmd.startsWith('buy up')) {
      const amount = parseFloat(cmd.split(' ')[2]) || 100;
      handleBuyCommand('Up', currentPrices.up, amount);
    } else if (cmd.startsWith('buy down')) {
      const amount = parseFloat(cmd.split(' ')[2]) || 100;
      handleBuyCommand('Down', currentPrices.down, amount);
    } else if (cmd === 'portfolio') {
      displayPortfolio();
    } else if (cmd === 'stats') {
      displayStats();
    } else if (cmd === 'strategy') {
      strategy.displaySummary(colors);
    } else if (cmd === 'help') {
      displayHelp();
    }
  });
  
  function handleBuyCommand(outcome, price, amount) {
    if (price === 0) {
      console.log(`${colors.red}⚠️  Price not available yet, please wait...${colors.reset}`);
      return;
    }
    
    const result = portfolio.buyShares(
      event.slug,
      event.title,
      outcome,
      price,
      amount,
      event.endDate
    );
    
    if (result.success) {
      const shares = (amount / price).toFixed(2);
      console.log(`${colors.green}✅ Trade executed!${colors.reset}`);
      console.log(`   Bought ${shares} ${outcome} shares at $${price.toFixed(4)}`);
      console.log(`   Invested: $${amount.toFixed(2)}`);
      console.log(`   New balance: $${portfolio.balance.toFixed(2)}`);
    } else {
      console.log(`${colors.red}❌ Trade failed: ${result.error}${colors.reset}`);
    }
  }
  
  function displayPortfolio() {
    const positions = portfolio.getOpenPositionsForMarket(event.slug);
    const closedTrades = portfolio.closedTrades.length;
    const totalProfitLoss = portfolio.totalProfitLoss;
    
    console.log(`\n${colors.bright}${colors.cyan}📊 PORTFOLIO SUMMARY${colors.reset}`);
    console.log(`   Cash Balance: $${portfolio.balance.toFixed(2)}`);
    console.log(`   Open Positions: ${positions.length}`);
    console.log(`   Closed Trades: ${closedTrades}`);
    console.log(`   Total Realized P&L: ${totalProfitLoss >= 0 ? colors.green : colors.red}${totalProfitLoss >= 0 ? '+' : ''}$${totalProfitLoss.toFixed(2)}${colors.reset}\n`);
    
    if (positions.length > 0) {
      console.log(`${colors.cyan}Current Market Positions (Locked-In Returns):${colors.reset}`);
      positions.forEach(pos => {
        // Locked-in return: shares × $1.00 if this outcome wins
        const lockedReturn = pos.shares * 1.00;
        const lockedProfit = lockedReturn - pos.invested;
        const lockedROI = ((lockedProfit / pos.invested) * 100).toFixed(2);
        
        console.log(`   • ${pos.outcome}: ${pos.shares.toFixed(2)} shares @ $${pos.pricePerShare.toFixed(4)}`);
        console.log(`     Cost: $${pos.invested.toFixed(2)} | If Wins: $${lockedReturn.toFixed(2)} | Expected P&L: ${lockedProfit >= 0 ? colors.green : colors.red}${lockedProfit >= 0 ? '+' : ''}$${lockedProfit.toFixed(2)} (${lockedROI}%)${colors.reset}`);
      });
      console.log('');
    }
  }
  
  function displayStats() {
    const stats = portfolio.getStats();
    
    console.log(`\n${colors.bright}${colors.cyan}📈 TRADING STATISTICS${colors.reset}`);
    console.log(`   Total Trades: ${stats.totalTrades}`);
    console.log(`   Wins: ${colors.green}${stats.wins}${colors.reset} | Losses: ${colors.red}${stats.losses}${colors.reset}`);
    console.log(`   Win Rate: ${parseFloat(stats.winRate) >= 50 ? colors.green : colors.red}${stats.winRate}%${colors.reset}`);
    console.log(`   Average ROI: ${parseFloat(stats.averageROI) >= 0 ? colors.green : colors.red}${stats.averageROI}%${colors.reset}\n`);
  }
  
  function displayHelp() {
    console.log(`\n${colors.bright}${colors.cyan}📚 AVAILABLE COMMANDS${colors.reset}`);
    console.log(`   buy up [amount]    - Buy Up shares (default: $100)`);
    console.log(`   buy down [amount]  - Buy Down shares (default: $100)`);
    console.log(`   portfolio          - View your positions`);
    console.log(`   stats              - View trading statistics`);
    console.log(`   strategy           - View automated strategy performance`);
    console.log(`   help               - Show this help\n`);
  }

  const pollData = async () => {
    iteration++;
    logSeparator();
    console.log(`${colors.bright}Update #${iteration} - ${formatTimestamp(Date.now())}${colors.reset}\n`);

    // Check if market has ended
    const now = Date.now();
    const endTime = new Date(event.endDate).getTime();
    const timeUntilEnd = endTime - now;
    
    if (timeUntilEnd <= 0 && !hasEnded) {
      hasEnded = true;
      console.log(`\n${colors.red}⚠️  Market has ended!${colors.reset}`);
      
      clearInterval(intervalId);
      rl.close(); // Close readline for this market
      
      // Check for open positions to close
      const openPositions = portfolio.getOpenPositionsForMarket(event.slug);
      if (openPositions.length > 0) {
        console.log(`${colors.yellow}📊 You have ${openPositions.length} open position(s) for this market${colors.reset}`);
        console.log(`${colors.cyan}Waiting for Polymarket to resolve the market...${colors.reset}\n`);
        
        try {
          // Wait for Polymarket to resolve and get the winner
          const resolution = await priceTracker.getResolution(event.slug);
          const actualOutcome = resolution.winner;
          
          console.log(`${colors.bright}${colors.green}🎯 Market Resolved: ${actualOutcome} WINS${colors.reset}\n`);
          
          // Close all positions for this market
          const results = portfolio.closeMarketPositions(event.slug, actualOutcome);
          
          console.log(`${colors.bright}${colors.cyan}📊 POSITION SETTLEMENTS${colors.reset}`);
          let totalPayout = 0;
          let totalInvested = 0;
          
          for (const result of results) {
            if (result.success) {
              const pos = result.position;
              totalPayout += pos.payout;
              totalInvested += pos.invested;
              
              const profitColor = pos.won ? colors.green : colors.red;
              console.log(`  ${pos.outcome}: ${pos.won ? '✅ WON' : '❌ LOST'}`);
              console.log(`    Investment: $${pos.invested.toFixed(2)}`);
              console.log(`    Payout: $${pos.payout.toFixed(2)}`);
              console.log(`    ${profitColor}P&L: ${pos.profitLoss >= 0 ? '+' : ''}$${pos.profitLoss.toFixed(2)} (${pos.roi}%)${colors.reset}`);
            }
          }
          
          const netProfit = totalPayout - totalInvested;
          const totalROI = totalInvested > 0 ? ((netProfit / totalInvested) * 100).toFixed(2) : 0;
          
          console.log(`\n  ${colors.bright}Total: ${netProfit >= 0 ? colors.green : colors.red}${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)} (${totalROI}%)${colors.reset}`);
          console.log(`  ${colors.cyan}New Balance: $${portfolio.balance.toFixed(2)}${colors.reset}\n`);
          
          // Record results in strategy
          if (openPositions.length > 0) {
            strategy.recordMarketResult(event.slug, event.title, actualOutcome, openPositions);
            strategy.displaySummary(colors);
          }
        } catch (error) {
          console.log(`${colors.red}❌ Error getting resolution: ${error.message}${colors.reset}`);
          console.log(`${colors.yellow}⚠️  Positions remain open. You can manually resolve them later.${colors.reset}\n`);
        }
      }
      
      console.log(`${colors.yellow}Searching for next market...${colors.reset}\n`);
      
      // Retry logic to find next market
      let nextMarket = null;
      let retries = 0;
      const maxRetries = 5;
      
      while (!nextMarket && retries < maxRetries) {
        nextMarket = await findNextMarket(event.endDate);
        
        if (!nextMarket) {
          retries++;
          console.log(`${colors.yellow}Retry ${retries}/${maxRetries} - waiting 5 seconds...${colors.reset}`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      if (nextMarket) {
        console.log(`${colors.green}✅ Found next market: ${nextMarket.title}${colors.reset}`);
        console.log(`${colors.yellow}End time: ${formatTimestamp(nextMarket.endDate)}${colors.reset}\n`);
        
        // Wait 2 seconds before transitioning
        setTimeout(() => {
          streamMarketData(nextMarket, true);
        }, 2000);
      } else {
        console.error(`${colors.red}No next market found after ${maxRetries} retries.${colors.reset}`);
        console.log(`${colors.yellow}Attempting to find any active market...${colors.reset}`);
        
        // Last resort - find any active market
        setTimeout(async () => {
          const anyActiveMarket = await findCurrentActiveMarket();
          if (anyActiveMarket) {
            streamMarketData(anyActiveMarket, true);
          } else {
            console.error(`${colors.red}Stream ended - no active markets available.${colors.reset}`);
          }
        }, 5000);
      }
      
      return;
    }

    // Display time until market ends
    if (timeUntilEnd > 0) {
      const minutes = Math.floor(timeUntilEnd / 60000);
      const seconds = Math.floor((timeUntilEnd % 60000) / 1000);
      console.log(`${colors.yellow}⏱️  Time until market ends: ${minutes}m ${seconds}s${colors.reset}\n`);
    }

    // Store prices for both outcomes calculation
    const outcomePrices = [];
    
    // Fetch prices and orderbooks for each outcome
    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      const tokenId = clobTokenIds[i];

      console.log(`${colors.bright}${colors.blue}📊 ${outcome}${colors.reset}`);

      // Get current prices
      const buyPrice = await fetchMarketPrice(tokenId, 'buy');
      const sellPrice = await fetchMarketPrice(tokenId, 'sell');

      if (buyPrice && sellPrice) {
        const buyPriceNum = parseFloat(buyPrice);
        const sellPriceNum = parseFloat(sellPrice);
        const probability = (buyPriceNum * 100).toFixed(2);
        
        // Update current prices for paper trading
        if (outcome.toLowerCase() === 'up') {
          currentPrices.up = buyPriceNum;
          
          // Record start price on first iteration
          if (startPrices.up === null) {
            startPrices.up = buyPriceNum;
            startPrices.timestamp = Date.now();
          }
        } else if (outcome.toLowerCase() === 'down') {
          currentPrices.down = buyPriceNum;
          
          // Record start price on first iteration
          if (startPrices.down === null) {
            startPrices.down = buyPriceNum;
            startPrices.timestamp = Date.now();
          }
        }
        
        // Store for both outcomes calculation
        outcomePrices.push({ outcome, buyPrice: buyPriceNum });
        
        // Calculate returns if buying at current price
        const payout = 1.00; // Each winning share pays $1
        const profitIfWin = payout - buyPriceNum; // If this outcome wins
        const lossIfLose = -buyPriceNum; // If this outcome loses (you lose your entire investment)
        const roiIfWin = ((profitIfWin / buyPriceNum) * 100).toFixed(2);
        
        // Expected Value: (probability × payout) - cost
        // In an efficient market, EV should be close to $0
        const expectedValue = (buyPriceNum * payout) - buyPriceNum;
        
        console.log(`  ${colors.green}Buy Price:${colors.reset} $${buyPrice} (${probability}% implied probability)`);
        console.log(`  ${colors.red}Sell Price:${colors.reset} $${sellPrice}`);
        console.log(`  ${colors.yellow}Spread:${colors.reset} $${(sellPriceNum - buyPriceNum).toFixed(4)}`);
        
        // Show potential returns
        console.log(`  ${colors.bright}${colors.cyan}📈 If you buy ${outcome} for $100:${colors.reset}`);
        const shares = 100 / buyPriceNum;
        const winAmount = shares * payout;
        const profitAmount = winAmount - 100;
        const lossAmount = -100;
        
        console.log(`     ${colors.cyan}→ You get ${shares.toFixed(2)} shares${colors.reset}`);
        console.log(`     ${colors.green}✓ If ${outcome} wins: Receive $${winAmount.toFixed(2)} (profit: +$${profitAmount.toFixed(2)}, ROI: +${roiIfWin}%)${colors.reset}`);
        console.log(`     ${colors.red}✗ If ${outcome} loses: Receive $0.00 (loss: -$100.00, ROI: -100%)${colors.reset}`);
        console.log(`     ${colors.yellow}⚖️  Expected Value: $${expectedValue.toFixed(4)} per share${colors.reset}`);
      }

      // Get orderbook depth
      const orderbook = await fetchOrderbook(tokenId);
      if (orderbook) {
        const topBid = orderbook.bids && orderbook.bids[0];
        const topAsk = orderbook.asks && orderbook.asks[0];
        
        console.log(`  ${colors.cyan}Top Bid:${colors.reset} ${topBid ? `$${topBid.price} (${topBid.size} shares)` : 'N/A'}`);
        console.log(`  ${colors.cyan}Top Ask:${colors.reset} ${topAsk ? `$${topAsk.price} (${topAsk.size} shares)` : 'N/A'}`);
        
        const totalBidSize = orderbook.bids?.reduce((sum, bid) => sum + parseFloat(bid.size), 0) || 0;
        const totalAskSize = orderbook.asks?.reduce((sum, ask) => sum + parseFloat(ask.size), 0) || 0;
        
        console.log(`  ${colors.cyan}Total Bid Liquidity:${colors.reset} ${totalBidSize.toFixed(2)} shares`);
        console.log(`  ${colors.cyan}Total Ask Liquidity:${colors.reset} ${totalAskSize.toFixed(2)} shares`);
      }

      console.log('');
    }
    
    // Continuously evaluate and execute strategy throughout the market
    if (outcomePrices.length === 2 && currentPrices.up > 0 && currentPrices.down > 0) {
      const decision = strategy.shouldExecute(event.slug, currentPrices.up, currentPrices.down);
      
      if (decision.shouldExecute) {
        // Execute the strategy (will only buy positions we don't already have)
        const result = strategy.execute(
          event.slug,
          event.title,
          event.endDate,
          currentPrices.up,
          currentPrices.down,
          colors
        );
      } else {
        // Only show detailed analysis on first iteration
        if (iteration === 1) {
          console.log(`\n${colors.bright}${colors.yellow}📊 INITIAL ANALYSIS${colors.reset}`);
          console.log(`${colors.yellow}Continuously monitoring for >110% ROI opportunities...${colors.reset}\n`);
          
          if (decision.analysis) {
            const { up, down } = decision.analysis;
            
            console.log(`  ${colors.cyan}UP:${colors.reset}`);
            console.log(`    Price: $${up.price.toFixed(4)}`);
            console.log(`    Shares: ${up.shares.toFixed(2)}`);
            console.log(`    Potential Return: $${up.potentialReturn.toFixed(2)}`);
            console.log(`    ROI: ${up.roi}%`);
            console.log(`    ${up.isProfitable ? colors.green + `✅ Meets $${MIN_EXPECTED_RETURN} threshold!` : colors.red + `❌ Below $${MIN_EXPECTED_RETURN} threshold`}${colors.reset}`);
            
            console.log(`\n  ${colors.cyan}DOWN:${colors.reset}`);
            console.log(`    Price: $${down.price.toFixed(4)}`);
            console.log(`    Shares: ${down.shares.toFixed(2)}`);
            console.log(`    Potential Return: $${down.potentialReturn.toFixed(2)}`);
            console.log(`    ROI: ${down.roi}%`);
            console.log(`    ${down.isProfitable ? colors.green + `✅ Meets $${MIN_EXPECTED_RETURN} threshold!` : colors.red + `❌ Below $${MIN_EXPECTED_RETURN} threshold`}${colors.reset}\n`);
          }
        }
      }
    }
    
    // Calculate what happens if you buy BOTH outcomes (educational display)
    if (outcomePrices.length === 2) {
      console.log(`${colors.bright}${colors.yellow}🔄 HEDGE ANALYSIS (Both Outcomes)${colors.reset}`);
      console.log(`${colors.yellow}What happens if you hedge by buying both Up AND Down?${colors.reset}\n`);
      
      const investmentPerOutcome = 100;
      const totalInvestment = investmentPerOutcome * 2;
      
      const upPrice = outcomePrices[0].buyPrice;
      const downPrice = outcomePrices[1].buyPrice;
      const upShares = investmentPerOutcome / upPrice;
      const downShares = investmentPerOutcome / downPrice;
      
      console.log(`  ${colors.cyan}Investment Breakdown:${colors.reset}`);
      console.log(`     • Buy ${upShares.toFixed(2)} Up shares at $${upPrice.toFixed(2)} = $${investmentPerOutcome.toFixed(2)}`);
      console.log(`     • Buy ${downShares.toFixed(2)} Down shares at $${downPrice.toFixed(2)} = $${investmentPerOutcome.toFixed(2)}`);
      console.log(`     ${colors.bright}• Total Investment: $${totalInvestment.toFixed(2)}${colors.reset}\n`);
      
      const payoutIfUpWins = upShares * 1.00;
      const payoutIfDownWins = downShares * 1.00;
      const profitIfUpWins = payoutIfUpWins - totalInvestment;
      const profitIfDownWins = payoutIfDownWins - totalInvestment;
      const roiIfUpWins = ((profitIfUpWins / totalInvestment) * 100).toFixed(2);
      const roiIfDownWins = ((profitIfDownWins / totalInvestment) * 100).toFixed(2);
      
      console.log(`  ${colors.cyan}Guaranteed Outcomes:${colors.reset}`);
      console.log(`     ${colors.green}✓ If Up wins:${colors.reset} Get $${payoutIfUpWins.toFixed(2)} → ${profitIfUpWins >= 0 ? colors.green + 'Profit' : colors.red + 'Loss'}: ${profitIfUpWins >= 0 ? '+' : ''}$${profitIfUpWins.toFixed(2)} (${roiIfUpWins}% ROI)${colors.reset}`);
      console.log(`     ${colors.green}✓ If Down wins:${colors.reset} Get $${payoutIfDownWins.toFixed(2)} → ${profitIfDownWins >= 0 ? colors.green + 'Profit' : colors.red + 'Loss'}: ${profitIfDownWins >= 0 ? '+' : ''}$${profitIfDownWins.toFixed(2)} (${roiIfDownWins}% ROI)${colors.reset}\n`);
      
      // Calculate per-share cost
      const costPerSharePair = upPrice + downPrice;
      const guaranteedPayoutPerShare = 1.00; // One share always wins
      const netProfitPerShare = guaranteedPayoutPerShare - costPerSharePair;
      const roiPerShare = ((netProfitPerShare / costPerSharePair) * 100).toFixed(2);
      
      console.log(`  ${colors.yellow}Per-Share Analysis:${colors.reset}`);
      console.log(`     • Cost to buy 1 Up + 1 Down: $${costPerSharePair.toFixed(4)}`);
      console.log(`     • Guaranteed payout: $1.00 (one share wins)`);
      console.log(`     ${colors.bright}• Net result: ${netProfitPerShare >= 0 ? colors.green + 'Profit' : colors.red + 'Loss'} ${netProfitPerShare >= 0 ? '+' : ''}$${netProfitPerShare.toFixed(4)} (${roiPerShare}% ROI)${colors.reset}\n`);
      
      if (netProfitPerShare < 0) {
        console.log(`  ${colors.red}⚠️  VERDICT: Buying both outcomes results in a GUARANTEED LOSS of ${Math.abs(parseFloat(roiPerShare)).toFixed(2)}%${colors.reset}`);
        console.log(`  ${colors.yellow}The market prices are efficient - no free lunch!${colors.reset}\n`);
      } else if (netProfitPerShare > 0) {
        console.log(`  ${colors.green}💡 ARBITRAGE OPPORTUNITY! You can profit ${roiPerShare}% risk-free by buying both!${colors.reset}\n`);
      } else {
        console.log(`  ${colors.yellow}⚖️  The market is perfectly balanced - no profit, no loss.${colors.reset}\n`);
      }
    }

    // Display market volume if available
    if (market.volume) {
      console.log(`${colors.yellow}💰 Total Volume:${colors.reset} $${parseFloat(market.volume).toLocaleString()}`);
    }
    
    // Display portfolio summary if there are positions
    const positions = portfolio.getOpenPositionsForMarket(event.slug);
    if (positions.length > 0) {
      console.log(`\n${colors.bright}${colors.cyan}💼 YOUR POSITIONS (Locked-In Returns)${colors.reset}`);
      
      let totalInvested = 0;
      
      positions.forEach(pos => {
        // Locked-in return: shares × $1.00 if this outcome wins
        const lockedReturn = pos.shares * 1.00;
        const lockedProfit = lockedReturn - pos.invested;
        const lockedROI = ((lockedProfit / pos.invested) * 100).toFixed(2);
        
        totalInvested += pos.invested;
        
        console.log(`  ${pos.outcome}: ${pos.shares.toFixed(2)} shares @ $${pos.pricePerShare.toFixed(4)}`);
        console.log(`  ${colors.yellow}Cost:${colors.reset} $${pos.invested.toFixed(2)} | ${colors.cyan}If Wins:${colors.reset} $${lockedReturn.toFixed(2)} | ${colors.yellow}Expected P&L:${colors.reset} ${lockedProfit >= 0 ? colors.green : colors.red}${lockedProfit >= 0 ? '+' : ''}$${lockedProfit.toFixed(2)} (${lockedROI}%)${colors.reset}`);
      });
      
      console.log(`\n  ${colors.bright}Total Invested: $${totalInvested.toFixed(2)}${colors.reset}`);
      
      // Show what happens in each scenario
      if (positions.length === 2) {
        const upPos = positions.find(p => p.outcome.toLowerCase() === 'up');
        const downPos = positions.find(p => p.outcome.toLowerCase() === 'down');
        
        if (upPos && downPos) {
          const upReturn = upPos.shares * 1.00;
          const downReturn = downPos.shares * 1.00;
          const totalInvestment = upPos.invested + downPos.invested;
          
          const upScenarioProfit = upReturn - totalInvestment;
          const downScenarioProfit = downReturn - totalInvestment;
          
          console.log(`  ${colors.cyan}Scenarios:${colors.reset}`);
          console.log(`    If Up wins:   ${upScenarioProfit >= 0 ? colors.green : colors.red}${upScenarioProfit >= 0 ? '+' : ''}$${upScenarioProfit.toFixed(2)}${colors.reset} (${((upScenarioProfit / totalInvestment) * 100).toFixed(2)}% ROI)`);
          console.log(`    If Down wins: ${downScenarioProfit >= 0 ? colors.green : colors.red}${downScenarioProfit >= 0 ? '+' : ''}$${downScenarioProfit.toFixed(2)}${colors.reset} (${((downScenarioProfit / totalInvestment) * 100).toFixed(2)}% ROI)`);
        }
      }
    }
    
    // Display overall portfolio summary
    console.log(`\n${colors.cyan}💰 Cash Balance: $${portfolio.balance.toFixed(2)}${colors.reset}`);
    
    // Display price tracking (Polymarket share prices from CLOB API)
    if (startPrices.up !== null && startPrices.down !== null) {
      console.log(`\n${colors.bright}${colors.yellow}📊 PRICE TRACKING${colors.reset}`);
      
      // Up price change
      const upChange = currentPrices.up - startPrices.up;
      const upChangePercent = ((upChange / startPrices.up) * 100).toFixed(2);
      console.log(`  Up:   Start $${startPrices.up.toFixed(4)} → Current $${currentPrices.up.toFixed(4)} ${upChange >= 0 ? colors.green : colors.red}(${upChange >= 0 ? '+' : ''}$${upChange.toFixed(4)}, ${upChange >= 0 ? '+' : ''}${upChangePercent}%)${colors.reset}`);
      
      // Down price change
      const downChange = currentPrices.down - startPrices.down;
      const downChangePercent = ((downChange / startPrices.down) * 100).toFixed(2);
      console.log(`  Down: Start $${startPrices.down.toFixed(4)} → Current $${currentPrices.down.toFixed(4)} ${downChange >= 0 ? colors.green : colors.red}(${downChange >= 0 ? '+' : ''}$${downChange.toFixed(4)}, ${downChange >= 0 ? '+' : ''}${downChangePercent}%)${colors.reset}`);
      
      // Combined price
      const startCombined = startPrices.up + startPrices.down;
      const currentCombined = currentPrices.up + currentPrices.down;
      const combinedChange = currentCombined - startCombined;
      console.log(`  Combined: Start $${startCombined.toFixed(4)} → Current $${currentCombined.toFixed(4)} ${combinedChange >= 0 ? colors.green : colors.red}(${combinedChange >= 0 ? '+' : ''}$${combinedChange.toFixed(4)})${colors.reset}`);
    }
  };

  // Initial poll
  await pollData();

  // Set up interval for continuous polling (only if market hasn't ended)
  if (!hasEnded) {
    intervalId = setInterval(pollData, POLL_INTERVAL);
  }
}

// Check for and close any positions from expired markets on startup
async function cleanupExpiredPositions() {
  const allOpen = portfolio.openPositions;
  
  if (allOpen.length === 0) {
    return;
  }
  
  console.log(`${colors.yellow}🔍 Checking for positions from expired markets...${colors.reset}\n`);
  
  const now = Date.now();
  const expiredPositions = allOpen.filter(pos => {
    const endTime = new Date(pos.marketEndDate).getTime();
    return endTime < now;
  });
  
  if (expiredPositions.length === 0) {
    console.log(`${colors.green}✅ No expired positions found${colors.reset}\n`);
    return;
  }
  
  console.log(`${colors.yellow}Found ${expiredPositions.length} position(s) from expired market(s)${colors.reset}\n`);
  
  // Group by market
  const marketGroups = {};
  for (const pos of expiredPositions) {
    if (!marketGroups[pos.marketSlug]) {
      marketGroups[pos.marketSlug] = [];
    }
    marketGroups[pos.marketSlug].push(pos);
  }
  
  // Resolve each market
  for (const [marketSlug, positions] of Object.entries(marketGroups)) {
    const marketTitle = positions[0].marketTitle;
    const marketEnd = positions[0].marketEndDate;
    
    console.log(`${colors.cyan}📊 Resolving: ${marketTitle}${colors.reset}`);
    console.log(`   Ended: ${formatTimestamp(marketEnd)}`);
    console.log(`   Positions: ${positions.length}`);
    
    try {
      const resolution = await priceTracker.getResolution(marketSlug);
      const actualOutcome = resolution.winner;
      
      console.log(`   ${colors.green}Winner: ${actualOutcome}${colors.reset}\n`);
      
      const results = portfolio.closeMarketPositions(marketSlug, actualOutcome);
      
      let totalPayout = 0;
      let totalInvested = 0;
      
      for (const result of results) {
        if (result.success) {
          const pos = result.position;
          totalPayout += pos.payout;
          totalInvested += pos.invested;
          
          const profitColor = pos.won ? colors.green : colors.red;
          console.log(`   ${pos.outcome}: ${pos.won ? '✅ WON' : '❌ LOST'} - ${profitColor}${pos.profitLoss >= 0 ? '+' : ''}$${pos.profitLoss.toFixed(2)} (${pos.roi}%)${colors.reset}`);
        }
      }
      
      const netProfit = totalPayout - totalInvested;
      console.log(`   ${colors.bright}Net: ${netProfit >= 0 ? colors.green : colors.red}${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}${colors.reset}\n`);
      
      // Record in strategy
      strategy.recordMarketResult(marketSlug, marketTitle, actualOutcome, positions);
      
    } catch (error) {
      console.log(`   ${colors.red}❌ Error: ${error.message}${colors.reset}`);
      console.log(`   ${colors.yellow}Positions remain open${colors.reset}\n`);
    }
  }
  
  console.log(`${colors.cyan}New Balance: $${portfolio.balance.toFixed(2)}${colors.reset}\n`);
  logSeparator();
}

// Start streaming - automatically find current active market
console.log(`${colors.bright}${colors.blue}🚀 Bitcoin Up/Down Market Streamer${colors.reset}`);
console.log(`${colors.cyan}Initializing - searching for active markets...${colors.reset}\n`);

// Clean up expired positions, then start streaming
cleanupExpiredPositions().then(() => {
  return streamMarketData();
}).catch(error => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
