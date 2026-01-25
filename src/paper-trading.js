import fs from 'fs';
import path from 'path';

const STARTING_BALANCE = 10000; // $10,000 virtual money

class PaperTradingPortfolio {
  constructor(portfolioFile = './data/portfolio.json') {
    this.portfolioFile = portfolioFile;
    this.balance = STARTING_BALANCE;
    this.openPositions = []; // Active positions
    this.closedTrades = []; // Historical trades
    this.totalProfitLoss = 0;
    
    // Ensure data directory exists
    const dir = path.dirname(this.portfolioFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.portfolioFile)) {
        const data = JSON.parse(fs.readFileSync(this.portfolioFile, 'utf8'));
        this.balance = data.balance || STARTING_BALANCE;
        this.openPositions = data.openPositions || [];
        this.closedTrades = data.closedTrades || [];
        this.totalProfitLoss = data.totalProfitLoss || 0;
      }
    } catch (error) {
      console.error('Error loading portfolio:', error.message);
    }
  }

  save() {
    try {
      const data = {
        balance: this.balance,
        openPositions: this.openPositions,
        closedTrades: this.closedTrades,
        totalProfitLoss: this.totalProfitLoss,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(this.portfolioFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving portfolio:', error.message);
    }
  }

  buyShares(marketSlug, marketTitle, outcome, pricePerShare, amountToInvest, marketEndDate) {
    if (amountToInvest > this.balance) {
      return { success: false, error: 'Insufficient balance' };
    }

    const shares = amountToInvest / pricePerShare;
    
    const position = {
      id: Date.now().toString(),
      marketSlug,
      marketTitle,
      outcome,
      pricePerShare,
      shares,
      invested: amountToInvest,
      openedAt: new Date().toISOString(),
      marketEndDate,
      status: 'open'
    };

    this.openPositions.push(position);
    this.balance -= amountToInvest;
    this.save();

    return { success: true, position };
  }

  closePosition(positionId, actualOutcome) {
    const positionIndex = this.openPositions.findIndex(p => p.id === positionId);
    
    if (positionIndex === -1) {
      return { success: false, error: 'Position not found' };
    }

    const position = this.openPositions[positionIndex];
    const won = position.outcome.toLowerCase() === actualOutcome.toLowerCase();
    
    // Calculate payout
    const payout = won ? position.shares * 1.00 : 0;
    const profitLoss = payout - position.invested;
    const roi = ((profitLoss / position.invested) * 100).toFixed(2);

    // Update position
    position.status = 'closed';
    position.closedAt = new Date().toISOString();
    position.actualOutcome = actualOutcome;
    position.won = won;
    position.payout = payout;
    position.profitLoss = profitLoss;
    position.roi = parseFloat(roi);

    // Move to closed trades
    this.closedTrades.push(position);
    this.openPositions.splice(positionIndex, 1);

    // Update balance and total P&L
    this.balance += payout;
    this.totalProfitLoss += profitLoss;
    
    this.save();

    return { success: true, position, profitLoss, roi, won };
  }

  // Close all positions for a specific market
  closeMarketPositions(marketSlug, actualOutcome) {
    const positionsToClose = this.openPositions.filter(p => p.marketSlug === marketSlug);
    const results = [];

    for (const position of positionsToClose) {
      const result = this.closePosition(position.id, actualOutcome);
      results.push(result);
    }

    return results;
  }

  getOpenPositionsForMarket(marketSlug) {
    return this.openPositions.filter(p => p.marketSlug === marketSlug);
  }

  calculateUnrealizedPL(marketSlug, currentUpPrice, currentDownPrice) {
    const positions = this.getOpenPositionsForMarket(marketSlug);
    let totalUnrealizedPL = 0;

    for (const position of positions) {
      const currentPrice = position.outcome.toLowerCase() === 'up' ? currentUpPrice : currentDownPrice;
      const currentValue = position.shares * currentPrice;
      const unrealizedPL = currentValue - position.invested;
      totalUnrealizedPL += unrealizedPL;
    }

    return totalUnrealizedPL;
  }

  getPortfolioValue(currentUpPrice = 0, currentDownPrice = 0, currentMarketSlug = null) {
    let positionsValue = 0;
    
    for (const position of this.openPositions) {
      if (currentMarketSlug && position.marketSlug === currentMarketSlug) {
        const currentPrice = position.outcome.toLowerCase() === 'up' ? currentUpPrice : currentDownPrice;
        positionsValue += position.shares * currentPrice;
      } else {
        // For other markets, use cost basis
        positionsValue += position.invested;
      }
    }

    return this.balance + positionsValue;
  }

  getSummary(currentUpPrice = 0, currentDownPrice = 0, currentMarketSlug = null) {
    const portfolioValue = this.getPortfolioValue(currentUpPrice, currentDownPrice, currentMarketSlug);
    const totalInvested = STARTING_BALANCE;
    const totalReturn = portfolioValue - totalInvested;
    const totalReturnPercent = ((totalReturn / totalInvested) * 100).toFixed(2);

    return {
      balance: this.balance,
      openPositions: this.openPositions.length,
      closedTrades: this.closedTrades.length,
      portfolioValue,
      totalInvested,
      totalReturn,
      totalReturnPercent,
      totalRealizedPL: this.totalProfitLoss
    };
  }

  getStats() {
    const wins = this.closedTrades.filter(t => t.won).length;
    const losses = this.closedTrades.filter(t => !t.won).length;
    const winRate = this.closedTrades.length > 0 
      ? ((wins / this.closedTrades.length) * 100).toFixed(2) 
      : 0;

    return {
      totalTrades: this.closedTrades.length,
      wins,
      losses,
      winRate,
      averageROI: this.closedTrades.length > 0
        ? (this.closedTrades.reduce((sum, t) => sum + t.roi, 0) / this.closedTrades.length).toFixed(2)
        : 0
    };
  }

  reset() {
    this.balance = STARTING_BALANCE;
    this.openPositions = [];
    this.closedTrades = [];
    this.totalProfitLoss = 0;
    this.save();
  }
}

export default PaperTradingPortfolio;
