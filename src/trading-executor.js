/**
 * Trading Executor - Abstraction layer for both paper and live trading
 * 
 * This module provides a unified interface for executing trades regardless of mode.
 * Switch between paper trading and live trading by changing the LIVE_TRADING_ENABLED env var.
 */

import config from '../config/index.js';
import OrderManager from './order-manager.js';
import fetch from 'node-fetch';

/**
 * Base Trading Executor Interface
 */
class TradingExecutor {
  constructor(portfolio) {
    this.portfolio = portfolio;
    this.mode = 'paper'; // 'paper' or 'live'
  }

  /**
   * Execute a buy order
   * @param {string} marketSlug - Market identifier
   * @param {string} marketTitle - Market title
   * @param {Date} marketEndDate - Market end date
   * @param {string} outcome - 'Up' or 'Down'
   * @param {number} price - Price per share
   * @param {number} investmentAmount - Amount to invest
   * @returns {Promise<Object>} Trade result
   */
  async executeBuy(marketSlug, marketTitle, marketEndDate, outcome, price, investmentAmount) {
    throw new Error('executeBuy must be implemented by subclass');
  }

  /**
   * Close position(s) for a market
   * @param {string} marketSlug - Market identifier
   * @param {string} winningOutcome - The outcome that won
   * @returns {Promise<Array>} Array of closed positions
   */
  async closePositions(marketSlug, winningOutcome) {
    throw new Error('closePositions must be implemented by subclass');
  }

  /**
   * Get current balance
   * @returns {number} Current balance
   */
  getBalance() {
    return this.portfolio.balance;
  }

  /**
   * Get open positions for a market
   * @param {string} marketSlug - Market identifier
   * @returns {Array} Open positions
   */
  getOpenPositions(marketSlug) {
    return this.portfolio.getOpenPositionsForMarket(marketSlug);
  }

  /**
   * Redeem all redeemable positions (Data-API + fallback). No-op in paper mode.
   * When AUTO_REDEEM_ENABLED=true, the bot calls this periodically.
   * @returns {Promise<{redeemed: number, failed: number}>}
   */
  async redeemRedeemablePositions() {
    return { redeemed: 0, failed: 0 };
  }
}

/**
 * Paper Trading Executor
 * Simulates trades without real money
 */
class PaperTradingExecutor extends TradingExecutor {
  constructor(portfolio) {
    super(portfolio);
    this.mode = 'paper';
  }

  async executeBuy(marketSlug, marketTitle, marketEndDate, outcome, price, investmentAmount) {
    // Simulate paper trade
    const result = this.portfolio.buyShares(
      marketSlug,
      marketTitle,
      outcome,
      price,
      investmentAmount,
      marketEndDate
    );

    if (result.success) {
      return {
        success: true,
        mode: 'paper',
        position: result.position,
        message: `Paper trade executed: ${outcome} @ $${price.toFixed(4)}`
      };
    } else {
      return {
        success: false,
        mode: 'paper',
        error: result.error,
        message: `Paper trade failed: ${result.error}`
      };
    }
  }

  async closePositions(marketSlug, winningOutcome) {
    // Paper trading: close based on predetermined outcome
    const results = this.portfolio.closeMarketPositions(marketSlug, winningOutcome);

    return results.map(result => ({
      ...result,
      mode: 'paper'
    }));
  }
}

/**
 * Live Trading Executor
 * Executes real trades on Polymarket
 */
class LiveTradingExecutor extends TradingExecutor {
  constructor(portfolio, wallet) {
    super(portfolio);
    this.mode = 'live';
    this.wallet = wallet;
    this.orderManager = null;
    this.marketDataCache = new Map(); // Cache market data to avoid repeated API calls

    if (!wallet || !wallet.privateKey) {
      throw new Error('Live trading requires a configured wallet with private key');
    }
  }

  /**
   * Initialize OrderManager (lazy initialization)
   * @private
   */
  async _ensureOrderManager() {
    if (this.orderManager && this.orderManager.isInitialized) {
      return;
    }

    console.log('🔧 Initializing OrderManager for live trading...');

    this.orderManager = new OrderManager(this.wallet.privateKey, {
      rpcUrl: config.wallet.rpcUrl,
      dryRun: config.liveTrading.dryRun,
      verbose: config.liveTrading.verbose
    });

    await this.orderManager.initialize();
  }

  /**
   * Fetch event/market data from Gamma API
   * @param {string} marketSlug - Market slug
   * @returns {object} Event data with markets
   * @private
   */
  async _fetchEventData(marketSlug) {
    // Check cache first
    if (this.marketDataCache.has(marketSlug)) {
      return this.marketDataCache.get(marketSlug);
    }

    try {
      const response = await fetch(`${config.api.gammaUrl}/events?slug=${marketSlug}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      const event = data[0];

      if (!event) {
        throw new Error(`No event found for slug: ${marketSlug}`);
      }

      // Cache for 5 minutes
      this.marketDataCache.set(marketSlug, event);
      setTimeout(() => this.marketDataCache.delete(marketSlug), 5 * 60 * 1000);

      return event;
    } catch (error) {
      throw new Error(`Failed to fetch event data: ${error.message}`);
    }
  }

  /**
   * Get token ID for a specific outcome
   * @param {string} marketSlug - Market slug
   * @param {string} outcome - Outcome name (e.g., 'Up' or 'Down')
   * @returns {string} Token ID
   * @private
   */
  async _getTokenIdForOutcome(marketSlug, outcome) {
    try {
      // Fetch event data
      const event = await this._fetchEventData(marketSlug);

      if (!event.markets || event.markets.length === 0) {
        throw new Error('No markets found for this event');
      }

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

      // Find index of outcome (case-insensitive)
      const outcomeIndex = outcomes.findIndex(
        o => o.toLowerCase() === outcome.toLowerCase()
      );

      if (outcomeIndex === -1) {
        throw new Error(`Outcome "${outcome}" not found in market. Available: ${outcomes.join(', ')}`);
      }

      if (!clobTokenIds[outcomeIndex]) {
        throw new Error(`No token ID found for outcome "${outcome}"`);
      }

      return clobTokenIds[outcomeIndex];
    } catch (error) {
      throw new Error(`Failed to get token ID: ${error.message}`);
    }
  }

  /**
   * Execute a buy order (live trading)
   */
  async executeBuy(marketSlug, marketTitle, marketEndDate, outcome, price, investmentAmount) {
    try {
      // Ensure OrderManager is initialized
      await this._ensureOrderManager();

      console.log(`\n🔴 LIVE TRADING: Executing BUY order`);
      console.log(`   Outcome: ${outcome}`);
      console.log(`   Price: $${price.toFixed(4)}`);
      console.log(`   Amount: $${investmentAmount.toFixed(2)}`);

      // Get token ID for this outcome and market info (tickSize, negRisk)
      console.log(`   Fetching market details...`);
      const event = await this._fetchEventData(marketSlug);
      const market = event.markets[0];

      const tokenId = await this._getTokenIdForOutcome(marketSlug, outcome);
      console.log(`   Token ID: ${tokenId}`);

      // Extract market metadata from Gamma data
      const marketInfo = {
        tickSize: market.minimumTickSize || '0.01',
        negRisk: market.negRisk || false
      };
      console.log(`   Tick Size: ${marketInfo.tickSize}, Neg Risk: ${marketInfo.negRisk}`);

      // Place order via OrderManager
      console.log(`   Placing order on CLOB...`);
      const orderResult = await this.orderManager.placeBuyOrder(
        tokenId,
        price,
        investmentAmount,
        marketInfo
      );

      if (!orderResult.success) {
        return {
          success: false,
          mode: 'live',
          error: orderResult.error,
          message: `Live trade failed: ${orderResult.error}`
        };
      }

      // Record position in portfolio (optimistic - assumes order will fill)
      // Use actualInvestment from order result if available (may be adjusted for Polymarket minimums)
      const actualAmountSpent = orderResult.actualInvestment || investmentAmount;
      const result = this.portfolio.buyShares(
        marketSlug,
        marketTitle,
        outcome,
        price,
        actualAmountSpent, // Use actual amount spent on-chain
        marketEndDate
      );

      if (!result.success) {
        // Order placed but portfolio update failed
        console.warn(`⚠️  Order placed but portfolio update failed: ${result.error}`);
        return {
          success: true,
          mode: 'live',
          orderID: orderResult.orderID,
          warning: `Order placed but portfolio tracking failed: ${result.error}`,
          message: `Live trade executed but tracking error: ${result.error}`
        };
      }

      return {
        success: true,
        mode: 'live',
        position: result.position,
        orderID: orderResult.orderID,
        orderStatus: orderResult.status,
        tokenId: tokenId,
        fillPrice: price, // Actual fill price would come from order status
        message: `Live trade executed: ${outcome} @ $${price.toFixed(4)} (Order ID: ${orderResult.orderID})`
      };

    } catch (error) {
      console.error(`❌ Live trading error: ${error.message}`);

      return {
        success: false,
        mode: 'live',
        error: error.message,
        message: `Live trade failed: ${error.message}`
      };
    }
  }

  /**
   * Close positions for a market
   * 
   * NOTE: Polymarket automatically redeems winning shares to USDC when markets resolve.
   * This function primarily updates our internal portfolio state.
   * 
   * For manual redemption, you would need to call the CTF Exchange contract directly.
   */
  async closePositions(marketSlug, winningOutcome) {
    try {
      console.log(`\n🔴 LIVE TRADING: Closing positions`);
      console.log(`   Market: ${marketSlug}`);
      console.log(`   Winner: ${winningOutcome}`);

      const positions = this.portfolio.getOpenPositionsForMarket(marketSlug);

      if (positions.length === 0) {
        console.log(`   No open positions to close`);
        return [];
      }

      console.log(`   Found ${positions.length} position(s) to close`);

      // Update portfolio state
      // Polymarket automatically redeems winning shares, so we just track the result
      const results = this.portfolio.closeMarketPositions(marketSlug, winningOutcome);

      // Log results
      for (const result of results) {
        if (result.success) {
          const pos = result.position;
          console.log(`   ${pos.outcome}: ${pos.won ? '✅ WON' : '❌ LOST'} (P&L: $${pos.profitLoss.toFixed(2)})`);
        }
      }

      return results.map(result => ({
        ...result,
        mode: 'live',
        note: 'Polymarket auto-redeems winning shares'
      }));

    } catch (error) {
      console.error(`❌ Failed to close live positions: ${error.message}`);
      throw new Error(`Failed to close live positions: ${error.message}`);
    }
  }

  /**
   * Redeem all redeemable positions (Data-API first, then trade-history fallback).
   * Called automatically when AUTO_REDEEM_ENABLED=true.
   * @returns {Promise<{redeemed: number, failed: number}>}
   */
  async redeemRedeemablePositions() {
    await this._ensureOrderManager();
    if (!this.orderManager) return { redeemed: 0, failed: 0 };
    return this.orderManager.redeemRedeemablePositions();
  }
}

/**
 * Factory function to create the appropriate executor based on config
 */
export function createTradingExecutor(portfolio) {
  const isLiveTrading = config.wallet.liveTradingEnabled;

  if (isLiveTrading) {
    console.log('🔴 Initializing LIVE TRADING mode');
    console.log('⚠️  Real money will be used!');

    // Validate wallet configuration
    if (!config.wallet.privateKey) {
      throw new Error('WALLET_PRIVATE_KEY is required for live trading');
    }

    if (!config.wallet.apiKey) {
      console.warn('⚠️  Warning: POLYMARKET_API_KEY not set. Some features may be limited.');
    }

    return new LiveTradingExecutor(portfolio, config.wallet);
  } else {
    console.log('📝 Running in PAPER TRADING mode (simulated trades)');
    return new PaperTradingExecutor(portfolio);
  }
}

export { TradingExecutor, PaperTradingExecutor, LiveTradingExecutor };
