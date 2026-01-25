/**
 * Trading Executor - Abstraction layer for both paper and live trading
 * 
 * This module provides a unified interface for executing trades regardless of mode.
 * Switch between paper trading and live trading by changing the LIVE_TRADING_ENABLED env var.
 */

import config from '../config/index.js';

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
    
    if (!wallet || !wallet.privateKey) {
      throw new Error('Live trading requires a configured wallet with private key');
    }
  }

  async executeBuy(marketSlug, marketTitle, marketEndDate, outcome, price, investmentAmount) {
    try {
      // TODO: Implement actual Polymarket API calls
      // This is a placeholder for the actual implementation
      
      // Steps for live trading:
      // 1. Get token ID for the outcome
      // 2. Check order book liquidity
      // 3. Place limit or market order via Polymarket CLOB API
      // 4. Wait for order fill confirmation
      // 5. Record position in portfolio
      
      throw new Error('Live trading not yet implemented. Please use paper trading mode.');
      
      // Example structure (to be implemented):
      /*
      const order = await this.placeOrder({
        marketSlug,
        outcome,
        side: 'BUY',
        price,
        size: investmentAmount / price,
      });
      
      const position = this.portfolio.openPosition(
        marketSlug,
        marketTitle,
        outcome,
        order.fillPrice,
        order.fillSize * order.fillPrice,
        marketEndDate
      );
      
      return {
        success: true,
        mode: 'live',
        position: position.position,
        orderId: order.id,
        fillPrice: order.fillPrice,
        message: `Live trade executed: ${outcome} @ $${order.fillPrice.toFixed(4)}`
      };
      */
    } catch (error) {
      return {
        success: false,
        mode: 'live',
        error: error.message,
        message: `Live trade failed: ${error.message}`
      };
    }
  }

  async closePositions(marketSlug, winningOutcome) {
    try {
      // TODO: Implement actual position closing
      // This would involve:
      // 1. Getting market resolution from Polymarket
      // 2. Redeeming winning shares
      // 3. Updating portfolio
      
      throw new Error('Live position closing not yet implemented');
      
      // Example structure:
      /*
      const positions = this.portfolio.getOpenPositionsForMarket(marketSlug);
      const results = [];
      
      for (const position of positions) {
        if (position.outcome === winningOutcome) {
          // Redeem winning shares
          const redeemTx = await this.redeemShares(position);
          results.push({
            success: true,
            mode: 'live',
            position: { ...position, won: true },
            txHash: redeemTx.hash
          });
        } else {
          results.push({
            success: true,
            mode: 'live',
            position: { ...position, won: false }
          });
        }
      }
      
      // Update portfolio
      this.portfolio.closeMarketPositions(marketSlug, winningOutcome);
      
      return results;
      */
    } catch (error) {
      throw new Error(`Failed to close live positions: ${error.message}`);
    }
  }

  /**
   * Place an order on Polymarket (to be implemented)
   */
  async placeOrder(orderParams) {
    // TODO: Implement Polymarket CLOB API integration
    throw new Error('Polymarket order placement not yet implemented');
  }

  /**
   * Redeem winning shares (to be implemented)
   */
  async redeemShares(position) {
    // TODO: Implement share redemption via smart contract
    throw new Error('Share redemption not yet implemented');
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
