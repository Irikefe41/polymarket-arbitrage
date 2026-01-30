/**
 * Redeem winning positions from a resolved Polymarket (CTF) condition.
 *
 * Calls the CTF contract's redeemPositions so you receive USDC for
 * winning outcome tokens. Uses your .env wallet and Polygon RPC.
 *
 * Usage:
 *   npm run redeem
 *   npm run redeem -- --slug btc-updown-15m-1769501700
 *   npm run redeem -- --conditionId 0x...
 *   npm run redeem -- --outcome BTCDown --qty 16659000   (uses default market ~2 days ago)
 */

import { ethers } from 'ethers';
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

// CTF contract (redeem) – Polygon Mainnet
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
// USDC.e on Polygon (collateral)
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

const GAMMA_API = config.api.gammaUrl;

const REDEEM_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
];

function encodeRedeemData(collateralToken, parentCollectionId, conditionId, indexSets) {
  const iface = new ethers.utils.Interface(REDEEM_ABI);
  return iface.encodeFunctionData('redeemPositions', [
    collateralToken,
    parentCollectionId,
    conditionId,
    indexSets,
  ]);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let slug = null;
  let conditionId = null;
  let outcome = null;
  let qty = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slug' && args[i + 1]) {
      slug = args[i + 1];
      i++;
    } else if (args[i] === '--conditionId' && args[i + 1]) {
      conditionId = args[i + 1];
      i++;
    } else if (args[i] === '--outcome' && args[i + 1]) {
      outcome = args[i + 1];
      i++;
    } else if (args[i] === '--qty' && args[i + 1]) {
      qty = args[i + 1];
      i++;
    }
  }
  return { slug, conditionId, outcome, qty };
}

async function getConditionIdFromSlug(slug) {
  const res = await fetch(`${GAMMA_API}/events?slug=${slug}`);
  if (!res.ok) throw new Error(`Gamma API: ${res.status}`);
  const data = await res.json();
  if (!data || data.length === 0) throw new Error(`No event for slug: ${slug}`);
  const market = data[0].markets?.[0];
  if (!market) throw new Error(`No market for slug: ${slug}`);
  const cid = market.conditionId || market.condition_id;
  if (!cid) throw new Error(`No conditionId for slug: ${slug}`);
  return cid.startsWith('0x') ? cid : `0x${cid}`;
}

async function main() {
  console.log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║   Redeem CTF Positions                ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════╝${colors.reset}\n`);

  const { slug, conditionId: cliConditionId, outcome, qty } = parseArgs();

  if (!config.wallet.privateKey) {
    console.error(`${colors.red}❌ POLYGON_PRIVATE_KEY not set in .env${colors.reset}\n`);
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(config.wallet.rpcUrl);
  const signer = new ethers.Wallet(config.wallet.privateKey, provider);
  const address = await signer.getAddress();

  let conditionId = cliConditionId;
  if (!conditionId) {
    if (slug) {
      console.log(`${colors.cyan}Fetching conditionId for slug: ${slug}${colors.reset}\n`);
      conditionId = await getConditionIdFromSlug(slug);
    } else {
      // Default: market from ~2 days ago (e.g. when user only has outcome + qty)
      const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 24 * 3600;
      const timestamp = Math.floor(twoDaysAgo / 900) * 900;
      const defaultSlug = `btc-updown-15m-${timestamp}`;
      if (outcome || qty) {
        const qtyDisplay = qty ? (Number(qty) / 1e6).toFixed(6) : null;
        console.log(`${colors.cyan}Position:${colors.reset} ${outcome || '—'}${qtyDisplay != null ? `, qty: ${qtyDisplay} (raw ${qty})` : ''}`);
      }
      console.log(`${colors.yellow}No --slug or --conditionId. Using market from ~2 days ago: ${defaultSlug}${colors.reset}\n`);
      try {
        conditionId = await getConditionIdFromSlug(defaultSlug);
      } catch (e) {
        console.error(`${colors.red}${e.message}${colors.reset}`);
        console.log(`\n${colors.cyan}Usage:${colors.reset}`);
        console.log(`  npm run redeem -- --slug btc-updown-15m-<timestamp>`);
        console.log(`  npm run redeem -- --conditionId 0x...`);
        console.log(`  npm run redeem -- --outcome BTCDown --qty 16659000  (uses default market ~2 days ago)\n`);
        process.exit(1);
      }
    }
  }

  if (!conditionId.startsWith('0x')) {
    conditionId = '0x' + conditionId;
  }
  if (conditionId.length !== 66) {
    console.error(`${colors.red}conditionId must be 32 bytes (66 hex chars including 0x)${colors.reset}\n`);
    process.exit(1);
  }

  const parentCollectionId = ethers.constants.HashZero; // "0x0" for Polymarket
  const indexSets = [1, 2]; // binary Up/Down

  console.log(`${colors.cyan}Wallet:${colors.reset} ${address}`);
  console.log(`${colors.cyan}CTF contract:${colors.reset} ${CTF_ADDRESS}`);
  console.log(`${colors.cyan}Collateral (USDC):${colors.reset} ${USDC_ADDRESS}`);
  console.log(`${colors.cyan}Condition ID:${colors.reset} ${conditionId}`);
  console.log(`${colors.cyan}Index sets:${colors.reset} [1, 2]\n`);

  // Optional: dry run
  if (process.env.DRY_RUN === 'true') {
    console.log(`${colors.yellow}DRY_RUN: would call redeemPositions (no tx sent)${colors.reset}\n`);
    return;
  }

  const feeData = await provider.getFeeData();
  const gasOverrides = {};
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    const minPri = ethers.utils.parseUnits('30', 'gwei');
    const minMax = ethers.utils.parseUnits('35', 'gwei');
    gasOverrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.gt(minPri) ? feeData.maxPriorityFeePerGas : minPri;
    gasOverrides.maxFeePerGas = feeData.maxFeePerGas.gt(minMax) ? feeData.maxFeePerGas : minMax;
  } else if (feeData.gasPrice) {
    gasOverrides.gasPrice = feeData.gasPrice.lt(ethers.utils.parseUnits('30', 'gwei'))
      ? ethers.utils.parseUnits('30', 'gwei')
      : feeData.gasPrice;
  }

  const redeemTx = {
    to: CTF_ADDRESS,
    data: encodeRedeemData(USDC_ADDRESS, parentCollectionId, conditionId, indexSets),
    value: ethers.constants.Zero,
    ...gasOverrides,
  };

  console.log(`${colors.yellow}Sending redeemPositions transaction...${colors.reset}\n`);

  try {
    const response = await signer.sendTransaction(redeemTx);
    console.log(`${colors.green}Tx hash: ${response.hash}${colors.reset}`);
    console.log(`Waiting for confirmation...`);
    await response.wait();
    console.log(`${colors.green}✓ Redeem confirmed.${colors.reset}`);
    console.log(`\n${colors.cyan}Check balance:${colors.reset}`);
    console.log(`  • Payout is in ${colors.bright}USDC.e (bridged)${colors.reset}: ${USDC_ADDRESS}`);
    console.log(`  • On Polygon: view token "USDC.e" or "Bridged USDC", not native USDC.`);
    console.log(`\n${colors.yellow}If your balance did not increase:${colors.reset}`);
    console.log(`  • The conditionId redeemed (${conditionId}) may not match the market where you hold BTCDown.`);
    console.log(`  • Or that market resolved "Up", so Down shares pay $0. Redeem the correct market with:`);
    console.log(`    npm run redeem -- --slug btc-updown-15m-<timestamp>`);
    console.log(`  • Get <timestamp> from Polymarket or your trade history (e.g. npm run trade-history).\n`);
  } catch (err) {
    console.error(`${colors.red}Redeem failed: ${err.message}${colors.reset}\n`);
    if (err.message && err.message.includes('no positions')) {
      console.log(`${colors.yellow}You may have no (redeemable) positions for this condition, or it may not be resolved yet.${colors.reset}\n`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
