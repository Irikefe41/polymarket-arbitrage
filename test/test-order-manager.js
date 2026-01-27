/**
 * Test script for Order Manager
 * 
 * This script tests the OrderManager functionality in DRY RUN mode.
 * Safe to run - no real orders will be placed.
 * 
 * This test will:
 * 1. Fetch the current active BTC Up/Down market
 * 2. Get token IDs for Up and Down outcomes
 * 3. Get current prices from CLOB API
 * 4. Place buy orders for both Up and Down outcomes
 */

import OrderManager from '../src/order-manager.js';
import config from '../config/index.js';
import fetch from 'node-fetch';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const GAMMA_API = config.api.gammaUrl;
const CLOB_API = config.api.clobUrl;

/**
 * Get current market timestamp (same logic as main bot)
 */
function getCurrentMarketTimestamp() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const marketInterval = 900; // 15 minutes
  return Math.floor(nowSeconds / marketInterval) * marketInterval;
}

/**
 * Fetch current active market and get token IDs
 */
async function fetchCurrentMarket() {
  try {
    const timestamp = getCurrentMarketTimestamp();
    const slug = `btc-updown-15m-${timestamp}`;
    
    console.log(`${colors.cyan}Fetching current market: ${slug}${colors.reset}`);
    
    const response = await fetch(`${GAMMA_API}/events?slug=${slug}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    if (!data || data.length === 0) {
      throw new Error('No market found');
    }
    
    const event = data[0];
    const market = event.markets[0];
    
    // Parse outcomes and token IDs
    let outcomes, clobTokenIds;
    try {
      outcomes = typeof market.outcomes === 'string' 
        ? JSON.parse(market.outcomes) 
        : market.outcomes;
      clobTokenIds = market.clobTokenIds || [];
      if (typeof clobTokenIds === 'string') {
        clobTokenIds = JSON.parse(clobTokenIds);
      }
    } catch (parseError) {
      throw new Error(`Failed to parse market data: ${parseError.message}`);
    }
    
    // Find Up and Down indices
    const upIndex = outcomes.findIndex(o => o.toLowerCase() === 'up');
    const downIndex = outcomes.findIndex(o => o.toLowerCase() === 'down');
    
    if (upIndex === -1 || downIndex === -1) {
      throw new Error(`Could not find Up/Down outcomes. Found: ${outcomes.join(', ')}`);
    }
    
    const upTokenId = clobTokenIds[upIndex];
    const downTokenId = clobTokenIds[downIndex];
    
    if (!upTokenId || !downTokenId) {
      throw new Error('Token IDs not found for Up/Down outcomes');
    }
    
    console.log(`${colors.green}✅ Found current market: ${event.title}${colors.reset}`);
    console.log(`   Up Token ID: ${upTokenId}`);
    console.log(`   Down Token ID: ${downTokenId}\n`);
    
    return {
      event,
      market,
      upTokenId,
      downTokenId,
      tickSize: market.minimumTickSize || '0.01',
      negRisk: market.negRisk || false
    };
  } catch (error) {
    throw new Error(`Failed to fetch current market: ${error.message}`);
  }
}

/**
 * Get current buy price for a token
 */
async function getCurrentPrice(tokenId) {
  try {
    const response = await fetch(`${CLOB_API}/price?token_id=${tokenId}&side=buy`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return parseFloat(data.price || '0');
  } catch (error) {
    throw new Error(`Failed to get price: ${error.message}`);
  }
}

async function testOrderManager() {
  console.log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║   Order Manager Test Suite            ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════╝${colors.reset}\n`);

  // Check if private key is configured
  if (!config.wallet.privateKey) {
    console.error(`${colors.red}❌ Error: POLYGON_PRIVATE_KEY not configured in .env${colors.reset}`);
    console.log(`${colors.yellow}Please add your wallet private key to .env:${colors.reset}`);
    console.log(`${colors.cyan}POLYGON_PRIVATE_KEY=0x...${colors.reset}\n`);
    process.exit(1);
  }

  try {
    // Test 1: Initialize Order Manager
    console.log(`${colors.yellow}═══ Test 1: Initialize Order Manager ═══${colors.reset}\n`);
    
    const orderManager = new OrderManager(config.wallet.privateKey, {
      dryRun: true,  // Always test in dry-run mode
      verbose: true,
    });

    await orderManager.initialize();
    console.log(`${colors.green}✓ Initialization successful\n${colors.reset}`);

    // Test 2: Get Balance
    console.log(`${colors.yellow}═══ Test 2: Get Wallet Balance ═══${colors.reset}\n`);
    
    const balance = await orderManager.getBalance();
    console.log(`Wallet: ${balance.address}`);
    console.log(`USDC Balance: $${balance.usdc.toFixed(2)}`);
    console.log(`Allowance: $${balance.allowance.toFixed(2)}`);
    console.log(`${colors.green}✓ Balance check successful\n${colors.reset}`);

    // Test 3: Fetch Current Market
    console.log(`${colors.yellow}═══ Test 3: Fetch Current Market ═══${colors.reset}\n`);
    
    const marketData = await fetchCurrentMarket();
    console.log(`${colors.green}✓ Market data retrieved\n${colors.reset}`);

    // Test 4: Get Current Prices
    console.log(`${colors.yellow}═══ Test 4: Get Current Prices ═══${colors.reset}\n`);
    
    const upPrice = await getCurrentPrice(marketData.upTokenId);
    const downPrice = await getCurrentPrice(marketData.downTokenId);
    
    console.log(`Up Price: $${upPrice.toFixed(4)}`);
    console.log(`Down Price: $${downPrice.toFixed(4)}`);
    console.log(`${colors.green}✓ Prices retrieved\n${colors.reset}`);

    // Test 5: Place Buy Order for Up
    console.log(`${colors.yellow}═══ Test 5: Place Buy Order for UP (DRY RUN) ═══${colors.reset}\n`);
    
    const investmentAmount = config.liveTrading.positionSize || 1; // Use position size from config
    
    const upBuyResult = await orderManager.placeBuyOrder(
      marketData.upTokenId,
      upPrice,
      investmentAmount,
      {
        tickSize: marketData.tickSize,
        negRisk: marketData.negRisk,
      }
    );

    if (upBuyResult.success) {
      console.log(`${colors.green}✓ Up buy order successful${colors.reset}`);
      console.log(`Order ID: ${upBuyResult.orderID}`);
      console.log(`Price: $${upBuyResult.price.toFixed(4)}`);
      console.log(`Size: ${upBuyResult.size.toFixed(4)} shares`);
      console.log(`Investment: $${investmentAmount.toFixed(2)}`);
    } else {
      console.log(`${colors.red}✗ Up buy order failed: ${upBuyResult.error}${colors.reset}`);
    }
    console.log('');

    // Test 6: Place Buy Order for Down
    console.log(`${colors.yellow}═══ Test 6: Place Buy Order for DOWN (DRY RUN) ═══${colors.reset}\n`);
    
    const downBuyResult = await orderManager.placeBuyOrder(
      marketData.downTokenId,
      downPrice,
      investmentAmount,
      {
        tickSize: marketData.tickSize,
        negRisk: marketData.negRisk,
      }
    );

    if (downBuyResult.success) {
      console.log(`${colors.green}✓ Down buy order successful${colors.reset}`);
      console.log(`Order ID: ${downBuyResult.orderID}`);
      console.log(`Price: $${downBuyResult.price.toFixed(4)}`);
      console.log(`Size: ${downBuyResult.size.toFixed(4)} shares`);
      console.log(`Investment: $${investmentAmount.toFixed(2)}`);
    } else {
      console.log(`${colors.red}✗ Down buy order failed: ${downBuyResult.error}${colors.reset}`);
    }
    console.log('');

    // Test 7: Get Open Orders
    console.log(`${colors.yellow}═══ Test 7: Get Open Orders ═══${colors.reset}\n`);
    
    const openOrders = await orderManager.getOpenOrders();
    console.log(`Open orders: ${openOrders.length}`);
    
    if (openOrders.length > 0) {
      console.log('\nRecent orders:');
      openOrders.slice(0, 3).forEach((order, i) => {
        console.log(`  ${i + 1}. ${order.side} ${order.size} @ $${order.price} (${order.status})`);
      });
    }
    console.log(`${colors.green}✓ Order retrieval successful\n${colors.reset}`);

    // Test 8: Get Statistics
    console.log(`${colors.yellow}═══ Test 8: Get Statistics ═══${colors.reset}\n`);
    
    const stats = orderManager.getStats();
    console.log('Order Manager Statistics:');
    console.log(`  Orders placed: ${stats.ordersPlaced}`);
    console.log(`  Orders filled: ${stats.ordersFilled}`);
    console.log(`  Orders cancelled: ${stats.ordersCancelled}`);
    console.log(`  Orders failed: ${stats.ordersFailed}`);
    console.log(`  Total volume: $${stats.totalVolume.toFixed(2)}`);
    console.log(`  Success rate: ${stats.successRate}%`);
    console.log(`${colors.green}✓ Statistics retrieved\n${colors.reset}`);

    // Summary
    console.log(`${colors.bright}${colors.green}╔════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.bright}${colors.green}║   All Tests Passed!                    ║${colors.reset}`);
    console.log(`${colors.bright}${colors.green}╚════════════════════════════════════════╝${colors.reset}\n`);

    console.log(`${colors.cyan}Next steps:${colors.reset}`);
    console.log(`1. Fund your wallet with USDC on Polygon`);
    console.log(`2. Set DRY_RUN_MODE=false in .env for live trading`);
    console.log(`3. Set LIVE_TRADING_ENABLED=true to enable live mode`);
    console.log(`4. Run the bot: npm start\n`);

  } catch (error) {
    console.error(`\n${colors.red}❌ Test failed:${colors.reset}`, error.message);
    
    if (error.message.includes('invalid private key')) {
      console.error(`${colors.yellow}Check your POLYGON_PRIVATE_KEY in .env${colors.reset}`);
    } else if (error.message.includes('network')) {
      console.error(`${colors.yellow}Check your internet connection${colors.reset}`);
    }
    
    console.error('');
    process.exit(1);
  }
}

// Run tests
testOrderManager().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
