import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

// Configuration object with defaults
const config = {
  // API endpoints
  api: {
    gammaUrl: process.env.GAMMA_API_URL || 'https://gamma-api.polymarket.com',
    clobUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
  },

  // Trading strategy parameters
  strategy: {
    initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 10000,
    minExpectedReturn: parseFloat(process.env.MIN_EXPECTED_RETURN) || 210,
    investmentPerPosition: parseFloat(process.env.INVESTMENT_PER_POSITION) || 100,
    minProfit: parseFloat(process.env.MIN_PROFIT) || 110,
  },

  // Bot behavior
  bot: {
    pollInterval: parseInt(process.env.POLL_INTERVAL) || 5000,
    maxResolutionWait: parseInt(process.env.MAX_RESOLUTION_WAIT) || 600000,
    resolutionPollInterval: parseInt(process.env.RESOLUTION_POLL_INTERVAL) || 30000,
    minTimeToStart: parseInt(process.env.MIN_TIME_TO_START) || 120000,
  },

  // File paths
  files: {
    portfolio: process.env.PORTFOLIO_FILE || './data/portfolio.json',
    strategyResults: process.env.STRATEGY_RESULTS_FILE || './data/strategy-results.json',
  },

  // Future: Live trading config (not implemented)
  wallet: {
    privateKey: process.env.WALLET_PRIVATE_KEY || null,
    apiKey: process.env.POLYMARKET_API_KEY || null,
    rpcUrl: process.env.RPC_URL || null,
    liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
  },
};

// Validate critical configuration
export function validateConfig() {
  const errors = [];

  // Validate strategy parameters
  if (config.strategy.minExpectedReturn < config.strategy.investmentPerPosition) {
    errors.push('MIN_EXPECTED_RETURN must be greater than INVESTMENT_PER_POSITION');
  }

  if (config.strategy.initialBalance < config.strategy.investmentPerPosition * 2) {
    errors.push('INITIAL_BALANCE must be at least 2x INVESTMENT_PER_POSITION');
  }

  // Warn about live trading
  if (config.wallet.liveTradingEnabled) {
    console.warn('⚠️  WARNING: Live trading is not yet implemented. Running in paper trading mode.');
    config.wallet.liveTradingEnabled = false;
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return true;
}

export default config;
