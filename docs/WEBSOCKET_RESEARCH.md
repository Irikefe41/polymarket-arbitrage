# 🔌 Phase 3A: Polymarket WebSocket Research

**Date:** January 25, 2026  
**Status:** ✅ RESEARCH COMPLETE  
**Next Phase:** 3B - Build Standalone Client

---

## 📊 Key Findings

### **WebSocket Endpoint**

```
wss://ws-subscriptions-clob.polymarket.com/ws/market
```

✅ **No Authentication Required** for market data (public access)

---

## 🔧 Connection & Subscription

### **1. Connect**
```javascript
const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
```

### **2. Subscribe to Markets**
```javascript
ws.onopen = () => {
  const subscription = {
    assets_ids: ['token-id-1', 'token-id-2'],  // Our clobTokenIds!
    type: 'market'
  };
  ws.send(JSON.stringify(subscription));
};
```

**Notes:**
- `assets_ids` = Our `clobTokenIds` from market data
- Max **500 instruments** per connection (we only need 2)
- Can subscribe to multiple tokens at once
- **No unsubscribe** - must disconnect to stop receiving data

---

## 📥 Message Format

### **Event Types**

The WebSocket sends different event types:

**1. Order Book Updates (`event_type: 'book'`)**
```javascript
{
  event_type: 'book',
  asset_id: 'token-id',
  bids: [
    { price: '0.45', size: '100' },
    { price: '0.44', size: '50' },
    // ... more levels
  ],
  asks: [
    { price: '0.46', size: '80' },
    { price: '0.47', size: '120' },
    // ... more levels
  ],
  timestamp: 1234567890
}
```

**2. Price Change Updates (`event_type: 'price_change'`)**
```javascript
{
  event_type: 'price_change',
  asset_id: 'token-id',
  price: '0.4500',
  timestamp: 1234567890
}
```

**3. Trade Updates (if available)**
```javascript
{
  event_type: 'trade',
  asset_id: 'token-id',
  price: '0.4500',
  size: '100',
  side: 'buy' | 'sell',
  timestamp: 1234567890
}
```

---

## 🎯 What We Need

For our bot, we need **buy prices** (best ask) for both Up and Down tokens:

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.event_type === 'book') {
    // Best ask = lowest price someone is selling at = our buy price
    const bestAsk = data.asks?.[0];
    
    if (bestAsk) {
      const buyPrice = parseFloat(bestAsk.price);
      const tokenId = data.asset_id;
      
      // Update our price cache
      updatePriceForToken(tokenId, buyPrice);
    }
  }
};
```

---

## 🔄 Reconnection Strategy

**WebSocket can disconnect for many reasons:**
- Network issues
- Server restarts
- Idle timeout
- Too many connections

**Must implement:**
- Auto-reconnect with exponential backoff
- Re-subscribe after reconnection
- Fallback to HTTP polling if WebSocket unavailable

```javascript
const reconnectDelays = [1000, 2000, 5000, 10000, 30000]; // ms
let reconnectAttempt = 0;

function reconnect() {
  const delay = reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)];
  
  console.log(`Reconnecting in ${delay}ms...`);
  
  setTimeout(() => {
    reconnectAttempt++;
    connect(); // Try to reconnect
  }, delay);
}

ws.onclose = (event) => {
  console.warn('WebSocket disconnected:', event.reason);
  reconnect();
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
  // Will trigger onclose
};
```

---

## 📊 Comparison Plan: WebSocket vs HTTP

### **Current (HTTP Polling):**
```
Every 2-5 seconds:
  GET /price?token_id=UP&side=buy    → 245ms
  GET /price?token_id=DOWN&side=buy  → 245ms
  Total: ~490ms latency
```

### **With WebSocket:**
```
Continuous stream:
  [server pushes update] → 10-50ms
  No polling needed
  Instant price updates
```

### **Expected Improvements:**
| Metric | HTTP | WebSocket | Improvement |
|--------|------|-----------|-------------|
| **Latency** | 245ms | 10-50ms | **5-25x faster** |
| **Update Frequency** | 2-5s | Real-time | **40-100x more frequent** |
| **API Calls** | 1,440/hour | 0 | **100% reduction** |
| **Reaction Time** | 2-5s delay | <100ms | **Critical for live trading** |

---

## ⚠️ Potential Issues & Mitigation

### **Issue 1: Message Rate**
**Problem:** WebSocket might send too many updates (every orderbook change)

**Mitigation:**
- Throttle price updates (only update if >$0.001 change)
- Use latest price, ignore intermediate updates
- Cache prices in memory

### **Issue 2: Stale Data**
**Problem:** WebSocket disconnects, prices become stale

**Mitigation:**
- Track last update timestamp
- If >5 seconds old, fallback to HTTP
- Alert when falling back

### **Issue 3: Different Prices**
**Problem:** WebSocket prices might differ from HTTP prices

**Mitigation:**
- Compare both in dual-mode
- Log discrepancies
- Use HTTP as source of truth initially

### **Issue 4: Connection Stability**
**Problem:** WebSocket might be less reliable than HTTP

**Mitigation:**
- Auto-reconnection with backoff
- Keep HTTP polling as permanent backup
- Seamless failover

---

## ✅ Phase 3B Readiness Checklist

Before building the WebSocket client:

- ✅ **Endpoint confirmed:** `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- ✅ **Auth not required:** Public market data
- ✅ **Subscription format known:** `{ assets_ids: [], type: 'market' }`
- ✅ **Message format understood:** `event_type`, `bids`, `asks`
- ✅ **Reconnection strategy defined:** Exponential backoff
- ✅ **Fallback plan ready:** HTTP polling as backup
- ✅ **Testing approach clear:** Standalone test first

**Ready to proceed to Phase 3B!** ✅

---

## 📝 Implementation Notes

### **For our bot specifically:**

1. **We need 2 token subscriptions per market:**
   - Up token ID
   - Down token ID

2. **Extract buy price from orderbook:**
   ```javascript
   const buyPrice = parseFloat(data.asks[0].price); // Best ask = our buy price
   ```

3. **Update frequency:**
   - WebSocket: Real-time (every change)
   - Our strategy: Every 2-5 seconds (current polling)
   - **Solution:** Cache WebSocket prices, read from cache when strategy evaluates

4. **Price staleness check:**
   ```javascript
   if (Date.now() - lastPriceUpdate > 5000) {
     console.warn('⚠️ WebSocket prices stale, falling back to HTTP');
     return await fetchPricesViaHTTP();
   }
   ```

---

## 🎯 Next Steps: Phase 3B

**Create two new files (no bot changes):**

1. **`src/websocket-client.js`**
   - WebSocket connection manager
   - Subscription handling
   - Auto-reconnection
   - Price caching
   - Event emitter for price updates

2. **`src/price-cache.js`**
   - In-memory price storage
   - Timestamp tracking
   - Staleness detection
   - Fallback coordination

3. **`test/test-websocket-standalone.js`**
   - Standalone test script
   - Connect to WebSocket
   - Subscribe to test tokens
   - Log price updates
   - Test reconnection
   - Run for 30+ minutes

**Test criteria before Phase 3C:**
- ✅ Successful connection
- ✅ Receives price updates
- ✅ Reconnects after disconnect
- ✅ Stable for 30+ minutes
- ✅ Prices match HTTP API (spot check)

---

## 🔬 Test Plan

### **Manual Testing (Phase 3B):**
```bash
# Run standalone WebSocket test
node test/test-websocket-standalone.js

# Watch for:
# - Connection established
# - Price updates streaming
# - Reconnection after manual disconnect
# - Price accuracy (compare with Polymarket website)
```

### **Integration Testing (Phase 3C):**
```bash
# Run bot in dual-mode
npm start

# WebSocket runs alongside polling
# Compare prices in logs
# Verify strategy uses correct prices
# Monitor for discrepancies
```

---

## 📚 References

- **Polymarket WebSocket Docs:** https://docs.polymarket.com/developers/CLOB/websocket/
- **Market Channel:** https://docs.polymarket.com/developers/CLOB/websocket/market-channel
- **WSS Quickstart:** https://docs.polymarket.com/quickstart/websocket/WSS-Quickstart

---

**Status: Ready for Phase 3B - Build Standalone WebSocket Client** 🚀
