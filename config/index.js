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
    dataApiUrl: process.env.DATA_API_URL || 'https://data-api.polymarket.com',
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
    websocketEnabled: process.env.WEBSOCKET_ENABLED === 'true', // Phase 3: WebSocket
    websocketStaleThreshold: parseInt(process.env.WEBSOCKET_STALE_THRESHOLD) || 5000,
  },

  // File paths
  files: {
    portfolio: (process.env.LIVE_TRADING_ENABLED === 'true')
      ? (process.env.PORTFOLIO_FILE_LIVE || './data/portfolio-live.json')
      : (process.env.PORTFOLIO_FILE || './data/portfolio.json'),
    strategyResults: (process.env.LIVE_TRADING_ENABLED === 'true')
      ? (process.env.STRATEGY_RESULTS_FILE_LIVE || './data/strategy-results-live.json')
      : (process.env.STRATEGY_RESULTS_FILE || './data/strategy-results.json'),
    logs: process.env.LOG_DIRECTORY || './logs',
  },

  // Live trading configuration
  wallet: {
    privateKey: process.env.POLYGON_PRIVATE_KEY || null,
    address: process.env.WALLET_ADDRESS || null,
    rpcUrl: process.env.RPC_URL || 'https://polygon-rpc.com',
    liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
  },

  // Live trading settings
  liveTrading: {
    enabled: process.env.LIVE_TRADING_ENABLED === 'true',
    dryRun: process.env.DRY_RUN_MODE === 'true',
    positionSize: parseFloat(process.env.POSITION_SIZE) || 1, // $1 for testing
    minExpectedReturn: parseFloat(process.env.MIN_EXPECTED_RETURN_LIVE) || 2.10,
    signatureType: parseInt(process.env.SIGNATURE_TYPE) || 0, // 0 = EOA
    verbose: process.env.VERBOSE_LOGGING === 'true',
    // When true, bot automatically redeems winning positions (Data-API + fallback)
    autoRedeem: process.env.AUTO_REDEEM_ENABLED === 'true',
    autoRedeemIntervalMinutes: parseInt(process.env.AUTO_REDEEM_INTERVAL_MINUTES, 10) || 60,
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

  // Validate live trading configuration
  if (config.liveTrading.enabled) {
    console.warn('\n⚠️  ⚠️  ⚠️  WARNING: LIVE TRADING MODE ENABLED ⚠️  ⚠️  ⚠️');
    console.warn('⚠️  Real money will be used for trades!');

    if (config.liveTrading.dryRun) {
      console.warn('✅ DRY RUN MODE: Orders will be signed but not submitted\n');
    } else {
      console.warn('🚨 LIVE MODE: Orders WILL BE SUBMITTED to Polymarket\n');
    }

    if (!config.wallet.privateKey) {
      errors.push('POLYGON_PRIVATE_KEY is required for live trading');
    }

    if (config.wallet.privateKey && !config.wallet.privateKey.startsWith('0x')) {
      errors.push('POLYGON_PRIVATE_KEY must start with 0x');
    }

    if (!config.wallet.rpcUrl) {
      console.warn('⚠️  RPC_URL not set, using default Polygon RPC (may be slow)');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return true;
}

export default config;
