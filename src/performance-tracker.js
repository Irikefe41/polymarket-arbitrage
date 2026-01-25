/**
 * Performance Tracker
 * 
 * Tracks and logs latency metrics for optimization analysis
 */

import fs from 'fs';
import path from 'path';

class PerformanceTracker {
  constructor(metricsFile = './data/performance-metrics.json') {
    this.metricsFile = metricsFile;
    this.currentCycle = {};
    this.sessionMetrics = {
      startedAt: new Date().toISOString(),
      cycles: [],
      summary: {
        totalCycles: 0,
        avgCycleTime: 0,
        avgApiCallTime: 0,
        avgStrategyTime: 0,
        totalTimeSaved: 0
      }
    };
    
    // Ensure data directory exists
    const dir = path.dirname(this.metricsFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.metricsFile)) {
        const data = JSON.parse(fs.readFileSync(this.metricsFile, 'utf8'));
        // Keep historical data but start new session
        this.historicalSummary = data.summary || null;
      }
    } catch (error) {
      console.error('Error loading performance metrics:', error.message);
    }
  }

  save() {
    try {
      const data = {
        ...this.sessionMetrics,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(this.metricsFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving performance metrics:', error.message);
    }
  }

  /**
   * Start timing an operation
   */
  startTimer(operation) {
    this.currentCycle[operation] = {
      start: Date.now(),
      end: null,
      duration: null
    };
  }

  /**
   * End timing an operation
   */
  endTimer(operation) {
    if (this.currentCycle[operation]) {
      this.currentCycle[operation].end = Date.now();
      this.currentCycle[operation].duration = 
        this.currentCycle[operation].end - this.currentCycle[operation].start;
      return this.currentCycle[operation].duration;
    }
    return null;
  }

  /**
   * Record a completed cycle
   */
  recordCycle(cycleData) {
    const cycle = {
      timestamp: new Date().toISOString(),
      ...this.currentCycle,
      ...cycleData
    };

    this.sessionMetrics.cycles.push(cycle);
    this.sessionMetrics.summary.totalCycles++;
    
    // Update running averages
    this.updateSummary();
    
    // Reset current cycle
    this.currentCycle = {};
    
    // Save every 10 cycles
    if (this.sessionMetrics.cycles.length % 10 === 0) {
      this.save();
    }
  }

  /**
   * Update summary statistics
   */
  updateSummary() {
    const cycles = this.sessionMetrics.cycles;
    if (cycles.length === 0) return;

    const recent = cycles.slice(-100); // Last 100 cycles

    // Calculate averages
    const apiTimes = recent
      .filter(c => c.apiCalls?.duration)
      .map(c => c.apiCalls.duration);
    
    const strategyTimes = recent
      .filter(c => c.strategy?.duration)
      .map(c => c.strategy.duration);
    
    const cycleTimes = recent
      .filter(c => c.totalCycle?.duration)
      .map(c => c.totalCycle.duration);

    this.sessionMetrics.summary.avgApiCallTime = 
      apiTimes.length > 0 ? Math.round(apiTimes.reduce((a, b) => a + b, 0) / apiTimes.length) : 0;
    
    this.sessionMetrics.summary.avgStrategyTime = 
      strategyTimes.length > 0 ? Math.round(strategyTimes.reduce((a, b) => a + b, 0) / strategyTimes.length) : 0;
    
    this.sessionMetrics.summary.avgCycleTime = 
      cycleTimes.length > 0 ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) : 0;

    // Estimate time saved (compared to baseline of 600ms API calls)
    const baselineApiTime = 600; // Sequential baseline
    const timeSavedPerCycle = Math.max(0, baselineApiTime - this.sessionMetrics.summary.avgApiCallTime);
    this.sessionMetrics.summary.totalTimeSaved = Math.round(timeSavedPerCycle * cycles.length);
  }

  /**
   * Get current session statistics
   */
  getStats() {
    return {
      session: this.sessionMetrics.summary,
      lastCycle: this.sessionMetrics.cycles[this.sessionMetrics.cycles.length - 1],
      historical: this.historicalSummary
    };
  }

  /**
   * Display performance summary
   */
  displaySummary(colors) {
    const stats = this.getStats();
    
    console.log(`\n${colors.bright}${colors.cyan}⚡ PERFORMANCE METRICS${colors.reset}`);
    console.log(`${colors.cyan}Session started: ${this.sessionMetrics.startedAt}${colors.reset}`);
    console.log(`${colors.cyan}Total cycles: ${stats.session.totalCycles}${colors.reset}`);
    
    if (stats.session.totalCycles > 0) {
      console.log(`\n${colors.yellow}Average Timings:${colors.reset}`);
      console.log(`  API Calls:    ${colors.green}${stats.session.avgApiCallTime}ms${colors.reset} ${this.getSpeedIndicator(stats.session.avgApiCallTime, 600)}`);
      console.log(`  Strategy:     ${colors.green}${stats.session.avgStrategyTime}ms${colors.reset}`);
      console.log(`  Full Cycle:   ${colors.green}${stats.session.avgCycleTime}ms${colors.reset}`);
      
      if (stats.session.totalTimeSaved > 0) {
        const savedSeconds = (stats.session.totalTimeSaved / 1000).toFixed(1);
        console.log(`\n${colors.bright}${colors.green}💰 Total time saved: ${savedSeconds}s${colors.reset}`);
        console.log(`${colors.dim}   (vs. baseline 600ms sequential API calls)${colors.reset}`);
      }
    }
    
    if (stats.lastCycle?.apiCalls?.details) {
      console.log(`\n${colors.yellow}Last Cycle Breakdown:${colors.reset}`);
      const details = stats.lastCycle.apiCalls.details;
      console.log(`  Parallel groups: ${details.parallelGroups || 'N/A'}`);
      console.log(`  Total API calls: ${details.totalCalls || 'N/A'}`);
      console.log(`  Mode: ${details.mode || 'sequential'}`);
    }
    
    console.log('');
  }

  /**
   * Get speed indicator emoji based on performance
   */
  getSpeedIndicator(actual, baseline) {
    const improvement = ((baseline - actual) / baseline) * 100;
    
    if (improvement >= 70) return '🚀 (Excellent)';
    if (improvement >= 50) return '⚡ (Great)';
    if (improvement >= 30) return '✅ (Good)';
    if (improvement >= 10) return '➡️  (OK)';
    if (improvement >= 0) return '⚠️  (Slow)';
    return '🔴 (Worse)'; // Somehow slower than baseline
  }

  /**
   * Record API call metrics with detailed breakdown
   */
  recordApiCalls(duration, details = {}) {
    if (!this.currentCycle.apiCalls) {
      this.currentCycle.apiCalls = {
        start: Date.now() - duration,
        end: Date.now(),
        duration,
        details
      };
    }
  }

  /**
   * Record strategy execution metrics
   */
  recordStrategy(duration, executed = false) {
    this.currentCycle.strategy = {
      start: Date.now() - duration,
      end: Date.now(),
      duration,
      executed
    };
  }
}

// Singleton instance
const performanceTracker = new PerformanceTracker();

export default performanceTracker;
