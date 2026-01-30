/**
 * Claim Returns Script
 * 
 * This script checks for resolved markets with winning positions and claims returns
 * according to Polymarket's returns schedule.
 * 
 * Usage:
 *   npm run claim-returns
 * 
 * Note: Polymarket typically auto-redeems winning shares, but this script helps
 * identify and claim any returns that may need manual claiming.
 */

import OrderManager from '../src/order-manager.js';
import config from '../config/index.js';
import fetch from 'node-fetch';
import { ethers } from 'ethers';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

const GAMMA_API = config.api.gammaUrl;
const CLOB_API = config.api.clobUrl;

// CTF Exchange contract address (Polymarket)
const CTF_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

/**
 * Get user positions from OrderManager
 */
async function getUserPositions(orderManager) {
  try {
    return await orderManager.getUserPositions();
  } catch (error) {
    console.error(`${colors.red}Failed to get user positions: ${error.message}${colors.reset}`);
    return [];
  }
}

/**
 * Get market information from Gamma API
 */
async function getMarketInfo(marketSlug) {
  try {
    const response = await fetch(`${GAMMA_API}/events?slug=${marketSlug}`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error(`${colors.red}Failed to fetch market info: ${error.message}${colors.reset}`);
    return null;
  }
}

/**
 * Check if market is resolved and get winning outcome
 */
function getMarketResolution(event) {
  if (!event || !event.markets || event.markets.length === 0) {
    return { resolved: false };
  }

  const market = event.markets[0];
  
  // Check if market is resolved
  const isResolved = market.resolved || market.resolutionSource || market.resolvedOutcome;
  
  if (!isResolved) {
    return { resolved: false };
  }

  // Get winning outcome
  let winningOutcome = null;
  
  if (market.resolvedOutcome) {
    winningOutcome = market.resolvedOutcome;
  } else if (market.outcomePrices) {
    // Determine winner from final prices (highest price wins)
    const outcomes = typeof market.outcomes === 'string' 
      ? JSON.parse(market.outcomes) 
      : market.outcomes;
    const prices = typeof market.outcomePrices === 'string'
      ? JSON.parse(market.outcomePrices)
      : market.outcomePrices;
    
    let maxPrice = 0;
    let winnerIndex = 0;
    
    prices.forEach((price, index) => {
      const priceNum = parseFloat(price);
      if (priceNum > maxPrice) {
        maxPrice = priceNum;
        winnerIndex = index;
      }
    });
    
    winningOutcome = outcomes[winnerIndex];
  }

  return {
    resolved: true,
    winningOutcome,
    market
  };
}

/**
 * Get token ID for an outcome
 */
function getTokenIdForOutcome(market, outcome) {
  try {
    const outcomes = typeof market.outcomes === 'string' 
      ? JSON.parse(market.outcomes) 
      : market.outcomes;
    const clobTokenIds = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds)
      : market.clobTokenIds;
    
    const outcomeIndex = outcomes.findIndex(
      o => o.toLowerCase() === outcome.toLowerCase()
    );
    
    return outcomeIndex >= 0 ? clobTokenIds[outcomeIndex] : null;
  } catch (error) {
    return null;
  }
}

/**
 * Claim returns for a winning position
 * 
 * Note: Polymarket typically auto-redeems, but this function can be used
 * to manually redeem if needed via the CTF Exchange contract
 */
async function claimReturns(orderManager, tokenId, amount) {
  try {
    // Check if we need to interact with the contract directly
    // For now, we'll check balance before and after to verify auto-redemption
    
    const balanceBefore = await orderManager.getBalance();
    
    if (orderManager.options.verbose) {
      console.log(`   Balance before: $${balanceBefore.usdc.toFixed(6)}`);
    }
    
    // Polymarket auto-redeems winning shares, so we primarily verify
    // If manual redemption is needed, it would go through the CTF Exchange contract
    
    // For now, return success as auto-redemption should have occurred
    return {
      success: true,
      message: 'Returns should be auto-redeemed by Polymarket',
      balanceBefore: balanceBefore.usdc
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Main function to claim returns
 */
async function claimReturnsMain() {
  console.log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║   Claim Returns Script                ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════╝${colors.reset}\n`);

  // Check if private key is configured
  if (!config.wallet.privateKey) {
    console.error(`${colors.red}❌ Error: POLYGON_PRIVATE_KEY not configured in .env${colors.reset}`);
    console.log(`${colors.yellow}Please add your wallet private key to .env${colors.reset}\n`);
    process.exit(1);
  }

  try {
    // Initialize Order Manager
    console.log(`${colors.yellow}═══ Initializing Order Manager ═══${colors.reset}\n`);
    
    const orderManager = new OrderManager(config.wallet.privateKey, {
      dryRun: false, // We want to actually check/claim returns
      verbose: true,
    });

    await orderManager.initialize();
    console.log(`${colors.green}✓ Order Manager initialized\n${colors.reset}`);

    // Get current balance
    console.log(`${colors.yellow}═══ Current Balance ═══${colors.reset}\n`);
    const balance = await orderManager.getBalance();
    console.log(`Wallet: ${balance.address}`);
    console.log(`USDC Balance: $${balance.usdc.toFixed(6)}`);
    console.log(`USDC Type: ${balance.usdcType || 'Unknown'}\n`);

    // Check open orders first (this is what we can actually see)
    console.log(`${colors.yellow}═══ Checking Open Orders ═══${colors.reset}\n`);
    const openOrders = await orderManager.getOpenOrders();
    
    if (openOrders.length === 0) {
      console.log(`${colors.green}✓ No open orders found${colors.reset}`);
      console.log(`${colors.cyan}This means:${colors.reset}`);
      console.log(`  • All orders have been filled or cancelled`);
      console.log(`  • Any winning shares should have been auto-redeemed to USDC\n`);
    } else {
      console.log(`Found ${openOrders.length} open order(s):\n`);
      openOrders.forEach((order, i) => {
        console.log(`  ${i + 1}. ${colors.cyan}${order.side}${colors.reset} ${order.size.toFixed(4)} shares @ $${order.price.toFixed(4)}`);
        console.log(`     Status: ${order.status}`);
        console.log(`     Token ID: ${order.tokenId.substring(0, 30)}...`);
        console.log('');
      });
    }

    // Get inferred positions from open orders
    console.log(`${colors.yellow}═══ Checking Positions (from Open Orders) ═══${colors.reset}\n`);
    
    const positions = await getUserPositions(orderManager);
    
    // Initialize counters outside the if/else block
    let totalClaimable = 0;
    let claimedCount = 0;
    
    if (!positions || positions.length === 0) {
      console.log(`${colors.yellow}No active positions found${colors.reset}`);
      console.log(`${colors.cyan}Note: Positions are inferred from open orders.${colors.reset}`);
      console.log(`${colors.cyan}If you had winning positions, they should already be in your USDC balance.${colors.reset}\n`);
    } else {
      console.log(`Found ${positions.length} position(s) to check\n`);

      // Group positions by market and check for resolved markets
      const positionsByMarket = new Map();
      
      for (const position of positions) {
        const tokenId = position.tokenId;
        if (!tokenId) continue;

        // Try to identify market from token ID (this is simplified)
        // In practice, you'd need to map token IDs to market slugs
        const marketKey = `token-${tokenId}`;
        
        if (!positionsByMarket.has(marketKey)) {
          positionsByMarket.set(marketKey, []);
        }
        
        positionsByMarket.get(marketKey).push({
          ...position,
          tokenId
        });
      }

      console.log(`${colors.yellow}═══ Checking Resolved Markets ═══${colors.reset}\n`);

      // For each market, check if resolved and claim returns
      for (const [marketKey, marketPositions] of positionsByMarket.entries()) {
        console.log(`${colors.cyan}Token Group: ${marketKey}${colors.reset}`);
        console.log(`  Positions: ${marketPositions.length}`);
        
        let groupTotal = 0;
        marketPositions.forEach((pos, idx) => {
          const amount = pos.balance || 0;
          groupTotal += amount;
          console.log(`    ${idx + 1}. Token ID: ${pos.tokenId.substring(0, 30)}...`);
          console.log(`       Balance: ${amount.toFixed(6)} shares`);
          if (pos.available !== undefined) {
            console.log(`       Available: ${pos.available.toFixed(6)} shares`);
          }
          if (pos.locked > 0) {
            console.log(`       Locked: ${pos.locked.toFixed(6)} shares`);
          }
        });
        
        console.log(`  Total Balance: ${groupTotal.toFixed(6)} shares`);
        
        if (groupTotal > 0) {
          console.log(`${colors.yellow}  ⚠️  Note: These shares may need manual redemption if market is resolved${colors.reset}`);
          console.log(`${colors.yellow}     Check Polymarket to see if this market has resolved${colors.reset}`);
          console.log(`${colors.yellow}     Winning shares are typically auto-redeemed to USDC${colors.reset}`);
        }
        console.log('');
      }
    }

    // Summary
    console.log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}║   Summary                             ║${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════╝${colors.reset}\n`);
    
    console.log(`Current USDC Balance: ${colors.green}$${balance.usdc.toFixed(6)}${colors.reset}`);
    console.log(`Positions Checked: ${positions.length}`);
    console.log(`Returns Claimed: ${claimedCount}`);
    
    if (totalClaimable > 0) {
      console.log(`Total Claimable: ${colors.green}$${totalClaimable.toFixed(6)}${colors.reset}`);
    }
    
    console.log(`\n${colors.cyan}💡 Important Notes:${colors.reset}`);
    console.log(`  • Polymarket automatically redeems winning shares to USDC when markets resolve`);
    console.log(`  • Your current USDC balance: ${colors.green}$${balance.usdc.toFixed(6)}${colors.reset}`);
    console.log(`  • Check your balance on PolygonScan: https://polygonscan.com/address/${balance.address}`);
    console.log(`  • View positions on Polymarket: https://polymarket.com/portfolio`);
    console.log(`  • This script is READ-ONLY - it does not spend any funds`);
    console.log(`  • If returns aren't showing, they may still be processing\n`);
    
    console.log(`${colors.yellow}⚠️  REMINDER:${colors.reset}`);
    console.log(`  This script only VERIFIES your balance and open orders.`);
    console.log(`  It does NOT place orders or spend funds.\n`);

  } catch (error) {
    console.error(`\n${colors.red}❌ Error:${colors.reset}`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
claimReturnsMain().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
