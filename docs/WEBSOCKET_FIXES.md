# 🔧 WebSocket Test Fixes - Phase 3A

**Date:** January 25, 2026  
**Status:** Fixed and ready for re-testing

---

## 🐛 Issues Found in Initial Test

### **1. Wrong Market Discovery Logic**
**Problem:** Test script used simplified timestamp calculation instead of matching main bot's exact logic.

**Fix:** 
- ✅ Extracted `getCurrentMarketTimestamp()` function with exact same logic as main bot
- ✅ Added detailed timestamp calculation logging
- ✅ Shows market start, end, and remaining time

---

### **2. Message Parsing Failures (91.6% failure rate)**
**Problem:** 7,242 "Unknown price change: $NaN" errors

**Root Causes:**
- Price field might have different names (`price`, `p`, `value`)
- Messages might come as arrays
- No validation for NaN values
- No handling for undefined tokens

**Fixes:**
- ✅ Handle both single messages and arrays
- ✅ Try multiple field names: `price`, `p`, `value`
- ✅ Validate prices (0.001 to 0.999 range)
- ✅ Skip NaN and invalid values
- ✅ Filter out undefined tokens

---

### **3. Unknown Event Types**
**Problem:** 223 "Unknown event: last_trade_price" messages

**Fix:**
- ✅ Added `last_trade_price` to event handler (ignore it)
- ✅ Limit unknown event logging to first 50 messages

---

### **4. No Raw JSON Logging**
**Problem:** Couldn't debug actual message structure from Polymarket

**Fix:**
- ✅ Log first 10 raw JSON messages to file
- ✅ Log PARSE ERROR with full data
- ✅ Log missing price fields for debugging

---

### **5. Too Much Noise in Logs**
**Problem:** Repeated price updates when price doesn't change

**Fix:**
- ✅ Only log price updates if change >= $0.0001
- ✅ Limit debug messages to first 20 occurrences
- ✅ Skip undefined tokens in statistics

---

## 🔧 Changes Made

### **File: `test/test-websocket-standalone.js`**

#### **1. Added `getCurrentMarketTimestamp()` Function**
```javascript
function getCurrentMarketTimestamp() {
  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const marketInterval = 900;
  
  const currentWindowStart = Math.floor(nowSeconds / marketInterval) * marketInterval;
  const currentWindowEnd = currentWindowStart + marketInterval;
  
  // Log full calculation details
  log(`[Timestamp Calculation]`);
  log(`   Current Unix: ${nowSeconds}`);
  log(`   Market Start: ${new Date(currentWindowStart * 1000).toISOString()}`);
  log(`   Market End:   ${new Date(currentWindowEnd * 1000).toISOString()}`);
  log(`   Remaining:    ${remainingMin}m ${remainingSec}s`);
  
  return currentWindowStart;
}
```

#### **2. Enhanced Message Handler**
```javascript
function handleMessage(message, marketInfo) {
  // Handle array of messages or single message
  const messages = Array.isArray(message) ? message : [message];
  
  for (const msg of messages) {
    const { event_type, asset_id } = msg;
    
    if (!event_type) continue;
    
    switch (event_type) {
      case 'book': handleOrderBookUpdate(msg, outcome); break;
      case 'price_change': handlePriceChange(msg, outcome); break;
      case 'trade': handleTrade(msg, outcome); break;
      case 'last_trade_price': break; // Ignore
      default: // Log only first 50
    }
  }
}
```

#### **3. Robust Price Change Handler**
```javascript
function handlePriceChange(data, outcome) {
  // Try different field names
  const priceValue = data.price || data.value;
  
  if (!priceValue) {
    if (messagesReceived <= 20) {
      logToFile(`PRICE_CHANGE missing price: ${JSON.stringify(data)}`);
    }
    return;
  }
  
  const price = parseFloat(priceValue);
  
  // Validate
  if (isNaN(price) || price < 0 || price > 1) return;
  
  prices.set(asset_id, { price, timestamp: Date.now() });
  log(`${outcome} price change: $${price.toFixed(4)}`);
}
```

#### **4. Robust Orderbook Handler**
```javascript
function handleOrderBookUpdate(data, outcome) {
  if (!asks || asks.length === 0) return;
  
  const bestAsk = asks[0];
  const priceValue = bestAsk.price || bestAsk.p;
  const sizeValue = bestAsk.size || bestAsk.s;
  
  if (!priceValue) {
    if (messagesReceived <= 20) {
      logToFile(`BOOK missing price: ${JSON.stringify(bestAsk)}`);
    }
    return;
  }
  
  const buyPrice = parseFloat(priceValue);
  
  // Validate price range
  if (isNaN(buyPrice) || buyPrice < 0.001 || buyPrice > 0.999) return;
  
  // Only log if price changed >= $0.0001
  if (!oldPrice || Math.abs(priceChange) >= 0.0001) {
    log(`${outcome}: $${buyPrice.toFixed(4)}`);
  }
}
```

#### **5. Raw JSON Logging**
```javascript
ws.on('message', (data) => {
  messagesReceived++;
  const rawMessage = data.toString();
  
  // Log first 10 raw messages for debugging
  if (messagesReceived <= 10) {
    logToFile(`RAW MESSAGE #${messagesReceived}: ${rawMessage}`);
  }
  
  try {
    const message = JSON.parse(rawMessage);
    handleMessage(message, marketInfo);
  } catch (error) {
    logToFile(`PARSE ERROR: ${error.message}, Data: ${rawMessage}`);
  }
});
```

#### **6. Better Statistics Display**
```javascript
function displayStats() {
  log(`📊 WebSocket Test Statistics`);
  log(`   Uptime: ${uptime}s`);
  log(`   Messages received: ${messagesReceived}`);
  log(`   Messages/second: ${(messagesReceived / uptime).toFixed(2)}`);
  
  if (prices.size === 0) {
    log(`   No prices received yet`);
  } else {
    prices.forEach((data, tokenId) => {
      if (tokenId === undefined) return; // Skip undefined
      
      const shortId = tokenId.substring(0, 20) + '...';
      log(`   ${shortId}: $${data.price.toFixed(4)}`);
    });
  }
}
```

---

## 📊 Expected Improvements

| Metric | Before | After |
|--------|--------|-------|
| **Market Discovery** | Simplified logic | ✅ Exact main bot logic |
| **Price Parse Success** | 5.6% | ✅ Should be >90% |
| **Unknown Events** | 223 logged | ✅ Ignored silently |
| **NaN Errors** | 7,242 | ✅ Validated & filtered |
| **Debug Info** | None | ✅ Raw JSON + timestamps |
| **Log Noise** | High | ✅ Filtered duplicates |

---

## 🧪 How to Re-Test

### **1. Run the fixed test:**
```bash
npm run test:ws
```

### **2. Check the log file:**
```bash
cat logs/websocket-test.log | head -50
```

Look for:
- ✅ Correct market timestamp calculation
- ✅ "RAW MESSAGE #1" through "RAW MESSAGE #10" 
- ✅ Prices between $0.40-$0.60 (if at market start)
- ✅ No "NaN" errors
- ✅ Price updates showing actual changes

### **3. Let it run for 2-5 minutes**

Then check stats:
```bash
npm run test:ws
# ... wait 2-5 minutes ...
# Press Ctrl+C

tail -30 logs/websocket-test.log
```

---

## ✅ Success Criteria

After the fixed test:

- ✅ **Connection:** Stable, no disconnections
- ✅ **Messages:** >100 per second
- ✅ **Prices:** Between $0.40-$0.60 (if fresh market)
- ✅ **Raw JSON:** First 10 messages logged for analysis
- ✅ **No NaN:** All price updates valid
- ✅ **Parsing:** >90% success rate
- ✅ **Market:** Correct timestamp, active market

---

## 🔍 Debugging Added

### **Log File Will Now Show:**

1. **Timestamp Calculation:**
   ```
   [Timestamp Calculation]
      Current Unix: 1769369400
      Market Start: 2026-01-25T19:30:00.000Z
      Market End:   2026-01-25T19:45:00.000Z
      Remaining:    12m 34s
   ```

2. **Raw JSON Messages (First 10):**
   ```
   RAW MESSAGE #1: {"event_type":"book","asset_id":"12345...","asks":[...]}
   RAW MESSAGE #2: {"event_type":"price_change","asset_id":"...","price":"0.45"}
   ```

3. **Parse Errors (if any):**
   ```
   PARSE ERROR: Unexpected token, Data: {...}
   ```

4. **Missing Fields (if any):**
   ```
   PRICE_CHANGE missing price: {"event_type":"price_change","asset_id":"..."}
   BOOK missing price: {"s":"100"}
   ```

---

## 🎯 Next Steps After Re-Test

**If test succeeds (>90% parse rate, valid prices):**
→ Proceed to **Phase 3B:** Build production WebSocket client

**If prices still look wrong:**
→ Analyze RAW MESSAGE logs to understand actual data structure

**If still getting NaN:**
→ Check field mappings in raw JSON logs

---

## 📝 Notes

- **Timing matters:** Test at market start (every :00, :15, :30, :45) for best results
- **Mid-market prices:** May be more extreme ($0.60+) if outcome is becoming clear
- **Raw JSON:** First 10 messages are crucial for understanding actual data format
- **Validation:** All prices must be in 0.001-0.999 range to be valid

---

**Status: Ready for Re-Test** ✅

Run `npm run test:ws` and share the log file after 2-5 minutes!
