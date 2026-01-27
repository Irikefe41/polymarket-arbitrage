import fs from 'fs';
import path from 'path';
import config from '../config/index.js';
import feeCalculator from './fee-calculator.js';

// Strategy parameters (read from .env via config)
const INVESTMENT_PER_POSITION = config.strategy.investmentPerPosition;  // Default: $100 per position
const MIN_EXPECTED_RETURN = config.strategy.minExpectedReturn;  // Default: $210 return (110% ROI)
const MIN_PROFIT = config.strategy.minProfit;  // Default: $110 profit per position

class HedgeStrategy {
  constructor(portfolio, tradingExecutor, resultsFile = './data/strategy-results.json') {
    this.portfolio = portfolio;
    this.executor = tradingExecutor; // Trading executor (paper or live)
    this.resultsFile = resultsFile;

    // Determine ROI threshold and investment based on mode
    const isLive = this.executor.mode === 'live';
    this.config = {
      investment: isLive ? config.liveTrading.positionSize : config.strategy.investmentPerPosition,
      minReturn: isLive ? config.liveTrading.minExpectedReturn : config.strategy.minExpectedReturn,
      minProfit: isLive ? 1.10 : config.strategy.minProfit // Adjust min profit for live
    };

    console.log(`🤖 Strategy configured for ${this.executor.mode.toUpperCase()} mode:`);
    console.log(`   Investment: $${this.config.investment}`);
    console.log(`   Min Return: $${this.config.minReturn}`);

    // Ensure data directory exists
    const dir = path.dirname(this.resultsFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.results = this.loadResults();
    this.executedMarkets = new Map(); // Track which positions executed per market
    this.inFlightOrders = new Set(); // Prevent duplicate orders for same outcome/market
  }

  loadResults() {
    try {
      if (fs.existsSync(this.resultsFile)) {
        return JSON.parse(fs.readFileSync(this.resultsFile, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading results:', error.message);
    }
    return { trades: [], summary: { totalTrades: 0, totalProfit: 0, winRate: 0 } };
  }

  saveResults() {
    try {
      fs.writeFileSync(this.resultsFile, JSON.stringify(this.results, null, 2));
    } catch (error) {
      console.error('Error saving results:', error.message);
    }
  }

  evaluatePosition(price, outcome) {
    const { investment, minReturn } = this.config;

    // Validate price is within reasonable bounds (0.01 to 0.99)
    if (price < 0.01 || price > 0.99 || !isFinite(price)) {
      return {
        outcome,
        price,
        shares: 0,
        investment: investment,
        estimatedFee: 0,
        effectiveRate: 0,
        totalCost: investment,
        potentialReturn: 0,
        grossProfit: 0,
        grossROI: 0,
        netProfit: 0,
        netROI: 0,
        roi: 0,
        isProfitable: false,
        meetsThreshold: false,
        invalidPrice: true,
        reason: 'Price outside valid range ($0.01 - $0.99)'
      };
    }

    // Calculate returns for a single position
    const shares = investment / price;
    const potentialReturn = shares * 1.00; // If this outcome wins

    // Calculate fees
    const estimatedFee = feeCalculator.calculateFeeForInvestment(investment, price);
    const effectiveRate = feeCalculator.calculateEffectiveRate(price);
    const totalCost = investment + estimatedFee;

    // Gross profit (without fees)
    const grossProfit = potentialReturn - investment;
    const grossROI = ((grossProfit / investment) * 100).toFixed(2);

    // Net profit (after fees)
    const netProfit = potentialReturn - totalCost;
    const netROI = ((netProfit / totalCost) * 100).toFixed(2);

    // Check if this position meets the threshold AFTER fees
    const isProfitable = potentialReturn >= minReturn && netProfit > 0;

    return {
      outcome,
      price,
      shares,
      investment: investment,
      estimatedFee,
      effectiveRate,
      totalCost,
      potentialReturn,
      grossProfit,
      grossROI: parseFloat(grossROI),
      netProfit,
      netROI: parseFloat(netROI),
      roi: parseFloat(netROI), // Use net ROI as primary ROI
      isProfitable,
      meetsThreshold: isProfitable
    };
  }

  evaluateOpportunity(upPrice, downPrice) {
    const upAnalysis = this.evaluatePosition(upPrice, 'Up');
    const downAnalysis = this.evaluatePosition(downPrice, 'Down');

    return {
      up: upAnalysis,
      down: downAnalysis,
      shouldBuyUp: upAnalysis.isProfitable,
      shouldBuyDown: downAnalysis.isProfitable
    };
  }

  shouldExecute(marketSlug, upPrice, downPrice) {
    // Get existing positions
    const existingPositions = this.portfolio.getOpenPositionsForMarket(marketSlug);
    const hasUpPosition = existingPositions.some(p => p.outcome.toLowerCase() === 'up');
    const hasDownPosition = existingPositions.some(p => p.outcome.toLowerCase() === 'down');

    // Evaluate both positions independently
    const analysis = this.evaluateOpportunity(upPrice, downPrice);

    // Check balance
    if (this.portfolio.balance < this.config.investment) {
      return {
        shouldExecute: false,
        shouldBuyUp: false,
        shouldBuyDown: false,
        reason: 'Insufficient balance',
        analysis
      };
    }

    // Check for in-flight orders for this market/outcome
    const upLocked = this.inFlightOrders.has(`${marketSlug}-Up`);
    const downLocked = this.inFlightOrders.has(`${marketSlug}-Down`);

    // Determine what to buy based on independent criteria
    const shouldBuyUp = analysis.shouldBuyUp && !hasUpPosition && !upLocked;
    const shouldBuyDown = analysis.shouldBuyDown && !hasDownPosition && !downLocked;

    if (!shouldBuyUp && !shouldBuyDown) {
      let reasons = [];
      if (hasUpPosition && hasDownPosition) {
        reasons.push('Already have both positions');
      } else {
        if (upLocked) reasons.push('Up: Order already in flight');
        else if (!analysis.shouldBuyUp || hasUpPosition) {
          reasons.push(`Up: ${hasUpPosition ? 'Already own' : `$${analysis.up.potentialReturn.toFixed(2)} < $${this.config.minReturn}`}`);
        }

        if (downLocked) reasons.push('Down: Order already in flight');
        else if (!analysis.shouldBuyDown || hasDownPosition) {
          reasons.push(`Down: ${hasDownPosition ? 'Already own' : `$${analysis.down.potentialReturn.toFixed(2)} < $${this.config.minReturn}`}`);
        }
      }

      return {
        shouldExecute: false,
        shouldBuyUp: false,
        shouldBuyDown: false,
        reason: reasons.join(', '),
        analysis
      };
    }

    let reason = 'Buying: ';
    if (shouldBuyUp && shouldBuyDown) {
      reason += `Both (Up: $${analysis.up.potentialReturn.toFixed(2)}, Down: $${analysis.down.potentialReturn.toFixed(2)})`;
    } else if (shouldBuyUp) {
      reason += `Up ($${analysis.up.potentialReturn.toFixed(2)} return)`;
    } else if (shouldBuyDown) {
      reason += `Down ($${analysis.down.potentialReturn.toFixed(2)} return)`;
    }

    return {
      shouldExecute: true,
      shouldBuyUp,
      shouldBuyDown,
      reason,
      analysis
    };
  }

  async execute(marketSlug, marketTitle, marketEndDate, upPrice, downPrice, colors) {
    const decision = this.shouldExecute(marketSlug, upPrice, downPrice);

    if (!decision.shouldExecute) {
      return {
        executed: false,
        reason: decision.reason,
        analysis: decision.analysis
      };
    }

    console.log(`\n${colors.bright}${colors.green}🎯 STRATEGY EXECUTION${colors.reset}`);
    console.log(`${colors.cyan}Market: ${marketTitle}${colors.reset}`);
    console.log(`${colors.yellow}Analysis:${colors.reset}`);

    const results = { executed: false, positions: [] };

    // Execute Up position if profitable
    if (decision.shouldBuyUp) {
      const upAnalysis = decision.analysis.up;
      const lockKey = `${marketSlug}-Up`;
      this.inFlightOrders.add(lockKey);

      try {
        console.log(`\n  ${colors.green}📈 Buying UP${colors.reset}`);
        console.log(`    Price: $${upAnalysis.price.toFixed(4)}`);
        console.log(`    Investment: $${upAnalysis.investment}`);
        console.log(`    Est. Fee: $${upAnalysis.estimatedFee.toFixed(4)} (${upAnalysis.effectiveRate.toFixed(2)}%)`);
        console.log(`    Total Cost: $${upAnalysis.totalCost.toFixed(2)}`);
        console.log(`    Shares: ${upAnalysis.shares.toFixed(2)}`);
        console.log(`    Potential Return: $${upAnalysis.potentialReturn.toFixed(2)}`);
        console.log(`    Expected Profit (after fees): ${colors.green}+$${upAnalysis.netProfit.toFixed(2)} (${upAnalysis.netROI}%)${colors.reset}`);

        const upResult = await this.executor.executeBuy(
          marketSlug,
          marketTitle,
          marketEndDate,
          'Up',
          upPrice,
          this.config.investment
        );

        if (upResult.success) {
          console.log(`    ${colors.green}✅ Up position executed${upResult.mode === 'live' ? ' (LIVE TRADE)' : ''}${colors.reset}`);
          results.positions.push({ outcome: 'Up', position: upResult.position });

          // Mark as executed
          const executed = this.executedMarkets.get(marketSlug) || { up: false, down: false };
          executed.up = true;
          this.executedMarkets.set(marketSlug, executed);
          results.executed = true;
        } else {
          console.log(`    ${colors.red}❌ Failed: ${upResult.error}${colors.reset}`);
          this.inFlightOrders.delete(lockKey); // Release lock on failure
        }
      } catch (error) {
        console.error(`    ${colors.red}❌ Strategy Error (Up): ${error.message}${colors.reset}`);
        this.inFlightOrders.delete(lockKey);
      }
    }

    // Execute Down position if profitable
    if (decision.shouldBuyDown) {
      const downAnalysis = decision.analysis.down;
      const lockKey = `${marketSlug}-Down`;
      this.inFlightOrders.add(lockKey);

      try {
        console.log(`\n  ${colors.red}📉 Buying DOWN${colors.reset}`);
        console.log(`    Price: $${downAnalysis.price.toFixed(4)}`);
        console.log(`    Investment: $${downAnalysis.investment}`);
        console.log(`    Est. Fee: $${downAnalysis.estimatedFee.toFixed(4)} (${downAnalysis.effectiveRate.toFixed(2)}%)`);
        console.log(`    Total Cost: $${downAnalysis.totalCost.toFixed(2)}`);
        console.log(`    Shares: ${downAnalysis.shares.toFixed(2)}`);
        console.log(`    Potential Return: $${downAnalysis.potentialReturn.toFixed(2)}`);
        console.log(`    Expected Profit (after fees): ${colors.green}+$${downAnalysis.netProfit.toFixed(2)} (${downAnalysis.netROI}%)${colors.reset}`);

        const downResult = await this.executor.executeBuy(
          marketSlug,
          marketTitle,
          marketEndDate,
          'Down',
          downPrice,
          this.config.investment
        );

        if (downResult.success) {
          console.log(`    ${colors.green}✅ Down position executed${downResult.mode === 'live' ? ' (LIVE TRADE)' : ''}${colors.reset}`);
          results.positions.push({ outcome: 'Down', position: downResult.position });

          // Mark as executed
          const executed = this.executedMarkets.get(marketSlug) || { up: false, down: false };
          executed.down = true;
          this.executedMarkets.set(marketSlug, executed);
          results.executed = true;
        } else {
          console.log(`    ${colors.red}❌ Failed: ${downResult.error}${colors.reset}`);
          this.inFlightOrders.delete(lockKey); // Release lock on failure
        }
      } catch (error) {
        console.error(`    ${colors.red}❌ Strategy Error (Down): ${error.message}${colors.reset}`);
        this.inFlightOrders.delete(lockKey);
      }
    }

    console.log(`\n  ${colors.cyan}New Balance: $${this.portfolio.balance.toFixed(2)}${colors.reset}\n`);

    return results;
  }

  recordMarketResult(marketSlug, marketTitle, actualOutcome, positions) {
    // positions is an array of positions for this market
    let totalInvested = 0;
    let totalPayout = 0;

    const result = {
      timestamp: new Date().toISOString(),
      marketSlug,
      marketTitle,
      actualOutcome,
      positions: []
    };

    // Process each position
    for (const pos of positions) {
      const won = pos.outcome.toLowerCase() === actualOutcome.toLowerCase();
      const payout = won ? pos.shares * 1.00 : 0;

      totalInvested += pos.invested;
      totalPayout += payout;

      result.positions.push({
        outcome: pos.outcome,
        price: pos.pricePerShare,
        shares: pos.shares,
        invested: pos.invested,
        won,
        payout
      });
    }

    const netProfit = totalPayout - totalInvested;
    const roi = totalInvested > 0 ? ((netProfit / totalInvested) * 100).toFixed(2) : 0;

    result.totalInvested = totalInvested;
    result.totalPayout = totalPayout;
    result.netProfit = netProfit;
    result.roi = parseFloat(roi);

    this.results.trades.push(result);
    this.updateSummary();
    this.saveResults();

    return result;
  }

  updateSummary() {
    const totalTrades = this.results.trades.length;
    const totalProfit = this.results.trades.reduce((sum, t) => sum + t.netProfit, 0);
    const profitableTrades = this.results.trades.filter(t => t.netProfit > 0).length;
    const winRate = totalTrades > 0 ? ((profitableTrades / totalTrades) * 100).toFixed(2) : 0;
    const avgProfit = totalTrades > 0 ? (totalProfit / totalTrades).toFixed(2) : 0;

    this.results.summary = {
      totalTrades,
      totalProfit: parseFloat(totalProfit.toFixed(2)),
      profitableTrades,
      winRate: parseFloat(winRate),
      avgProfit: parseFloat(avgProfit),
      lastUpdated: new Date().toISOString()
    };
  }

  displaySummary(colors) {
    const summary = this.results.summary;

    console.log(`\n${colors.bright}${colors.cyan}📊 STRATEGY PERFORMANCE${colors.reset}`);
    console.log(`  Total Trades: ${summary.totalTrades}`);
    console.log(`  Total Profit: ${summary.totalProfit >= 0 ? colors.green : colors.red}${summary.totalProfit >= 0 ? '+' : ''}$${summary.totalProfit.toFixed(2)}${colors.reset}`);
    console.log(`  Profitable Trades: ${summary.profitableTrades}/${summary.totalTrades}`);
    console.log(`  Win Rate: ${parseFloat(summary.winRate) >= 50 ? colors.green : colors.yellow}${summary.winRate}%${colors.reset}`);
    console.log(`  Avg Profit/Trade: ${summary.avgProfit >= 0 ? colors.green : colors.red}${summary.avgProfit >= 0 ? '+' : ''}$${summary.avgProfit}${colors.reset}\n`);
  }
}

export default HedgeStrategy;
