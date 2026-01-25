/**
 * Polymarket WebSocket Client (Production)
 * 
 * Real-time price streaming with:
 * - Auto-reconnection with exponential backoff
 * - Price cache integration
 * - Market subscription management
 * - Connection health monitoring
 * - Graceful error handling
 */

import WebSocket from 'ws';
import priceCache from './price-cache.js';

const WS_ENDPOINT = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

class PolymarketWebSocketClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.subscribedTokens = [];
    this.marketInfo = null;
    
    // Reconnection logic
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelays = [1000, 2000, 5000, 10000, 30000]; // ms
    this.reconnectTimer = null;
    
    // Stats
    this.stats = {
      messagesReceived: 0,
      priceUpdates: 0,
      orderbookUpdates: 0,
      tradeMessages: 0,
      priceChangeMessages: 0,
      bookMessages: 0,
      ignoredMessages: 0,
      connectionAttempts: 0,
      lastMessageTime: null,
      connectedAt: null
    };
    
    // Event handlers
    this.onConnectedCallback = null;
    this.onDisconnectedCallback = null;
    this.onErrorCallback = null;
  }

  /**
   * Connect to WebSocket and subscribe to market
   * @param {object} marketInfo - Market info with tokenIds and outcomes
   */
  async connect(marketInfo) {
    if (this.isConnected || this.isConnecting) {
      console.log('WebSocket already connected or connecting');
      return;
    }

    this.isConnecting = true;
    this.marketInfo = marketInfo;
    this.stats.connectionAttempts++;

    try {
      this.ws = new WebSocket(WS_ENDPOINT);

      this.ws.on('open', () => this._handleOpen());
      this.ws.on('message', (data) => this._handleMessage(data));
      this.ws.on('error', (error) => this._handleError(error));
      this.ws.on('close', (code, reason) => this._handleClose(code, reason));

    } catch (error) {
      this.isConnecting = false;
      console.error('WebSocket connection error:', error);
      
      if (this.onErrorCallback) {
        this.onErrorCallback(error);
      }
      
      this._scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket open event
   * @private
   */
  _handleOpen() {
    this.isConnected = true;
    this.isConnecting = false;
    this.reconnectAttempts = 0; // Reset on successful connection
    this.stats.connectedAt = Date.now();

    console.log('✅ WebSocket connected');

    // Subscribe to tokens
    if (this.marketInfo && this.marketInfo.tokenIds) {
      this._subscribe(this.marketInfo.tokenIds);
    }

    if (this.onConnectedCallback) {
      this.onConnectedCallback();
    }
  }

  /**
   * Subscribe to market tokens
   * @private
   */
  _subscribe(tokenIds) {
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      console.error('Invalid token IDs for subscription');
      return;
    }

    const subscription = {
      assets_ids: tokenIds,
      type: 'market'
    };

    this.subscribedTokens = tokenIds;
    this.ws.send(JSON.stringify(subscription));

    console.log(`📡 Subscribed to ${tokenIds.length} tokens via WebSocket`);
  }

  /**
   * Handle WebSocket message
   * @private
   */
  _handleMessage(data) {
    try {
      this.stats.messagesReceived++;
      this.stats.lastMessageTime = Date.now();

      const rawMessage = data.toString();
      
      // Skip non-JSON messages (e.g., "Invalid subscription", status messages)
      if (!rawMessage.startsWith('{') && !rawMessage.startsWith('[')) {
        // Likely a text status message, ignore it
        return;
      }

      const message = JSON.parse(rawMessage);

      // Handle both single message and array of messages
      const messages = Array.isArray(message) ? message : [message];

      for (const msg of messages) {
        this._processMessage(msg);
      }

    } catch (error) {
      // Log parsing errors but don't crash
      if (error.message.includes('JSON')) {
        // JSON parsing error - likely a non-JSON status message
        // Silently ignore to avoid log spam
      } else {
        console.error('Error processing WebSocket message:', error.message);
      }
    }
  }

  /**
   * Process a single WebSocket message
   * @private
   */
  _processMessage(msg) {
    const { event_type } = msg;

    if (!event_type) {
      this.stats.ignoredMessages++;
      return; // Skip messages without event type
    }

    switch (event_type) {
      case 'book':
        this.stats.bookMessages++;
        this._handleOrderBookUpdate(msg);
        break;

      case 'price_change':
        this.stats.priceChangeMessages++;
        this._handlePriceChange(msg);
        break;

      case 'trade':
        this.stats.tradeMessages++;
        this._handleTrade(msg);
        break;

      case 'last_trade_price':
        // Metadata, ignore
        this.stats.ignoredMessages++;
        break;

      default:
        // Unknown event type, ignore
        this.stats.ignoredMessages++;
        break;
    }
  }

  /**
   * Handle orderbook update (best ask = our buy price, top bid = our sell price)
   * @private
   */
  _handleOrderBookUpdate(msg) {
    const { asset_id, asks, bids } = msg;

    if (!asset_id) {
      return;
    }

    // Update full orderbook in cache
    priceCache.updateOrderbook(asset_id, { bids, asks });

    // Extract buy price (best ask)
    if (asks && asks.length > 0) {
      const bestAsk = asks[0];
      const buyPrice = parseFloat(bestAsk.price || bestAsk.p);

      if (!isNaN(buyPrice) && buyPrice >= 0.001 && buyPrice <= 0.999) {
        priceCache.updateBuyPrice(asset_id, buyPrice);
      }
    }

    this.stats.orderbookUpdates++;
  }

  /**
   * Handle price_change event (contains best_ask and best_bid)
   * @private
   */
  _handlePriceChange(msg) {
    const { price_changes } = msg;

    if (!price_changes || !Array.isArray(price_changes)) {
      return;
    }

    // Process each price change in the array
    for (const change of price_changes) {
      const { asset_id, best_ask, best_bid } = change;

      if (!asset_id) {
        continue;
      }

      // Update buy price (best_ask)
      if (best_ask) {
        const buyPrice = parseFloat(best_ask);

        if (!isNaN(buyPrice) && buyPrice >= 0.001 && buyPrice <= 0.999) {
          priceCache.updateBuyPrice(asset_id, buyPrice);
          this.stats.priceUpdates++;
        }
      }

      // Update sell price (best_bid)
      if (best_bid) {
        const sellPrice = parseFloat(best_bid);

        if (!isNaN(sellPrice) && sellPrice >= 0.001 && sellPrice <= 0.999) {
          priceCache.updateSellPrice(asset_id, sellPrice);
        }
      }
    }
  }

  /**
   * Handle trade event (real-time trade execution)
   * @private
   */
  _handleTrade(msg) {
    const { asset_id, price, side } = msg;

    if (!asset_id || !price) {
      return;
    }

    const tradePrice = parseFloat(price);

    if (isNaN(tradePrice) || tradePrice < 0.001 || tradePrice > 0.999) {
      return;
    }

    // Trade price represents actual execution
    // If it's a BUY trade (someone bought), that's the ask price
    // If it's a SELL trade (someone sold), that's the bid price
    if (side === 'BUY') {
      priceCache.updateBuyPrice(asset_id, tradePrice);
      this.stats.priceUpdates++;
    } else if (side === 'SELL') {
      priceCache.updateSellPrice(asset_id, tradePrice);
    }
  }

  /**
   * Handle WebSocket error
   * @private
   */
  _handleError(error) {
    console.error('❌ WebSocket error:', error.message);

    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }
  }

  /**
   * Handle WebSocket close event
   * @private
   */
  _handleClose(code, reason) {
    this.isConnected = false;
    this.isConnecting = false;

    // Check if this was an intentional closure (market transition)
    const isIntentional = code === 1000 && reason === 'Market transition';
    
    if (!isIntentional) {
      console.log(`⚠️  WebSocket disconnected (code: ${code}, reason: ${reason || 'Unknown'})`);

      if (this.onDisconnectedCallback) {
        this.onDisconnectedCallback(code, reason);
      }

      // Try to reconnect (only if not intentional)
      this._scheduleReconnect();
    } else {
      // Intentional close for market transition - don't log or schedule reconnect
      // The updateMarket() method will handle reconnection
    }
  }

  /**
   * Schedule reconnection attempt
   * @private
   */
  _scheduleReconnect() {
    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Check if we've exceeded max attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    // Calculate delay with exponential backoff
    const delayIndex = Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1);
    const delay = this.reconnectDelays[delayIndex];

    this.reconnectAttempts++;

    console.log(`🔄 Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (this.marketInfo) {
        this.connect(this.marketInfo);
      }
    }, delay);
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.subscribedTokens = [];
    
    console.log('WebSocket disconnected');
  }

  /**
   * Update market subscription (when transitioning to new market)
   * Uses clean disconnect/reconnect to avoid stale connection issues
   */
  updateMarket(marketInfo) {
    console.log('🔄 Transitioning WebSocket to new market...');
    
    // Store new market info
    this.marketInfo = marketInfo;
    
    // Clear old prices from cache immediately
    priceCache.clear();
    
    if (!this.isConnected) {
      // If not connected, just connect to new market
      this.connect(marketInfo);
      return;
    }

    // Clean disconnect and reconnect strategy
    // This is more reliable than trying to update subscription mid-connection
    // Polymarket sometimes sends non-JSON status messages that break the parser
    
    // Temporarily disable reconnection logic during intentional disconnect
    const wasReconnecting = this.reconnectTimer !== null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Reset reconnect attempts for clean slate
    this.reconnectAttempts = 0;
    
    // Close current connection
    if (this.ws) {
      this.ws.close(1000, 'Market transition'); // Normal closure
      this.ws = null;
    }
    
    this.isConnected = false;
    this.isConnecting = false;
    this.subscribedTokens = [];
    
    // Wait 100ms for clean closure, then reconnect
    setTimeout(() => {
      console.log('🔄 Reconnecting to new market...');
      this.connect(marketInfo);
    }, 100);
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      connecting: this.isConnecting,
      subscribedTokens: this.subscribedTokens.length,
      reconnectAttempts: this.reconnectAttempts,
      stats: this.stats
    };
  }

  /**
   * Get WebSocket statistics
   */
  getStats() {
    const now = Date.now();
    const uptime = this.stats.connectedAt ? (now - this.stats.connectedAt) / 1000 : 0;
    const timeSinceLastMessage = this.stats.lastMessageTime ? (now - this.stats.lastMessageTime) / 1000 : null;

    return {
      ...this.stats,
      uptime: uptime.toFixed(1),
      messagesPerSecond: uptime > 0 ? (this.stats.messagesReceived / uptime).toFixed(2) : 0,
      timeSinceLastMessage: timeSinceLastMessage ? timeSinceLastMessage.toFixed(1) : 'N/A'
    };
  }

  /**
   * Set event handlers
   */
  onConnected(callback) {
    this.onConnectedCallback = callback;
  }

  onDisconnected(callback) {
    this.onDisconnectedCallback = callback;
  }

  onError(callback) {
    this.onErrorCallback = callback;
  }
}

// Singleton instance
const wsClient = new PolymarketWebSocketClient();

export default wsClient;
