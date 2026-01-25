/**
 * Price Cache
 * 
 * Fast in-memory storage for real-time WebSocket prices
 * - Sub-millisecond read/write performance
 * - Staleness detection for fallback logic
 * - Thread-safe (single-threaded Node.js)
 */

class PriceCache {
  constructor(staleThreshold = 5000) {
    this.prices = new Map(); // tokenId -> { buyPrice, sellPrice, timestamp }
    this.orderbooks = new Map(); // tokenId -> { bids, asks, timestamp }
    this.staleThreshold = staleThreshold; // ms
    this.stats = {
      updates: 0,
      reads: 0,
      staleChecks: 0,
      orderbookUpdates: 0
    };
  }

  /**
   * Update buy price for a token (called by WebSocket)
   * @param {string} tokenId - Polymarket token ID
   * @param {number} buyPrice - Buy price as decimal (0.01 to 0.99)
   */
  updateBuyPrice(tokenId, buyPrice) {
    if (!tokenId || typeof buyPrice !== 'number') {
      return false;
    }

    // Validate price range
    if (buyPrice < 0.001 || buyPrice > 0.999 || !isFinite(buyPrice)) {
      return false;
    }

    const existing = this.prices.get(tokenId) || {};
    this.prices.set(tokenId, {
      ...existing,
      buyPrice,
      timestamp: Date.now()
    });

    this.stats.updates++;
    return true;
  }

  /**
   * Update sell price for a token (derived from orderbook bids)
   * @param {string} tokenId - Polymarket token ID
   * @param {number} sellPrice - Sell price as decimal (0.01 to 0.99)
   */
  updateSellPrice(tokenId, sellPrice) {
    if (!tokenId || typeof sellPrice !== 'number') {
      return false;
    }

    // Validate price range
    if (sellPrice < 0.001 || sellPrice > 0.999 || !isFinite(sellPrice)) {
      return false;
    }

    const existing = this.prices.get(tokenId) || {};
    this.prices.set(tokenId, {
      ...existing,
      sellPrice,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Update orderbook for a token (called by WebSocket)
   * @param {string} tokenId - Polymarket token ID
   * @param {object} orderbook - { bids: [], asks: [] }
   */
  updateOrderbook(tokenId, orderbook) {
    if (!tokenId || !orderbook) {
      return false;
    }

    this.orderbooks.set(tokenId, {
      bids: orderbook.bids || [],
      asks: orderbook.asks || [],
      timestamp: Date.now()
    });

    this.stats.orderbookUpdates++;
    
    // Extract sell price from top bid
    if (orderbook.bids && orderbook.bids.length > 0) {
      const topBid = orderbook.bids[0];
      const sellPrice = parseFloat(topBid.price || topBid.p);
      
      if (!isNaN(sellPrice)) {
        this.updateSellPrice(tokenId, sellPrice);
      }
    }

    return true;
  }

  /**
   * Get cached prices for a token (called by strategy)
   * @param {string} tokenId - Polymarket token ID
   * @returns {{ buyPrice: number, sellPrice: number, timestamp: number, age: number } | null}
   */
  get(tokenId) {
    this.stats.reads++;
    
    const data = this.prices.get(tokenId);
    if (!data) {
      return null;
    }

    return {
      buyPrice: data.buyPrice,
      sellPrice: data.sellPrice,
      timestamp: data.timestamp,
      age: Date.now() - data.timestamp
    };
  }

  /**
   * Get cached orderbook for a token
   * @param {string} tokenId - Polymarket token ID
   * @returns {{ bids: [], asks: [], timestamp: number, age: number } | null}
   */
  getOrderbook(tokenId) {
    const data = this.orderbooks.get(tokenId);
    if (!data) {
      return null;
    }

    return {
      bids: data.bids,
      asks: data.asks,
      timestamp: data.timestamp,
      age: Date.now() - data.timestamp
    };
  }

  /**
   * Check if cached price is stale
   * @param {string} tokenId - Polymarket token ID
   * @returns {boolean} - True if stale or missing
   */
  isStale(tokenId) {
    this.stats.staleChecks++;
    
    const data = this.prices.get(tokenId);
    if (!data) {
      return true;
    }

    return (Date.now() - data.timestamp) > this.staleThreshold;
  }

  /**
   * Check if any cached prices are stale
   * @returns {boolean}
   */
  hasStaleData() {
    if (this.prices.size === 0) {
      return true;
    }

    for (const [tokenId] of this.prices) {
      if (this.isStale(tokenId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all cached prices
   * @returns {Map<string, { price: number, timestamp: number }>}
   */
  getAll() {
    return new Map(this.prices);
  }

  /**
   * Clear cache for specific token or all
   * @param {string} [tokenId] - Optional token ID to clear
   */
  clear(tokenId) {
    if (tokenId) {
      this.prices.delete(tokenId);
      this.orderbooks.delete(tokenId);
    } else {
      this.prices.clear();
      this.orderbooks.clear();
    }
  }

  /**
   * Get cache statistics
   * @returns {object}
   */
  getStats() {
    return {
      ...this.stats,
      cachedTokens: this.prices.size,
      avgAge: this._getAverageAge()
    };
  }

  /**
   * Calculate average age of cached prices
   * @private
   */
  _getAverageAge() {
    if (this.prices.size === 0) {
      return 0;
    }

    const now = Date.now();
    let totalAge = 0;

    for (const data of this.prices.values()) {
      totalAge += (now - data.timestamp);
    }

    return Math.round(totalAge / this.prices.size);
  }
}

// Singleton instance
const priceCache = new PriceCache();

export default priceCache;
