/**
 * Polymarket Fee Calculator
 * 
 * Implements the Polymarket fee structure for 15-minute crypto markets.
 * Fee formula: fee = shares × price × 0.25 × (price × (1 - price))²
 * 
 * Fees are highest at 50% probability (1.56%) and lowest at extremes (near 0%).
 */

class FeeCalculator {
  constructor() {
    // Fee constants
    this.FEE_MULTIPLIER = 0.25;
    this.MIN_FEE = 0.0001; // Minimum fee charged (4 decimal places)
    this.MAX_EFFECTIVE_RATE = 0.0156; // 1.56% at 50% probability
  }

  /**
   * Calculate taker fee for a trade
   * @param {number} shares - Number of shares
   * @param {number} price - Price per share (0.01 to 0.99)
   * @returns {number} Fee in USDC
   */
  calculateTakerFee(shares, price) {
    // Validate inputs
    if (!isFinite(price) || !isFinite(shares) || price <= 0 || price >= 1 || shares <= 0) {
      return 0; // No fee for invalid inputs or extremes
    }

    // Fee formula: shares × price × 0.25 × (price × (1 - price))²
    const priceFactor = price * (1 - price);
    const fee = shares * price * this.FEE_MULTIPLIER * Math.pow(priceFactor, 2);
    
    // Validate result
    if (!isFinite(fee)) {
      return 0;
    }
    
    // Round to 4 decimal places
    const roundedFee = Math.round(fee * 10000) / 10000;
    
    // Return 0 if below minimum fee threshold
    return roundedFee < this.MIN_FEE ? 0 : roundedFee;
  }

  /**
   * Calculate fee for a fixed investment amount
   * Simplified formula: investment × 0.25 × (price × (1 - price))²
   * @param {number} investment - Investment amount in USDC
   * @param {number} price - Price per share (0.01 to 0.99)
   * @returns {number} Fee in USDC
   */
  calculateFeeForInvestment(investment, price) {
    // Validate inputs
    if (!isFinite(price) || !isFinite(investment) || price <= 0 || price >= 1 || investment <= 0) {
      return 0;
    }

    // Simplified: investment × 0.25 × (P × (1-P))²
    const priceFactor = price * (1 - price);
    const fee = investment * this.FEE_MULTIPLIER * Math.pow(priceFactor, 2);
    
    // Validate result
    if (!isFinite(fee)) {
      return 0;
    }
    
    // Round to 4 decimal places
    const roundedFee = Math.round(fee * 10000) / 10000;
    
    return roundedFee < this.MIN_FEE ? 0 : roundedFee;
  }

  /**
   * Calculate effective fee rate (as percentage)
   * @param {number} price - Price per share
   * @returns {number} Effective fee rate (e.g., 1.56 for 1.56%)
   */
  calculateEffectiveRate(price) {
    // Validate input
    if (!isFinite(price) || price <= 0 || price >= 1) {
      return 0;
    }

    const priceFactor = price * (1 - price);
    const effectiveRate = this.FEE_MULTIPLIER * Math.pow(priceFactor, 2) * 100;
    
    // Validate result
    if (!isFinite(effectiveRate)) {
      return 0;
    }
    
    return Math.round(effectiveRate * 100) / 100; // Round to 2 decimals
  }

  /**
   * Calculate net profit after fees
   * @param {number} investment - Initial investment
   * @param {number} price - Entry price
   * @param {number} payout - Payout if position wins (typically shares * 1.00)
   * @returns {object} Breakdown of profit/loss with fees
   */
  calculateNetProfit(investment, price, payout) {
    const fee = this.calculateFeeForInvestment(investment, price);
    const totalCost = investment + fee;
    const grossProfit = payout - investment;
    const netProfit = payout - totalCost;
    const netROI = ((netProfit / totalCost) * 100).toFixed(2);
    
    return {
      investment,
      fee,
      totalCost,
      payout,
      grossProfit,
      netProfit,
      netROI: parseFloat(netROI),
      effectiveRate: this.calculateEffectiveRate(price)
    };
  }

  /**
   * Analyze a hedged position (both Up and Down)
   * @param {number} investmentPerSide - Investment per position
   * @param {number} upPrice - Up price
   * @param {number} downPrice - Down price
   * @returns {object} Analysis with fees
   */
  analyzeHedgedPosition(investmentPerSide, upPrice, downPrice) {
    const upShares = investmentPerSide / upPrice;
    const downShares = investmentPerSide / downPrice;
    
    const upFee = this.calculateFeeForInvestment(investmentPerSide, upPrice);
    const downFee = this.calculateFeeForInvestment(investmentPerSide, downPrice);
    const totalFees = upFee + downFee;
    
    const totalInvestment = investmentPerSide * 2;
    const totalCost = totalInvestment + totalFees;
    
    // Payouts if each side wins
    const upPayout = upShares * 1.00;
    const downPayout = downShares * 1.00;
    
    // Net profits
    const netProfitIfUpWins = upPayout - totalCost;
    const netProfitIfDownWins = downPayout - totalCost;
    
    // ROI
    const roiIfUpWins = ((netProfitIfUpWins / totalCost) * 100).toFixed(2);
    const roiIfDownWins = ((netProfitIfDownWins / totalCost) * 100).toFixed(2);
    
    return {
      upPosition: {
        price: upPrice,
        shares: upShares,
        investment: investmentPerSide,
        fee: upFee,
        effectiveRate: this.calculateEffectiveRate(upPrice)
      },
      downPosition: {
        price: downPrice,
        shares: downShares,
        investment: investmentPerSide,
        fee: downFee,
        effectiveRate: this.calculateEffectiveRate(downPrice)
      },
      combined: {
        totalInvestment,
        totalFees,
        totalCost,
        upPayout,
        downPayout,
        netProfitIfUpWins,
        netProfitIfDownWins,
        roiIfUpWins: parseFloat(roiIfUpWins),
        roiIfDownWins: parseFloat(roiIfDownWins),
        isProfitable: netProfitIfUpWins > 0 || netProfitIfDownWins > 0,
        guaranteedProfit: Math.min(netProfitIfUpWins, netProfitIfDownWins) > 0
      }
    };
  }

  /**
   * Get fee breakdown for display
   * @param {number} investment - Investment amount
   * @param {number} price - Price per share
   * @returns {object} Human-readable fee breakdown
   */
  getFeeBreakdown(investment, price) {
    const shares = investment / price;
    const fee = this.calculateFeeForInvestment(investment, price);
    const effectiveRate = this.calculateEffectiveRate(price);
    
    return {
      investment: investment.toFixed(2),
      price: price.toFixed(4),
      shares: shares.toFixed(2),
      fee: fee.toFixed(4),
      effectiveRate: `${effectiveRate.toFixed(2)}%`,
      totalCost: (investment + fee).toFixed(2)
    };
  }

  /**
   * Check if a position is profitable after fees
   * @param {number} investment - Investment amount
   * @param {number} price - Entry price
   * @param {number} minReturn - Minimum required return
   * @returns {boolean} True if profitable after fees
   */
  isProfitableAfterFees(investment, price, minReturn) {
    const shares = investment / price;
    const fee = this.calculateFeeForInvestment(investment, price);
    const totalCost = investment + fee;
    const payout = shares * 1.00;
    const netProfit = payout - totalCost;
    
    return payout >= minReturn && netProfit > 0;
  }

  /**
   * Calculate break-even price with fees
   * Given a target return, what price do we need?
   * @param {number} investment - Investment amount
   * @param {number} targetReturn - Target payout
   * @returns {number} Maximum price to pay
   */
  calculateBreakEvenPrice(investment, targetReturn) {
    // This requires solving a complex equation, use approximation
    // For now, iterate to find the price
    for (let price = 0.01; price <= 0.99; price += 0.001) {
      const shares = investment / price;
      const fee = this.calculateFeeForInvestment(investment, price);
      const totalCost = investment + fee;
      const payout = shares * 1.00;
      
      if (payout >= targetReturn && payout > totalCost) {
        return price;
      }
    }
    
    return null; // No profitable price found
  }
}

// Export singleton instance
const feeCalculator = new FeeCalculator();

export default feeCalculator;
