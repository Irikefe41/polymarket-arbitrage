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
  console.log(`${colors.bright}${colors.red}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.red}║   Order Manager Test Suite            ║${colors.reset}`);
  console.log(`${colors.bright}${colors.red}║   ⚠️  LIVE TRADING MODE ⚠️           ║${colors.reset}`);
  console.log(`${colors.bright}${colors.red}╚════════════════════════════════════════╝${colors.reset}\n`);

  // Check if private key is configured
  if (!config.wallet.privateKey) {
    console.error(`${colors.red}❌ Error: POLYGON_PRIVATE_KEY not configured in .env${colors.reset}`);
    console.log(`${colors.yellow}Please add your wallet private key to .env:${colors.reset}`);
    console.log(`${colors.cyan}POLYGON_PRIVATE_KEY=0x...${colors.reset}\n`);
    process.exit(1);
  }

  // Use config value for dryRun, default to true (safe mode)
  // IMPORTANT: Default to DRY RUN to prevent accidental fund usage
  const dryRunMode = config.liveTrading.dryRun !== undefined ? config.liveTrading.dryRun : true;

  if (!dryRunMode) {
    console.log(`${colors.bright}${colors.red}╔════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.bright}${colors.red}║   ⚠️  LIVE TRADING MODE ENABLED ⚠️   ║${colors.reset}`);
    console.log(`${colors.bright}${colors.red}╚════════════════════════════════════════╝${colors.reset}\n`);
    console.log(`${colors.red}⚠️  WARNING: REAL ORDERS WILL BE PLACED!${colors.reset}`);
    console.log(`${colors.red}⚠️  REAL MONEY WILL BE USED!${colors.reset}`);
    console.log(`${colors.red}⚠️  YOUR WALLET BALANCE WILL BE DEDUCTED!${colors.reset}\n`);
    
    // Check current balance first
    const tempOrderManager = new OrderManager(config.wallet.privateKey, {
      dryRun: false,
      verbose: false,
    });
    await tempOrderManager.initialize();
    const currentBalance = await tempOrderManager.getBalance();
    console.log(`${colors.yellow}Current USDC Balance: $${currentBalance.usdc.toFixed(6)}${colors.reset}`);
    console.log(`${colors.yellow}This test will place $5 orders (2 orders = $10 total)${colors.reset}\n`);
    
    console.log(`${colors.yellow}Press Ctrl+C within 10 seconds to cancel...${colors.reset}\n`);
    
    // Give user 10 seconds to cancel (increased from 5)
    await new Promise(resolve => setTimeout(resolve, 10000));
    console.log(`${colors.green}Proceeding with live order placement...\n${colors.reset}`);
  } else {
    console.log(`${colors.yellow}⚠️  DRY RUN MODE - No real orders will be placed${colors.reset}`);
    console.log(`${colors.yellow}   Set DRY_RUN_MODE=false in .env to enable live trading${colors.reset}\n`);
  }

  try {
    // Test 1: Initialize Order Manager
    console.log(`${colors.yellow}═══ Test 1: Initialize Order Manager ═══${colors.reset}\n`);
    
    const orderManager = new OrderManager(config.wallet.privateKey, {
      dryRun: dryRunMode,
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
    const modeLabel = dryRunMode ? 'DRY RUN' : 'LIVE';
    console.log(`${colors.yellow}═══ Test 5: Place Buy Order for UP (${modeLabel}) ═══${colors.reset}\n`);
    
    // Use at least $5 to meet Polymarket's minimum order size (5 shares)
    // If price is low, we need more investment to get 5+ shares
    const minInvestment = 5.0;
    const requestedInvestment = config.liveTrading.positionSize || 1;
    const investmentAmount = Math.max(requestedInvestment, minInvestment);
    
    if (investmentAmount > requestedInvestment) {
      console.log(`${colors.yellow}⚠️  Adjusted investment from $${requestedInvestment} to $${investmentAmount} to meet minimum order size${colors.reset}\n`);
    }
    
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
    console.log(`${colors.yellow}═══ Test 6: Place Buy Order for DOWN (${modeLabel}) ═══${colors.reset}\n`);
    
    // Use same investment amount (already adjusted for minimums)
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
    const upOrderSuccess = upBuyResult.success;
    const downOrderSuccess = downBuyResult.success;
    const allOrdersSuccessful = upOrderSuccess && downOrderSuccess;
    
    if (allOrdersSuccessful) {
      if (dryRunMode) {
        console.log(`${colors.bright}${colors.green}╔════════════════════════════════════════╗${colors.reset}`);
        console.log(`${colors.bright}${colors.green}║   All Tests Passed!                    ║${colors.reset}`);
        console.log(`${colors.bright}${colors.green}╚════════════════════════════════════════╝${colors.reset}\n`);
        console.log(`${colors.yellow}⚠️  NOTE: DRY RUN MODE - No real orders were placed${colors.reset}`);
        console.log(`${colors.yellow}   Your wallet balance did NOT change${colors.reset}\n`);
      } else {
        console.log(`${colors.bright}${colors.green}╔════════════════════════════════════════╗${colors.reset}`);
        console.log(`${colors.bright}${colors.green}║   ✅ LIVE ORDERS PLACED!              ║${colors.reset}`);
        console.log(`${colors.bright}${colors.green}╚════════════════════════════════════════╝${colors.reset}\n`);
        console.log(`${colors.green}✓ Real orders have been placed on Polymarket${colors.reset}`);
        console.log(`${colors.green}✓ Check your wallet balance and open orders${colors.reset}\n`);
      }
    } else {
      console.log(`${colors.bright}${colors.yellow}╔════════════════════════════════════════╗${colors.reset}`);
      console.log(`${colors.bright}${colors.yellow}║   Tests Completed (Some Failed)      ║${colors.reset}`);
      console.log(`${colors.bright}${colors.yellow}╚════════════════════════════════════════╝${colors.reset}\n`);
      
      if (!upOrderSuccess) {
        console.log(`${colors.red}✗ Up order failed: ${upBuyResult.error}${colors.reset}`);
      }
      if (!downOrderSuccess) {
        console.log(`${colors.red}✗ Down order failed: ${downBuyResult.error}${colors.reset}`);
      }
      console.log('');
    }

    console.log(`${colors.cyan}Order Details:${colors.reset}`);
    if (upOrderSuccess) {
      console.log(`  Up Order ID: ${upBuyResult.orderID}`);
      console.log(`  Up Order Status: ${upBuyResult.status}`);
    }
    if (downOrderSuccess) {
      console.log(`  Down Order ID: ${downBuyResult.orderID}`);
      console.log(`  Down Order Status: ${downBuyResult.status}`);
    }
    console.log('');

    if (balance.usdc === 0) {
      console.log(`${colors.yellow}⚠️  Your USDC balance is $0.00${colors.reset}`);
      console.log(`   Fund your wallet with USDC on Polygon`);
      console.log(`   Check balance: https://polygonscan.com/address/${balance.address}\n`);
    }

    if (dryRunMode) {
      console.log(`${colors.cyan}To place real orders:${colors.reset}`);
      console.log(`1. Set DRY_RUN_MODE=false in .env`);
      console.log(`2. Ensure you have USDC balance (minimum $5 recommended)`);
      console.log(`3. Run this test again: npm run test:orders\n`);
    } else {
      if (allOrdersSuccessful) {
        console.log(`${colors.green}✅ Live orders have been placed!${colors.reset}`);
        console.log(`   View orders on Polymarket: https://polymarket.com/portfolio\n`);
      } else {
        console.log(`${colors.red}❌ Orders failed - check errors above${colors.reset}`);
        console.log(`   Ensure you have sufficient USDC balance (minimum $5 per order)`);
        console.log(`   Check Polymarket for any existing orders: https://polymarket.com/portfolio\n`);
      }
    }

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
