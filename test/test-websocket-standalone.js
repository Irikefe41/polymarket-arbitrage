/**
 * Standalone WebSocket Test Script
 * 
 * Tests Polymarket WebSocket connection without touching the main bot.
 * Run with: node test/test-websocket-standalone.js
 * 
 * This will:
 * 1. Connect to Polymarket WebSocket
 * 2. Subscribe to a test market's tokens
 * 3. Log price updates in real-time
 * 4. Test reconnection logic
 */

import WebSocket from 'ws';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

// Log file setup
const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, 'websocket-test.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Initialize log file
const timestamp = new Date().toISOString();
fs.writeFileSync(LOG_FILE, `=== WebSocket Test Started at ${timestamp} ===\n\n`);

/**
 * Dual logging: console + file
 */
function log(message, skipFile = false) {
  // Strip ANSI color codes for file output
  const cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, '');
  const timestampedMessage = `[${new Date().toISOString()}] ${cleanMessage}`;
  
  // Console output (with colors)
  console.log(message);
  
  // File output (without colors)
  if (!skipFile) {
    fs.appendFileSync(LOG_FILE, timestampedMessage + '\n');
  }
}

/**
 * Log to file only
 */
function logToFile(message) {
  const timestampedMessage = `[${new Date().toISOString()}] ${message}`;
  fs.appendFileSync(LOG_FILE, timestampedMessage + '\n');
}

// WebSocket endpoint
const WS_ENDPOINT = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const GAMMA_API = 'https://gamma-api.polymarket.com';

// Test market (get from latest BTC Up/Down market)
let testTokenIds = [];
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelays = [1000, 2000, 5000, 10000, 30000];

// Price tracking
const prices = new Map();
const priceHistory = [];

// Stats
let messagesReceived = 0;
let connectionStartTime = Date.now();
let lastMessageTime = Date.now();

/**
 * Get current market timestamp (same logic as main bot)
 */
function getCurrentMarketTimestamp() {
  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const marketInterval = 900; // 15 minutes in seconds
  
  // Round down to the last 15-minute boundary
  // This is the START time of the current market
  const currentWindowStart = Math.floor(nowSeconds / marketInterval) * marketInterval;
  const currentWindowEnd = currentWindowStart + marketInterval;
  
  const startDate = new Date(currentWindowStart * 1000);
  const endDate = new Date(currentWindowEnd * 1000);
  const remainingMs = (currentWindowEnd * 1000) - nowMs;
  const remainingMin = Math.floor(remainingMs / 60000);
  const remainingSec = Math.floor((remainingMs % 60000) / 1000);
  
  log(`${colors.cyan}[Timestamp Calculation]${colors.reset}`);
  log(`   Current Unix: ${nowSeconds}`);
  log(`   Current Time: ${new Date(nowMs).toISOString()}`);
  log(`   Market Start: ${startDate.toISOString()}`);
  log(`   Market End:   ${endDate.toISOString()}`);
  log(`   Remaining:    ${remainingMin}m ${remainingSec}s`);
  log(`   Start Timestamp (slug): ${currentWindowStart}`);
  
  // Warn if market is near end
  if (remainingMin < 5) {
    log(`${colors.yellow}⚠️  WARNING: Market ends in ${remainingMin}m ${remainingSec}s!${colors.reset}`);
    log(`${colors.yellow}   Prices may be extreme ($0.99) near market end.${colors.reset}`);
    log(`${colors.yellow}   For best results, test at market start (every :00, :15, :30, :45).${colors.reset}`);
  }
  log('');
  
  return currentWindowStart;
}

/**
 * Fetch a current market to get token IDs for testing
 */
async function fetchTestMarket() {
  try {
    log(`${colors.cyan}🔍 Fetching current BTC Up/Down market for testing...${colors.reset}`);
    
    // Use the same timestamp calculation as main bot
    const timestamp = getCurrentMarketTimestamp();
    const slug = `btc-updown-15m-${timestamp}`;
    
    log(`${colors.dim}   Fetching market: ${slug}${colors.reset}`);
    
    const response = await fetch(`${GAMMA_API}/events?slug=${slug}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data && data.length > 0) {
      const event = data[0];
      const market = event.markets[0];
      const clobTokenIds = JSON.parse(market.clobTokenIds);
      const outcomes = JSON.parse(market.outcomes);
      
      log(`${colors.green}✅ Found market: ${event.title}${colors.reset}`);
      log(`${colors.cyan}   Token IDs:${colors.reset}`);
      outcomes.forEach((outcome, i) => {
        log(`     ${outcome}: ${clobTokenIds[i]}`);
      });
      log('');
      
      return {
        tokenIds: clobTokenIds,
        outcomes: outcomes,
        marketTitle: event.title
      };
    }
    
    throw new Error('No market found');
  } catch (error) {
    log(`${colors.red}❌ Error fetching test market:${colors.reset} ${error.message}`);
    process.exit(1);
  }
}

/**
 * Connect to WebSocket
 */
function connect(marketInfo) {
  log(`${colors.bright}${colors.cyan}🔌 Connecting to Polymarket WebSocket...${colors.reset}`);
  log(`${colors.dim}   Endpoint: ${WS_ENDPOINT}${colors.reset}\n`);
  
  ws = new WebSocket(WS_ENDPOINT);
  
  ws.on('open', () => {
    log(`${colors.green}✅ WebSocket connected!${colors.reset}`);
    connectionStartTime = Date.now();
    reconnectAttempts = 0; // Reset on successful connection
    
    // Subscribe to market tokens
    const subscription = {
      assets_ids: marketInfo.tokenIds,
      type: 'market'
    };
    
    log(`${colors.cyan}📡 Subscribing to tokens...${colors.reset}`);
    log(`${colors.dim}   ${JSON.stringify(subscription, null, 2)}${colors.reset}\n`);
    
    ws.send(JSON.stringify(subscription));
    
    log(`${colors.bright}${colors.green}🎧 Listening for price updates...${colors.reset}`);
    log(`${colors.dim}   Press Ctrl+C to stop${colors.reset}\n`);
    log(`${'='.repeat(80)}\n`);
  });
  
  ws.on('message', (data) => {
    try {
      messagesReceived++;
      lastMessageTime = Date.now();
      
      const rawMessage = data.toString();
      
      // Log first 10 raw messages for debugging
      if (messagesReceived <= 10) {
        logToFile(`RAW MESSAGE #${messagesReceived}: ${rawMessage}`);
      }
      
      const message = JSON.parse(rawMessage);
      handleMessage(message, marketInfo);
    } catch (error) {
      log(`${colors.red}Error parsing message:${colors.reset} ${error.message}`);
      logToFile(`PARSE ERROR: ${error.message}, Data: ${data.toString()}`);
    }
  });
  
  ws.on('error', (error) => {
    log(`${colors.red}❌ WebSocket error:${colors.reset} ${error.message}`);
  });
  
  ws.on('close', (code, reason) => {
    log(`${colors.yellow}⚠️  WebSocket disconnected${colors.reset}`);
    log(`${colors.dim}   Code: ${code}, Reason: ${reason || 'Unknown'}${colors.reset}`);
    
    // Try to reconnect
    if (reconnectAttempts < maxReconnectAttempts) {
      const delay = reconnectDelays[Math.min(reconnectAttempts, reconnectDelays.length - 1)];
      reconnectAttempts++;
      
      log(`${colors.yellow}🔄 Reconnecting in ${delay}ms... (attempt ${reconnectAttempts}/${maxReconnectAttempts})${colors.reset}\n`);
      
      setTimeout(() => connect(marketInfo), delay);
    } else {
      log(`${colors.red}❌ Max reconnection attempts reached. Exiting.${colors.reset}`);
      displayStats();
      process.exit(1);
    }
  });
}

/**
 * Handle WebSocket message
 */
function handleMessage(message, marketInfo) {
  // Handle array of messages or single message
  const messages = Array.isArray(message) ? message : [message];
  
  for (const msg of messages) {
    const { event_type, asset_id, market, timestamp } = msg;
    
    // Skip messages without event_type
    if (!event_type) {
      continue;
    }
    
    // Find which outcome this token represents
    const tokenIndex = marketInfo.tokenIds.indexOf(asset_id);
    const outcome = tokenIndex >= 0 ? marketInfo.outcomes[tokenIndex] : 'Unknown';
    
    switch (event_type) {
      case 'book':
        handleOrderBookUpdate(msg, outcome);
        break;
        
      case 'price_change':
        handlePriceChange(msg, marketInfo); // Pass marketInfo instead of outcome
        break;
        
      case 'trade':
        handleTrade(msg, outcome);
        break;
        
      case 'last_trade_price':
        // Ignore for now - this is just metadata
        break;
        
      default:
        // Only log first few unknown events
        if (messagesReceived <= 50) {
          log(`${colors.dim}[${new Date().toLocaleTimeString()}] Unknown event: ${event_type}${colors.reset}`);
        }
    }
  }
}

/**
 * Handle order book update
 */
function handleOrderBookUpdate(data, outcome) {
  const { asset_id, bids, asks, timestamp } = data;
  
  if (!asks || asks.length === 0) {
    // Log first few missing asks for debugging
    if (messagesReceived <= 20) {
      logToFile(`BOOK missing asks: ${JSON.stringify(data)}`);
    }
    return;
  }
  
  const bestAsk = asks[0];
  
  // Handle different price formats
  const priceValue = bestAsk.price || bestAsk.p;
  const sizeValue = bestAsk.size || bestAsk.s;
  
  if (!priceValue) {
    if (messagesReceived <= 20) {
      logToFile(`BOOK ask missing price: ${JSON.stringify(bestAsk)}`);
    }
    return;
  }
  
  const buyPrice = parseFloat(priceValue);
  const size = parseFloat(sizeValue || 0);
  
  // Validate price
  if (isNaN(buyPrice) || buyPrice < 0.001 || buyPrice > 0.999) {
    return;
  }
  
  // Store price
  const oldPrice = prices.get(asset_id);
  prices.set(asset_id, { price: buyPrice, timestamp: Date.now() });
  
  // Track history
  priceHistory.push({
    outcome,
    price: buyPrice,
    timestamp: Date.now(),
    type: 'book'
  });
  
  // Keep history limited
  if (priceHistory.length > 100) {
    priceHistory.shift();
  }
  
  // Display update (only show if price changed significantly)
  const priceChange = oldPrice ? (buyPrice - oldPrice.price) : 0;
  
  if (!oldPrice || Math.abs(priceChange) >= 0.0001) {
    const changeSymbol = priceChange > 0 ? '↗' : priceChange < 0 ? '↘' : '→';
    const changeColor = priceChange > 0 ? colors.green : priceChange < 0 ? colors.red : colors.dim;
    
    log(`${colors.cyan}[${new Date().toLocaleTimeString()}]${colors.reset} ${colors.bright}${outcome}${colors.reset}: $${buyPrice.toFixed(4)} ${changeColor}${changeSymbol} ${priceChange.toFixed(4)}${colors.reset} (${size.toFixed(0)} shares available)`);
  }
}

/**
 * Handle price change event
 */
function handlePriceChange(data, marketInfo) {
  // Price change events have a price_changes array
  const { price_changes } = data;
  
  if (!price_changes || !Array.isArray(price_changes)) {
    if (messagesReceived <= 20) {
      logToFile(`PRICE_CHANGE missing price_changes array: ${JSON.stringify(data)}`);
    }
    return;
  }
  
  // Process each price change in the array
  for (const change of price_changes) {
    const { asset_id, price: priceStr, best_ask } = change;
    
    if (!asset_id) continue;
    
    // Find which outcome this token represents
    const tokenIndex = marketInfo.tokenIds.indexOf(asset_id);
    const outcome = tokenIndex >= 0 ? marketInfo.outcomes[tokenIndex] : 'Unknown';
    
    // Use best_ask as the buy price (what we care about)
    const priceValue = best_ask || priceStr;
    
    if (!priceValue) continue;
    
    const price = parseFloat(priceValue);
    
    // Validate price
    if (isNaN(price) || price < 0.001 || price > 0.999) {
      continue;
    }
    
    // Store price
    const oldPrice = prices.get(asset_id);
    prices.set(asset_id, { price, timestamp: Date.now() });
    
    // Only log if price changed significantly
    const priceChange = oldPrice ? (price - oldPrice.price) : 0;
    
    if (!oldPrice || Math.abs(priceChange) >= 0.0001) {
      const changeSymbol = priceChange > 0 ? '↗' : priceChange < 0 ? '↘' : '→';
      const changeColor = priceChange > 0 ? colors.green : priceChange < 0 ? colors.red : colors.dim;
      
      log(`${colors.yellow}[${new Date().toLocaleTimeString()}]${colors.reset} ${colors.bright}${outcome}${colors.reset} price change: $${price.toFixed(4)} ${changeColor}${changeSymbol} ${priceChange.toFixed(4)}${colors.reset}`);
    }
  }
}

/**
 * Handle trade event
 */
function handleTrade(data, outcome) {
  const { price, size, side, p, s } = data;
  
  const priceValue = price || p;
  const sizeValue = size || s;
  
  if (!priceValue || !sizeValue) {
    return;
  }
  
  const tradePrice = parseFloat(priceValue);
  const tradeSize = parseFloat(sizeValue);
  
  if (isNaN(tradePrice) || isNaN(tradeSize)) {
    return;
  }
  
  const sideColor = side === 'buy' ? colors.green : colors.red;
  const sideSymbol = side === 'buy' ? '📈' : '📉';
  
  log(`${colors.dim}[${new Date().toLocaleTimeString()}]${colors.reset} ${sideSymbol} ${outcome} trade: ${side ? side.toUpperCase() : 'UNKNOWN'} ${tradeSize.toFixed(2)} @ $${tradePrice.toFixed(4)}`);
}

/**
 * Display statistics
 */
function displayStats() {
  const uptime = ((Date.now() - connectionStartTime) / 1000).toFixed(0);
  const timeSinceLastMessage = ((Date.now() - lastMessageTime) / 1000).toFixed(0);
  
  log(`\n${'='.repeat(80)}`);
  log(`${colors.bright}${colors.cyan}📊 WebSocket Test Statistics${colors.reset}\n`);
  log(`   Uptime: ${uptime}s`);
  log(`   Messages received: ${messagesReceived}`);
  log(`   Messages/second: ${(messagesReceived / uptime).toFixed(2)}`);
  log(`   Time since last message: ${timeSinceLastMessage}s`);
  log(`   Reconnect attempts: ${reconnectAttempts}`);
  log(`\n${colors.bright}${colors.cyan}💰 Current Prices:${colors.reset}`);
  
  if (prices.size === 0) {
    log(`   ${colors.yellow}No prices received yet${colors.reset}`);
  } else {
    prices.forEach((data, tokenId) => {
      if (tokenId === undefined || tokenId === 'undefined') {
        return; // Skip undefined tokens
      }
      const age = ((Date.now() - data.timestamp) / 1000).toFixed(1);
      const shortId = tokenId.substring(0, 20) + '...';
      log(`   ${shortId}: $${data.price.toFixed(4)} (${age}s ago)`);
    });
  }
  
  if (priceHistory.length > 0) {
    const recent = priceHistory.slice(-10);
    log(`\n${colors.bright}${colors.cyan}📈 Recent Price History:${colors.reset}`);
    recent.forEach(({ outcome, price, timestamp, type }) => {
      const time = new Date(timestamp).toLocaleTimeString();
      log(`   [${time}] ${outcome}: $${price.toFixed(4)} (${type})`);
    });
  }
  
  log(`\n${'='.repeat(80)}\n`);
}

/**
 * Main function
 */
async function main() {
  log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════════════════════════════╗${colors.reset}`);
  log(`${colors.bright}${colors.cyan}║  Polymarket WebSocket Standalone Test - Phase 3A              ║${colors.reset}`);
  log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════════════════════════════╝${colors.reset}\n`);
  log(`${colors.dim}Log file: ${LOG_FILE}${colors.reset}`);
  log(`${colors.dim}First 10 raw messages will be logged for debugging${colors.reset}\n`);
  
  // Fetch test market
  const marketInfo = await fetchTestMarket();
  testTokenIds = marketInfo.tokenIds;
  
  // Connect to WebSocket
  connect(marketInfo);
  
  // Display stats every 30 seconds
  setInterval(displayStats, 30000);
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    log(`\n${colors.yellow}🛑 Shutting down...${colors.reset}\n`);
    displayStats();
    logToFile('=== WebSocket Test Ended ===');
    if (ws) {
      ws.close();
    }
    process.exit(0);
  });
}

// Run
main().catch((error) => {
  log(`${colors.red}Fatal error:${colors.reset} ${error}`);
  process.exit(1);
});
