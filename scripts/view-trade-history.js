/**
 * View Trade History
 *
 * Fetches your trade/fill history from Polymarket CLOB so you can see
 * what executed and what you should have received when markets resolved.
 *
 * With Up + Down buys in the SAME market, one side always wins, so you
 * should have received a payout for the winning shares (e.g. ~$5+ back).
 *
 * Usage: npm run trade-history
 */

import OrderManager from '../src/order-manager.js';
import config from '../config/index.js';
import fetch from 'node-fetch';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const CLOB_API = config.api.clobUrl;

async function fetchTradesForAddress(orderManager) {
  const address = orderManager.address;
  const url = `${CLOB_API}/data/trades?maker=${address}`;

  try {
    // CLOB trades endpoint often requires L2 auth; the client may not expose getTrades.
    // Try raw fetch first (some deployments allow it).
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, error: 'Trades endpoint requires authentication. Use Polymarket portfolio or PolygonScan.' };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, trades: Array.isArray(data) ? data : data.trades || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║   Trade History                       ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════╝${colors.reset}\n`);

  if (!config.wallet.privateKey) {
    console.error(`${colors.red}❌ POLYGON_PRIVATE_KEY not set in .env${colors.reset}\n`);
    process.exit(1);
  }

  const orderManager = new OrderManager(config.wallet.privateKey, {
    dryRun: false,
    verbose: false,
  });
  await orderManager.initialize();

  const balance = await orderManager.getBalance();
  const address = orderManager.address;

  console.log(`${colors.cyan}Wallet:${colors.reset} ${address}`);
  console.log(`${colors.cyan}USDC balance:${colors.reset} $${balance.usdc.toFixed(6)}\n`);

  // Try client getTrades if available
  let trades = [];
  if (typeof orderManager.clobClientL2.getTrades === 'function') {
    try {
      const result = await orderManager.clobClientL2.getTrades({ maker_address: address });
      trades = result || [];
    } catch (e) {
      console.log(`${colors.yellow}Could not get trades from client: ${e.message}${colors.reset}\n`);
    }
  }

  if (trades.length === 0) {
    const result = await fetchTradesForAddress(orderManager);
    if (result.ok && result.trades.length > 0) {
      trades = result.trades;
    } else if (!result.ok) {
      console.log(`${colors.yellow}API: ${result.error}${colors.reset}\n`);
    }
  }

  if (trades.length > 0) {
    console.log(`${colors.yellow}═══ Recent Trades (CLOB) ═══${colors.reset}\n`);
    const recent = trades.slice(0, 20);
    const slugTimestamps = new Set();
    recent.forEach((t, i) => {
      const side = t.side || t.type || '?';
      const size = t.size || t.matched_amount || '?';
      const price = t.price || '?';
      const time = t.match_time || t.last_update || '';
      const outcome = t.outcome || '';
      if (time && Number(time)) {
        const ts = Number(time);
        slugTimestamps.add(ts);
        slugTimestamps.add(Math.floor(ts / 900) * 900);
      }
      console.log(`  ${i + 1}. ${side} ${size} @ ${price} ${outcome ? `(${outcome})` : ''} ${time}`);
    });
    console.log('');
    if (slugTimestamps.size > 0) {
      console.log(`${colors.yellow}═══ Redeem winning shares ═══${colors.reset}\n`);
      console.log(`  Use the exact market slug for the position you hold (e.g. Down):`);
      [...slugTimestamps].sort((a, b) => b - a).slice(0, 5).forEach((ts) => {
        console.log(`    npm run redeem -- --slug btc-updown-15m-${ts}`);
      });
      console.log(`  Payout is in USDC.e on Polygon. If one slug fails, try another.\n`);
    }
  } else {
    console.log(`${colors.yellow}No trades returned from CLOB API.${colors.reset}`);
    console.log(`${colors.cyan}You can still verify history here:${colors.reset}\n`);
  }

  console.log(`${colors.bright}Where to check your trade history and payouts:${colors.reset}\n`);
  console.log(`  1. PolygonScan (on-chain):`);
  console.log(`     https://polygonscan.com/address/${address}`);
  console.log(`     → Check "Token Transfers" for USDC and any CTF/outcome tokens.\n`);
  console.log(`  2. Polymarket portfolio & history:`);
  console.log(`     https://polymarket.com/portfolio`);
  console.log(`     → Positions, orders, and redemption status.\n`);

  console.log(`${colors.cyan}Why your wallet might show little or no USDC:${colors.reset}`);
  console.log(`  • You placed Up + Down in the same market → one side wins, one loses.`);
  console.log(`  • Winning shares are redeemed to USDC (often automatic).`);
  console.log(`  • If you see $0: redemption can be delayed, or you may need to claim on Polymarket.`);
  console.log(`  • Check PolygonScan for incoming USDC after the market resolved.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
