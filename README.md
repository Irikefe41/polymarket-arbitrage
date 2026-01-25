# 🤖 Polymarket BTC Trading Bot

> **⚠️ PROJECT STATUS: Work in Progress**  
> This is an experimental automated trading bot for Polymarket's Bitcoin Up/Down 15-minute markets. Currently supports **paper trading only**. Live trading functionality is planned for future releases.

## 📋 Overview

An intelligent automated trading bot that monitors and trades on Polymarket's Bitcoin Up/Down 15-minute prediction markets. The bot evaluates market conditions in real-time, executes trades based on configurable ROI thresholds, and manages positions through market resolution.

### 🎯 Key Features

- **✅ Implemented**
  - Real-time market data streaming from Polymarket APIs
  - Automated position entry based on ROI analysis (>110% return threshold)
  - Smart market timing (only trades at market open for optimal prices)
  - Mid-market detection (waits for next market if started late)
  - Automatic market transitions every 15 minutes
  - Paper trading with virtual balance tracking
  - Position management with locked-in return calculations
  - Automated market resolution and P&L tracking
  - Strategy performance analytics
  - Interactive CLI with live updates

- **🚧 Planned**
  - Live trading with real funds (wallet integration)
  - Advanced strategy options (arbitrage, hedging, Kelly criterion)
  - Machine learning price prediction
  - Multi-market support
  - Web dashboard
  - Telegram/Discord notifications
  - Backtesting engine
  - Risk management controls

## 🎮 Trading Strategy

The bot uses a **high-ROI opportunity strategy**:

1. **Market Selection**: Targets Bitcoin Up/Down 15-minute markets
2. **Entry Timing**: Only enters at market open (within first 2 minutes)
3. **Position Evaluation**: Independently evaluates Up and Down positions
4. **Entry Criteria**: 
   - Investment: $100 per position
   - Required Return: $210+ (110%+ ROI)
   - Can hold 0, 1, or 2 positions per market
5. **Exit**: All positions automatically close at market end (15 minutes)

### Example Trade Flow

```
Market Opens: 4:30 PM ET
├─ Up Price: $0.46 → 217.39 shares → Return: $217.39 if wins (117% ROI) ✅ BUY
├─ Down Price: $0.42 → 238.10 shares → Return: $238.10 if wins (138% ROI) ✅ BUY
│
Market Closes: 4:45 PM ET
├─ Outcome: Up wins
├─ Up Position: +$117.39 profit ✅
├─ Down Position: -$100.00 loss ❌
└─ Net P&L: +$17.39 (8.7% ROI on $200 invested)
```

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd polymarket-btc-trading-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your preferred settings
   ```

4. **Run the bot**
   ```bash
   npm start
   ```

## ⚙️ Configuration

All configuration is managed through environment variables. See `.env.example` for all available options.

### Key Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `INITIAL_BALANCE` | 10000 | Starting balance for paper trading (USD) |
| `MIN_EXPECTED_RETURN` | 210 | Minimum return per position (USD) |
| `INVESTMENT_PER_POSITION` | 100 | Investment per position (USD) |
| `POLL_INTERVAL` | 5000 | Data polling interval (ms) |
| `MIN_TIME_TO_START` | 120000 | Max elapsed time to trade (2 min) |

### Example `.env`

```bash
# Trading Parameters
INITIAL_BALANCE=10000
MIN_EXPECTED_RETURN=210
INVESTMENT_PER_POSITION=100

# Bot Behavior
POLL_INTERVAL=5000
MIN_TIME_TO_START=120000
```

## 📊 How It Works

### 1. Market Discovery
```
Bot starts → Searches for active BTC Up/Down markets → Validates timing
```

### 2. Market Timing Check
- **< 2 min elapsed**: Start trading ✅
- **> 2 min elapsed**: Wait for next market ⏳

### 3. Real-Time Monitoring
Every 5 seconds, the bot:
- Fetches current prices from Polymarket CLOB API
- Calculates expected returns for Up and Down positions
- Displays countdown, prices, and position status

### 4. Strategy Execution
```javascript
For each outcome (Up/Down):
  expectedReturn = (100 / price) * 1.00  // shares * $1 payout
  
  if (expectedReturn >= 210 && !alreadyHolding):
    buy(outcome, $100)
```

### 5. Position Management
- Returns are **locked in** when position is opened
- Live prices update but don't affect your payout
- Display shows guaranteed returns for each scenario

### 6. Market Resolution
```
Market ends → Polymarket resolves winner → Close positions → Update balance → Find next market
```

## 📁 Project Structure

```
polymarket-btc-trading-bot/
├── src/
│   ├── index.js           # Main bot entry point
│   ├── paper-trading.js   # Portfolio & position management
│   ├── strategy.js        # Trading strategy logic
│   ├── price-tracker.js   # Market resolution tracker
│   └── test-api.js        # API testing utilities
├── config/
│   └── index.js           # Configuration management
├── data/
│   ├── portfolio.json     # Paper trading state (auto-generated)
│   └── strategy-results.json  # Performance metrics (auto-generated)
├── .env.example           # Environment variables template
├── .gitignore
├── package.json
└── README.md
```

## 🎮 Interactive Commands

While the bot is running, you can use these commands:

| Command | Description |
|---------|-------------|
| `portfolio` | View current positions and balance |
| `stats` | View trading statistics |
| `strategy` | View strategy performance summary |
| `buy up [amount]` | Manually buy Up position |
| `buy down [amount]` | Manually buy Down position |
| `help` | Show available commands |

## 📈 Understanding the Display

### Position Display (Locked-In Returns)
```
💼 YOUR POSITIONS (Locked-In Returns)
  Up: 217.39 shares @ $0.4600
  Cost: $100.00 | If Wins: $217.39 | Expected P&L: +$117.39 (117.39%)
  
  Down: 238.10 shares @ $0.4200
  Cost: $100.00 | If Wins: $238.10 | Expected P&L: +$138.10 (138.10%)

  Total Invested: $200.00
  Scenarios:
    If Up wins:   +$17.39 (8.70% ROI)
    If Down wins: +$38.10 (19.05% ROI)
```

This shows your **guaranteed returns** if each outcome wins. The market price moving after you buy doesn't change your payout!

## 🔬 API Integration

The bot uses two Polymarket APIs:

### Gamma API (`gamma-api.polymarket.com`)
- Market discovery and metadata
- Event information
- Market resolution status

### CLOB API (`clob.polymarket.com`)
- Real-time orderbook data
- Current buy/sell prices
- Liquidity information

## 🛡️ Risk Disclaimer

**THIS BOT IS FOR EDUCATIONAL AND RESEARCH PURPOSES ONLY.**

- Currently paper trading only (no real money)
- Past performance does not guarantee future results
- Prediction markets involve risk of loss
- Always test thoroughly before considering live trading
- Never invest more than you can afford to lose

## 🔮 Roadmap

### Phase 1: Core Functionality (Current)
- [x] Paper trading system
- [x] Real-time data streaming
- [x] Automated strategy execution
- [x] Market timing intelligence
- [x] Position management
- [ ] Comprehensive testing

### Phase 2: Live Trading (Planned)
- [ ] Wallet integration (Polygon)
- [ ] Transaction signing
- [ ] Gas optimization
- [ ] Order placement via CLOB
- [ ] Real balance management

### Phase 3: Advanced Features (Future)
- [ ] Multiple strategy modes
- [ ] ML-based price prediction
- [ ] Advanced risk controls
- [ ] Web dashboard
- [ ] Notification system
- [ ] Backtesting engine

## 🤝 Contributing

This project is currently in development. Contributions, suggestions, and bug reports are welcome!

## 📄 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- [Polymarket](https://polymarket.com) for providing the prediction market platform
- Polymarket API documentation and community

---

**⚠️ Remember**: This is experimental software. Always understand the risks before trading with real money.
