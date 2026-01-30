/**
 * Auto-redeem: redeem all redeemable positions (scalable).
 *
 * Primary: Polymarket Data-API positions endpoint (one request → all positions
 * with conditionId + redeemable flag). Same approach as production bots.
 * Fallback: trade-history + Gamma slugs if Data-API returns nothing (e.g. EOA).
 *
 * Usage:
 *   npm run auto-redeem
 *   DRY_RUN=true npm run auto-redeem
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

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const DATA_API_URL = process.env.DATA_API_URL || 'https://data-api.polymarket.com';
const GAMMA_API = config.api.gammaUrl;
const CLOB_API = config.api.clobUrl;

const REDEEM_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
];

const CTF_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)'
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

/** Scalable: one API call returns all positions with conditionId + redeemable. */
async function getRedeemableConditionIdsFromDataApi(userAddress) {
  const url = `${DATA_API_URL}/positions?user=${encodeURIComponent(userAddress)}&redeemable=true&limit=500`;
  const res = await fetch(url);
  if (!res.ok) return { conditionIds: [], error: `Data-API ${res.status}` };
  const positions = await res.json();
  if (!Array.isArray(positions)) return { conditionIds: [], error: 'Invalid response' };
  const seen = new Set();
  const conditionIds = [];
  for (const p of positions) {
    if (!p.redeemable || !p.conditionId) continue;
    
    // Skip positions with zero balance (already redeemed or empty)
    const size = parseFloat(p.size || p.balance || 0);
    if (size <= 0) continue;
    
    const cid = p.conditionId.startsWith('0x') ? p.conditionId : `0x${p.conditionId}`;
    if (cid.length !== 66) continue;
    if (seen.has(cid)) continue;
    seen.add(cid);
    conditionIds.push({ conditionId: cid, slug: p.slug || p.eventSlug || cid.slice(0, 18) + '...' });
  }
  return { conditionIds, source: 'data-api' };
}

async function getTrades(address) {
  try {
    const res = await fetch(`${CLOB_API}/data/trades?maker=${address}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.trades || []);
  } catch (e) {
    return [];
  }
}

function getSlugTimestampsFromTrades(trades) {
  const out = new Set();
  for (const t of trades) {
    const time = t.match_time || t.last_update || '';
    if (time && Number(time)) {
      const ts = Number(time);
      out.add(ts);
      out.add(Math.floor(ts / 900) * 900);
    }
  }
  return [...out].sort((a, b) => b - a).slice(0, 30);
}

async function getMarketBySlug(slug) {
  const res = await fetch(`${GAMMA_API}/events?slug=${slug}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.length === 0) return null;
  const market = data[0].markets?.[0];
  return market || null;
}

function isResolved(market) {
  return market && (market.closed === true || market.umaResolutionStatus === 'resolved');
}

function getConditionId(market) {
  const cid = market.conditionId || market.condition_id;
  if (!cid) return null;
  return cid.startsWith('0x') ? cid : `0x${cid}`;
}

/** Fallback when Data-API has no positions (e.g. EOA not indexed). */
async function getRedeemableConditionIdsFromTradeHistory(address, provider) {
  const trades = await getTrades(address);
  const slugTimestamps = getSlugTimestampsFromTrades(trades);
  
  // Create CTF contract instance for balance checking
  const ctfContract = new ethers.Contract(CTF_ADDRESS, CTF_ABI, provider);
  const parentCollectionId = ethers.constants.HashZero;
  
  const result = [];
  for (const ts of slugTimestamps) {
    const slug = `btc-updown-15m-${ts}`;
    const market = await getMarketBySlug(slug);
    if (!market || !isResolved(market)) continue;
    const conditionId = getConditionId(market);
    if (!conditionId || conditionId.length !== 66) continue;
    
    // Check if user has any balance in outcome tokens before adding to list
    let hasBalance = false;
    try {
      const tokenId1 = ethers.utils.solidityKeccak256(
        ['bytes32', 'uint256'],
        [ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], [parentCollectionId, conditionId]), 1]
      );
      const tokenId2 = ethers.utils.solidityKeccak256(
        ['bytes32', 'uint256'],
        [ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], [parentCollectionId, conditionId]), 2]
      );
      
      const [balance1, balance2] = await Promise.all([
        ctfContract.balanceOf(address, tokenId1),
        ctfContract.balanceOf(address, tokenId2)
      ]);
      
      hasBalance = balance1.gt(0) || balance2.gt(0);
    } catch (balErr) {
      // If balance check fails, skip this position to be safe
      console.log(`${colors.yellow}⚠️  Skipping ${slug}: couldn't check balance${colors.reset}`);
      continue;
    }
    
    if (hasBalance) {
      result.push({ conditionId, slug });
    } else {
      console.log(`${colors.yellow}⚠️  Skipping ${slug}: already redeemed (zero balance)${colors.reset}`);
    }
  }
  return { conditionIds: result, source: 'trade-history' };
}

async function main() {
  const dryRun = process.env.DRY_RUN === 'true';

  console.log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║   Auto-Redeem (All Positions)          ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════╝${colors.reset}\n`);

  if (!config.wallet.privateKey) {
    console.error(`${colors.red}❌ POLYGON_PRIVATE_KEY not set in .env${colors.reset}\n`);
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(config.wallet.rpcUrl);
  const signer = new ethers.Wallet(config.wallet.privateKey, provider);
  const address = await signer.getAddress();

  let conditionIds = [];
  let source = '';

  // Try Data-API first
  const dataApi = await getRedeemableConditionIdsFromDataApi(address);
  if (dataApi.conditionIds.length > 0) {
    conditionIds = dataApi.conditionIds;
    source = dataApi.source;
  }

  // Fallback to trade history
  if (conditionIds.length === 0) {
    console.log(`${colors.yellow}Data-API returned no redeemable positions. Using trade-history fallback.${colors.reset}\n`);
    const fallback = await getRedeemableConditionIdsFromTradeHistory(address, provider);
    conditionIds = fallback.conditionIds;
    source = fallback.source;
  }

  if (conditionIds.length === 0) {
    console.log(`${colors.yellow}No redeemable positions found.${colors.reset}\n`);
    return;
  }

  console.log(`${colors.cyan}Wallet:${colors.reset} ${address}`);
  console.log(`${colors.cyan}Source: ${source}. Redeemable: ${conditionIds.length} condition(s).${colors.reset}\n`);

  if (dryRun) {
    conditionIds.forEach(({ conditionId, slug }) => console.log(`  DRY_RUN: ${slug || conditionId.slice(0, 18) + '...'}`));
    console.log(`\nRun without DRY_RUN=true to send transactions.\n`);
    return;
  }

  const parentCollectionId = ethers.constants.HashZero;
  const indexSets = [1, 2];

  let feeData;
  try {
    feeData = await provider.getFeeData();
  } catch (e) {
    console.error(`${colors.red}Failed to get fee data: ${e.message}${colors.reset}\n`);
    process.exit(1);
  }

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

  let ok = 0;
  let fail = 0;
  for (const { conditionId, slug } of conditionIds) {
    const label = slug || conditionId.slice(0, 18) + '...';
    try {
      const tx = {
        to: CTF_ADDRESS,
        data: encodeRedeemData(USDC_ADDRESS, parentCollectionId, conditionId, indexSets),
        value: ethers.constants.Zero,
        ...gasOverrides,
      };
      const response = await signer.sendTransaction(tx);
      await response.wait();
      console.log(`${colors.green}✓ ${label} ${response.hash}${colors.reset}`);
      ok++;
    } catch (err) {
      console.log(`${colors.red}✗ ${label} ${err.message}${colors.reset}`);
      fail++;
    }
  }

  console.log(`\n${colors.cyan}Done.${colors.reset} Redeemed: ${ok}, failed: ${fail}`);
  console.log(`Payout is in USDC.e (${USDC_ADDRESS}) on Polygon.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
