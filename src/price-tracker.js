import fetch from 'node-fetch';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const MAX_RESOLUTION_WAIT = 10 * 60 * 1000; // 10 minutes max wait
const POLL_INTERVAL = 30000; // Poll every 30 seconds

class PriceTracker {
  constructor() {
    this.resolutionCache = new Map(); // Cache resolved markets
  }

  async fetchMarketData(slug) {
    try {
      const response = await fetch(`${GAMMA_API}/events?slug=${slug}`, {
        timeout: 10000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error(`Error fetching market data: ${error.message}`);
      return null;
    }
  }

  async waitForResolution(slug, maxRetries = 20) {
    console.log(`⏳ Waiting for market resolution...`);
    
    // Check cache first
    if (this.resolutionCache.has(slug)) {
      return this.resolutionCache.get(slug);
    }

    const startTime = Date.now();
    let attempts = 0;

    while (attempts < maxRetries) {
      attempts++;
      
      // Wait before checking (except first attempt)
      if (attempts > 1) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      }

      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_RESOLUTION_WAIT) {
        throw new Error('Timeout waiting for market resolution');
      }

      console.log(`  Attempt ${attempts}/${maxRetries} - Checking market status...`);

      const event = await this.fetchMarketData(slug);
      
      if (!event) {
        console.log(`  ⚠️  Could not fetch market data`);
        continue;
      }

      // Check if market is closed
      if (!event.closed) {
        console.log(`  ⏳ Market not closed yet (closed: ${event.closed})`);
        continue;
      }

      // Market is closed, check for resolution
      if (event.markets && event.markets.length > 0) {
        const market = event.markets[0];
        
        try {
          const outcomes = JSON.parse(market.outcomes);
          const prices = JSON.parse(market.outcomePrices);
          
          console.log(`  Outcomes: ${outcomes.join(', ')}`);
          console.log(`  Prices: ${prices.join(', ')}`);

          // Check if one outcome has price = 1.0 (winner)
          const winningIndex = prices.findIndex(p => {
            const price = parseFloat(p);
            return price >= 0.99; // Close to 1.0 = winner
          });

          if (winningIndex !== -1) {
            const winner = outcomes[winningIndex];
            const result = {
              resolved: true,
              winner: winner,
              outcomes: outcomes,
              prices: prices,
              market: market
            };

            // Cache the result
            this.resolutionCache.set(slug, result);
            
            console.log(`  ✅ Market resolved: ${winner} wins!`);
            return result;
          } else {
            console.log(`  ⏳ Market closed but not yet resolved (prices: ${prices.join(', ')})`);
          }
        } catch (error) {
          console.log(`  ⚠️  Error parsing market data: ${error.message}`);
        }
      }
    }

    throw new Error(`Market not resolved after ${attempts} attempts`);
  }

  async getResolution(slug) {
    // Check cache first
    if (this.resolutionCache.has(slug)) {
      return this.resolutionCache.get(slug);
    }

    // Try to fetch immediately
    const event = await this.fetchMarketData(slug);
    
    if (event && event.closed && event.markets && event.markets.length > 0) {
      const market = event.markets[0];
      
      try {
        const outcomes = JSON.parse(market.outcomes);
        const prices = JSON.parse(market.outcomePrices);

        const winningIndex = prices.findIndex(p => parseFloat(p) >= 0.99);

        if (winningIndex !== -1) {
          const result = {
            resolved: true,
            winner: outcomes[winningIndex],
            outcomes: outcomes,
            prices: prices,
            market: market
          };

          this.resolutionCache.set(slug, result);
          return result;
        }
      } catch (error) {
        // Fall through to waiting
      }
    }

    // Not resolved yet, wait for it
    return await this.waitForResolution(slug);
  }

  clearCache(slug) {
    if (slug) {
      this.resolutionCache.delete(slug);
    } else {
      this.resolutionCache.clear();
    }
  }
}

export default PriceTracker;
