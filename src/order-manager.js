/**
 * Order Manager - Handles live trading orders on Polymarket CLOB
 *
 * This module manages order placement, balance checking, and allowance management
 * for live trading on Polymarket using the CLOB API.
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import { webcrypto as nodeWebcrypto } from 'crypto';
import fetch from 'node-fetch';
import config from '../config/index.js';

// Ensure Web Crypto API is available for @polymarket/clob-client
// Some Node environments don't expose globalThis.crypto by default
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  // nodeWebcrypto provides a compatible Web Crypto implementation
  // eslint-disable-next-line no-global-assign
  globalThis.crypto = nodeWebcrypto;
}

// USDC contract addresses on Polygon
// Bridged USDC.e (from Ethereum)
const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
// Native USDC (Polygon native)
const USDC_NATIVE_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
// Default to bridged USDC.e (most common)
const USDC_ADDRESS = USDC_E_ADDRESS;
// CTF Exchange contract address (Polymarket)
const CTF_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
// CTF contract for redemption (redeemPositions)
const CTF_REDEEM_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const REDEEM_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
];

class OrderManager {
  constructor(privateKey, options = {}) {
    if (!privateKey) {
      throw new Error('Private key is required');
    }

    this.privateKey = privateKey;
    this.options = {
      rpcUrl: options.rpcUrl || config.wallet.rpcUrl || 'https://polygon-rpc.com',
      dryRun: options.dryRun !== undefined ? options.dryRun : true,
      verbose: options.verbose || false,
      ...options
    };

    this.provider = null;
    this.signer = null;
    this.address = null; // Wallet address (set during initialization)
    this.clobClientL1 = null; // L1 client for API key creation
    this.clobClientL2 = null; // L2 client for order placement
    this.apiCreds = null;
    this.isInitialized = false;

    // Statistics tracking
    this.stats = {
      ordersPlaced: 0,
      ordersFilled: 0,
      ordersCancelled: 0,
      ordersFailed: 0,
      totalVolume: 0
    };
  }

  /**
   * Initialize the OrderManager
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      if (this.options.verbose) {
        console.log('🔐 Initializing Order Manager (EOA Mode)...');
      }

      // Setup ethers provider and signer
      this.provider = new ethers.providers.JsonRpcProvider(this.options.rpcUrl);
      this.signer = new ethers.Wallet(this.privateKey, this.provider);

      const host = config.api.clobUrl || 'https://clob.polymarket.com';
      const chainId = 137; // Polygon mainnet

      // Initialize L1 client (for API key creation)
      this.clobClientL1 = new ClobClient(host, chainId, this.signer);

      // Create or derive API credentials for L2 authentication
      if (this.options.verbose) {
        console.log('   Creating/deriving API credentials...');
      }

      this.apiCreds = await this.clobClientL1.createOrDeriveApiKey();

      if (this.options.verbose) {
        console.log('   ✅ API credentials obtained');
      }

      // Initialize L2 client (for order placement)
      // signatureType: 0 = EOA (Externally Owned Account)
      this.clobClientL2 = new ClobClient(
        host,
        chainId,
        this.signer,
        this.apiCreds,
        0, // signatureType: EOA
        undefined // funderAddress (not needed for EOA)
      );

      // Verify connection
      const address = await this.signer.getAddress();
      
      // Store address for external scripts (e.g., set-allowance.js)
      // Note: signer.address is read-only, so we store it separately
      this.address = address;
      
      if (this.options.verbose) {
        console.log('✅ Order Manager initialized successfully');
        console.log(`   Wallet: ${address}`);
        console.log(`   Mode: ${this.options.dryRun ? 'DRY RUN (Test)' : 'LIVE'}`);
      }

      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize OrderManager: ${error.message}`);
    }
  }

  /**
   * Get wallet balance and USDC allowance
   * @returns {Promise<Object>} Balance information
   */
  async getBalance() {
    await this._ensureInitialized();

    try {
      const address = await this.signer.getAddress();

      // Verify network
      const network = await this.provider.getNetwork();
      if (this.options.verbose) {
        console.log(`   Network: ${network.name} (Chain ID: ${network.chainId})`);
        console.log(`   RPC URL: ${this.options.rpcUrl}`);
        console.log(`   Checking balance for: ${address}`);
      }

      // Verify we're on Polygon mainnet (chainId 137)
      if (network.chainId !== 137) {
        throw new Error(`Wrong network! Expected Polygon mainnet (137), got chainId ${network.chainId}`);
      }

      // Check native MATIC balance to verify RPC connection
      const maticBalance = await this.provider.getBalance(address);
      if (this.options.verbose) {
        console.log(`   Native MATIC balance: ${ethers.utils.formatEther(maticBalance)} MATIC`);
      }

      // Check both USDC contracts (bridged USDC.e and native USDC)
      const usdcContracts = [
        { address: USDC_E_ADDRESS, name: 'USDC.e (bridged)' },
        { address: USDC_NATIVE_ADDRESS, name: 'USDC (native)' }
      ];

      let usdcBalance = 0;
      let usdcAllowance = 0;
      let activeUsdcAddress = null;
      let activeUsdcName = null;

      for (const usdcInfo of usdcContracts) {
        const usdcCode = await this.provider.getCode(usdcInfo.address);
        if (usdcCode === '0x' || usdcCode === '0x0') {
          if (this.options.verbose) {
            console.log(`   ${usdcInfo.name} contract not found at ${usdcInfo.address}`);
          }
          continue;
        }

        const usdcContract = new ethers.Contract(
          usdcInfo.address,
          [
            'function balanceOf(address) view returns (uint256)',
            'function decimals() view returns (uint8)',
            'function allowance(address owner, address spender) view returns (uint256)'
          ],
          this.provider
        );

        const balance = await usdcContract.balanceOf(address);
        const decimals = await usdcContract.decimals();
        const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, decimals));

        if (this.options.verbose) {
          console.log(`   ${usdcInfo.name} balance: $${balanceFormatted.toFixed(6)}`);
        }

        // Use the contract with the highest balance
        if (balanceFormatted > usdcBalance) {
          usdcBalance = balanceFormatted;
          activeUsdcAddress = usdcInfo.address;
          activeUsdcName = usdcInfo.name;

          // Get allowance from the active contract
          const allowance = await usdcContract.allowance(address, CTF_EXCHANGE_ADDRESS);
          usdcAllowance = parseFloat(ethers.utils.formatUnits(allowance, decimals));

          if (this.options.verbose) {
            console.log(`   Using ${usdcInfo.name} (balance: $${balanceFormatted.toFixed(6)})`);
            console.log(`   Raw balance (wei): ${balance.toString()}`);
            console.log(`   Decimals: ${decimals}`);
            console.log(`   Raw allowance (wei): ${allowance.toString()}`);
            console.log(`   Formatted allowance: $${usdcAllowance.toFixed(6)}`);
          }
        }
      }

      if (!activeUsdcAddress) {
        throw new Error('No USDC contract found. Check network connection.');
      }

      if (this.options.verbose) {
        console.log(`   Active USDC: ${activeUsdcName} at ${activeUsdcAddress}`);
      }

      return {
        address,
        usdc: usdcBalance,
        allowance: usdcAllowance,
        usdcContract: activeUsdcAddress,
        usdcType: activeUsdcName
      };
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  /**
   * Set USDC allowance for the CTF Exchange contract
   * @param {string} amount - Amount in USDC (e.g., '1000000' for 1M USDC)
   * @returns {Promise<boolean>} Success status
   */
  async setAllowance(amount = '1000000') {
    await this._ensureInitialized();

    try {
      const address = await this.signer.getAddress();
      
      // Get balance to determine which USDC contract to use
      const balanceInfo = await this.getBalance();
      const usdcContractAddress = balanceInfo.usdcContract || USDC_ADDRESS;
      
      const usdcContract = new ethers.Contract(
        usdcContractAddress,
        [
          'function approve(address spender, uint256 amount) returns (bool)',
          'function decimals() view returns (uint8)'
        ],
        this.signer
      );

      const decimals = await usdcContract.decimals();
      const amountWei = ethers.utils.parseUnits(amount, decimals);

      if (this.options.verbose) {
        console.log(`\n📝 Setting USDC allowance...`);
        console.log(`   USDC Contract: ${balanceInfo.usdcType || 'USDC'} at ${usdcContractAddress}`);
        console.log(`   Amount: $${amount} USDC`);
        console.log(`   Spender: ${CTF_EXCHANGE_ADDRESS}`);
      }

      if (this.options.dryRun) {
        if (this.options.verbose) {
          console.log('   ⚠️  DRY RUN: Transaction would be sent (not submitted)');
        }
        return true;
      }

      // Fetch current gas prices for Polygon
      if (this.options.verbose) {
        console.log('   Fetching current gas prices...');
      }
      
      const feeData = await this.provider.getFeeData();
      
      // Set appropriate gas prices for Polygon
      // Use maxFeePerGas and maxPriorityFeePerGas for EIP-1559 transactions
      const gasOverrides = {};
      
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        // EIP-1559 transaction
        // Ensure minimum 30 gwei for Polygon (25 gwei minimum + buffer)
        const minPriorityFee = ethers.utils.parseUnits('30', 'gwei');
        const minMaxFee = ethers.utils.parseUnits('35', 'gwei');
        
        gasOverrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.gt(minPriorityFee) 
          ? feeData.maxPriorityFeePerGas 
          : minPriorityFee;
        gasOverrides.maxFeePerGas = feeData.maxFeePerGas.gt(minMaxFee)
          ? feeData.maxFeePerGas
          : minMaxFee;
          
        if (this.options.verbose) {
          console.log(`   Max Priority Fee: ${ethers.utils.formatUnits(gasOverrides.maxPriorityFeePerGas, 'gwei')} gwei`);
          console.log(`   Max Fee: ${ethers.utils.formatUnits(gasOverrides.maxFeePerGas, 'gwei')} gwei`);
        }
      } else if (feeData.gasPrice) {
        // Legacy transaction
        const minGasPrice = ethers.utils.parseUnits('30', 'gwei');
        gasOverrides.gasPrice = feeData.gasPrice.gt(minGasPrice)
          ? feeData.gasPrice
          : minGasPrice;
          
        if (this.options.verbose) {
          console.log(`   Gas Price: ${ethers.utils.formatUnits(gasOverrides.gasPrice, 'gwei')} gwei`);
        }
      }

      const tx = await usdcContract.approve(CTF_EXCHANGE_ADDRESS, amountWei, gasOverrides);
      
      if (this.options.verbose) {
        console.log(`   Transaction hash: ${tx.hash}`);
        console.log(`   Waiting for confirmation...`);
      }

      await tx.wait();
      
      if (this.options.verbose) {
        console.log('   ✅ Allowance set successfully');
      }

      return true;
    } catch (error) {
      throw new Error(`Failed to set allowance: ${error.message}`);
    }
  }

  /**
   * Place a buy order
   * @param {string} tokenId - Token ID for the outcome
   * @param {number} price - Price per share (0-1)
   * @param {number} investmentAmount - Amount to invest in USDC
   * @param {Object} marketInfo - Market information (tickSize, negRisk)
   * @returns {Promise<Object>} Order result
   */
  async placeBuyOrder(tokenId, price, investmentAmount, marketInfo = {}) {
    await this._ensureInitialized();

    try {
      // Validate inputs
      if (!tokenId) {
        return { success: false, error: 'Token ID is required' };
      }
      if (price <= 0 || price >= 1) {
        return { success: false, error: 'Price must be between 0 and 1' };
      }
      if (investmentAmount <= 0) {
        return { success: false, error: 'Investment amount must be positive' };
      }

      // Round price to tick size
      const tickSize = marketInfo.tickSize || '0.01';
      const tickSizeNum = parseFloat(tickSize);
      const roundedPrice = Math.round(price / tickSizeNum) * tickSizeNum;

      // Calculate size (number of shares)
      const size = investmentAmount / roundedPrice;

      // Use exact investment amount configured (no validation, no adjustment)
      const actualOrderValue = investmentAmount;

      if (this.options.verbose) {
        console.log(`\n📊 Placing BUY order:`);
        console.log(`   Token ID: ${tokenId}`);
        console.log(`   Price: $${roundedPrice.toFixed(4)}`);
        console.log(`   Size: ${size.toFixed(4)} shares`);
        console.log(`   Order Value: $${actualOrderValue.toFixed(4)}`);
        console.log(`   Investment: $${investmentAmount.toFixed(2)}`);
      }

      // Check balance asynchronously (don't block order placement)
      this.getBalance().then(balance => {
        if (balance.usdc < actualOrderValue) {
          console.warn(`⚠️  Low balance warning: $${balance.usdc.toFixed(2)} < $${actualOrderValue.toFixed(2)} (order may fail)`);
        }
        if (balance.allowance < actualOrderValue) {
          console.warn(`⚠️  Low allowance warning: $${balance.allowance.toFixed(2)} < $${actualOrderValue.toFixed(2)} (run setAllowance if order fails)`);
        }
      }).catch(err => {
        // Silently ignore balance check errors to not block trading
        if (this.options.verbose) {
          console.log(`   ⚠️  Balance check failed (non-blocking): ${err.message}`);
        }
      });

      if (this.options.dryRun) {
        const fakeOrderID = `dry-run-${Date.now()}`;
        if (this.options.verbose) {
          console.log(`   ⚠️  DRY RUN: Order would be placed (not submitted)`);
          console.log(`   Simulated Order ID: ${fakeOrderID}`);
        }

        this.stats.ordersPlaced++;
        this.stats.totalVolume += actualOrderValue;

        return {
          success: true,
          orderID: fakeOrderID,
          price: roundedPrice,
          size: size,
          status: 'DRY_RUN'
        };
      }

      // Create and post market order using CLOB client (FOK = Fill or Kill, acts like market order)
      const result = await this.clobClientL2.createAndPostMarketOrder(
        {
          tokenID: tokenId,
          side: Side.BUY,
          amount: actualOrderValue // For BUY orders, amount is in USD
        },
        {
          tickSize: tickSize,
          negRisk: marketInfo.negRisk || false
        },
        OrderType.FOK // Fill or Kill - immediate execution like market order
      );

      if (!result.success) {
        this.stats.ordersFailed++;
        // Extract error message from API response
        let errorMessage = 'Order placement failed';
        if (result.errorMsg) {
          errorMessage = result.errorMsg;
        } else if (result.error) {
          errorMessage = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
        } else if (result.data && result.data.error) {
          errorMessage = result.data.error;
        }
        
        if (this.options.verbose) {
          console.error(`   ❌ API Error: ${errorMessage}`);
        }
        
        return {
          success: false,
          error: errorMessage
        };
      }

      this.stats.ordersPlaced++;
      this.stats.totalVolume += actualOrderValue;

      if (this.options.verbose) {
        console.log(`   ✅ Order submitted successfully`);
        console.log(`   Order ID: ${result.orderID}`);
        console.log(`   Status: ${result.status}`);
      }

      return {
        success: true,
        orderID: result.orderID,
        price: roundedPrice,
        size: size,
        actualInvestment: actualOrderValue, // Same as requested investment (no adjustments)
        
        status: result.status || 'LIVE'
      };
    } catch (error) {
      this.stats.ordersFailed++;
      const errorMsg = error.message || 'Unknown error';
      
      if (this.options.verbose) {
        console.error(`   ❌ Order failed: ${errorMsg}`);
      }

      return {
        success: false,
        error: errorMsg
      };
    }
  }

  /**
   * Place a sell order
   * @param {string} tokenId - Token ID for the outcome
   * @param {number} price - Price per share (0-1)
   * @param {number} size - Number of shares to sell
   * @param {Object} marketInfo - Market information (tickSize, negRisk)
   * @returns {Promise<Object>} Order result
   */
  async placeSellOrder(tokenId, price, size, marketInfo = {}) {
    await this._ensureInitialized();

    try {
      // Validate inputs
      if (!tokenId) {
        return { success: false, error: 'Token ID is required' };
      }
      if (price <= 0 || price >= 1) {
        return { success: false, error: 'Price must be between 0 and 1' };
      }
      if (size <= 0) {
        return { success: false, error: 'Size must be positive' };
      }

      // Round price to tick size
      const tickSize = marketInfo.tickSize || '0.01';
      const tickSizeNum = parseFloat(tickSize);
      const roundedPrice = Math.round(price / tickSizeNum) * tickSizeNum;
      const expectedProceeds = roundedPrice * size;

      if (this.options.verbose) {
        console.log(`\n📊 Placing SELL order:`);
        console.log(`   Token ID: ${tokenId}`);
        console.log(`   Price: $${roundedPrice.toFixed(4)}`);
        console.log(`   Size: ${size.toFixed(4)} shares`);
        console.log(`   Expected proceeds: $${expectedProceeds.toFixed(2)}`);
      }

      if (this.options.dryRun) {
        const fakeOrderID = `dry-run-${Date.now()}`;
        if (this.options.verbose) {
          console.log(`   ⚠️  DRY RUN: Order would be placed (not submitted)`);
          console.log(`   Simulated Order ID: ${fakeOrderID}`);
        }

        this.stats.ordersPlaced++;
        this.stats.totalVolume += expectedProceeds;

        return {
          success: true,
          orderID: fakeOrderID,
          status: 'DRY_RUN'
        };
      }

      // Create and post market order using CLOB client (FOK = Fill or Kill, acts like market order)
      const result = await this.clobClientL2.createAndPostMarketOrder(
        {
          tokenID: tokenId,
          side: Side.SELL,
          amount: size // For SELL orders, amount is in shares
        },
        {
          tickSize: tickSize,
          negRisk: marketInfo.negRisk || false
        },
        OrderType.FOK // Fill or Kill - immediate execution like market order
      );

      if (!result.success) {
        this.stats.ordersFailed++;
        return {
          success: false,
          error: result.errorMsg || 'Order placement failed'
        };
      }

      this.stats.ordersPlaced++;
      this.stats.totalVolume += expectedProceeds;

      if (this.options.verbose) {
        console.log(`   ✅ Order submitted successfully`);
        console.log(`   Order ID: ${result.orderID}`);
        console.log(`   Status: ${result.status}`);
      }

      return {
        success: true,
        orderID: result.orderID,
        status: result.status || 'LIVE'
      };
    } catch (error) {
      this.stats.ordersFailed++;
      const errorMsg = error.message || 'Unknown error';
      
      if (this.options.verbose) {
        console.error(`   ❌ Order failed: ${errorMsg}`);
      }

      return {
        success: false,
        error: errorMsg
      };
    }
  }

  /**
   * Get open orders
   * @returns {Promise<Array>} Array of open orders
   */
  async getOpenOrders() {
    await this._ensureInitialized();

    try {
      if (this.options.dryRun) {
        // In dry run mode, return empty array
        return [];
      }

      const orders = await this.clobClientL2.getOpenOrders();

      return orders.map(order => {
        // Calculate remaining size (original_size - size_matched)
        // Handle both string and number formats from API
        const originalSize = parseFloat(order.original_size || order.size || '0');
        const matchedSize = parseFloat(order.size_matched || '0');
        const remainingSize = originalSize - matchedSize;

        return {
          orderID: order.id,
          side: order.side,
          price: parseFloat(order.price),
          size: remainingSize > 0 ? remainingSize : originalSize, // Use remaining or fallback to original
          status: order.status || 'UNKNOWN',
          tokenId: order.asset_id || order.token_id
        };
      });
    } catch (error) {
      if (this.options.verbose) {
        console.error(`Failed to get open orders: ${error.message}`);
      }
      return [];
    }
  }

  /**
   * Get user positions/balances from CLOB
   * Note: The CLOB client doesn't have a direct getUserBalances method.
   * This function uses open orders to infer positions.
   * @returns {Promise<Array>} Array of user positions (from open orders)
   */
  async getUserPositions() {
    await this._ensureInitialized();

    try {
      if (this.options.dryRun) {
        return [];
      }

      // Get open orders to see what tokens we have positions in
      const openOrders = await this.getOpenOrders();
      
      // Group by token ID and calculate net position
      const positionsMap = new Map();
      
      for (const order of openOrders) {
        const tokenId = order.tokenId;
        if (!tokenId) continue;
        
        if (!positionsMap.has(tokenId)) {
          positionsMap.set(tokenId, {
            tokenId,
            totalSize: 0,
            buyOrders: 0,
            sellOrders: 0,
            avgPrice: 0
          });
        }
        
        const pos = positionsMap.get(tokenId);
        if (order.side === 'BUY') {
          pos.totalSize += order.size;
          pos.buyOrders++;
          pos.avgPrice = (pos.avgPrice * (pos.buyOrders - 1) + order.price) / pos.buyOrders;
        } else if (order.side === 'SELL') {
          pos.totalSize -= order.size;
          pos.sellOrders++;
        }
      }
      
      // Convert to array and filter out zero positions
      return Array.from(positionsMap.values())
        .filter(pos => pos.totalSize > 0)
        .map(pos => ({
          tokenId: pos.tokenId,
          balance: pos.totalSize,
          available: pos.totalSize,
          locked: 0,
          avgPrice: pos.avgPrice
        }));
    } catch (error) {
      if (this.options.verbose) {
        console.error(`Failed to get user positions: ${error.message}`);
      }
      return [];
    }
  }

  /**
   * Get redeemable condition IDs from Polymarket Data-API (one request, scalable).
   * @returns {Promise<Array<{conditionId: string, slug?: string}>>}
   * @private
   */
  async _getRedeemableConditionIdsFromDataApi() {
    const dataApiUrl = config.api.dataApiUrl || 'https://data-api.polymarket.com';
    const url = `${dataApiUrl}/positions?user=${encodeURIComponent(this.address)}&redeemable=true&limit=500`;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const positions = await res.json();
      if (!Array.isArray(positions)) return [];
      const seen = new Set();
      const out = [];
      for (const p of positions) {
        if (!p.redeemable || !p.conditionId) continue;
        
        // Skip positions with zero balance (already redeemed or empty)
        const size = parseFloat(p.size || p.balance || 0);
        if (size <= 0) continue;
        
        const cid = p.conditionId.startsWith('0x') ? p.conditionId : `0x${p.conditionId}`;
        if (cid.length !== 66 || seen.has(cid)) continue;
        seen.add(cid);
        out.push({ conditionId: cid, slug: p.slug || p.eventSlug || null });
      }
      return out;
    } catch (e) {
      if (this.options.verbose) console.error('Data-API redeemable positions:', e.message);
      return [];
    }
  }

  /**
   * Fallback: get redeemable condition IDs from trade history + Gamma (btc-updown-15m).
   * Filters out positions with zero balance to avoid duplicate redemptions.
   * @returns {Promise<Array<{conditionId: string, slug: string}>>}
   * @private
   */
  async _getRedeemableConditionIdsFromTradeHistory() {
    let trades = [];
    try {
      if (typeof this.clobClientL2?.getTrades === 'function') {
        trades = (await this.clobClientL2.getTrades({ maker_address: this.address })) || [];
      }
    } catch (_) {}
    if (trades.length === 0) {
      try {
        const res = await fetch(`${config.api.clobUrl}/data/trades?maker=${this.address}`);
        if (res.ok) {
          const data = await res.json();
          trades = Array.isArray(data) ? data : (data.trades || []);
        }
      } catch (_) {}
    }
    const timestamps = new Set();
    for (const t of trades) {
      const time = t.match_time || t.last_update || '';
      if (time && Number(time)) {
        timestamps.add(Number(time));
        timestamps.add(Math.floor(Number(time) / 900) * 900);
      }
    }
    const slugs = [...timestamps].sort((a, b) => b - a).slice(0, 30).map(ts => `btc-updown-15m-${ts}`);
    
    // CTF contract ABI for balanceOf
    const CTF_ABI = ['function balanceOf(address account, uint256 id) view returns (uint256)'];
    const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
    const ctfContract = new ethers.Contract(CTF_ADDRESS, CTF_ABI, this.provider);
    
    const out = [];
    for (const slug of slugs) {
      try {
        const res = await fetch(`${config.api.gammaUrl}/events?slug=${slug}`);
        if (!res.ok) continue;
        const data = await res.json();
        const market = data?.[0]?.markets?.[0];
        if (!market || !(market.closed === true || market.umaResolutionStatus === 'resolved')) continue;
        const cid = market.conditionId || market.condition_id;
        if (!cid) continue;
        const conditionId = cid.startsWith('0x') ? cid : `0x${cid}`;
        if (conditionId.length !== 66) continue;
        
        // Check if user has any balance in outcome tokens before adding to list
        // Compute token IDs for both outcomes (indexSets [1, 2])
        let hasBalance = false;
        try {
          const parentCollectionId = ethers.constants.HashZero;
          // For index set 1 (outcome 0)
          const tokenId1 = ethers.utils.solidityKeccak256(
            ['bytes32', 'uint256'],
            [ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], [parentCollectionId, conditionId]), 1]
          );
          // For index set 2 (outcome 1)
          const tokenId2 = ethers.utils.solidityKeccak256(
            ['bytes32', 'uint256'],
            [ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], [parentCollectionId, conditionId]), 2]
          );
          
          const [balance1, balance2] = await Promise.all([
            ctfContract.balanceOf(this.address, tokenId1),
            ctfContract.balanceOf(this.address, tokenId2)
          ]);
          
          hasBalance = balance1.gt(0) || balance2.gt(0);
        } catch (balErr) {
          // If balance check fails, skip this position to be safe
          if (this.options.verbose) console.log(`⚠️  Skipping ${slug}: couldn't check balance (${balErr.message})`);
          continue;
        }
        
        if (hasBalance) {
          out.push({ conditionId, slug });
        } else if (this.options.verbose) {
          console.log(`⚠️  Skipping ${slug}: already redeemed (zero balance)`);
        }
      } catch (_) {}
    }
    return out;
  }

  /**
   * Redeem all redeemable positions (Data-API first, then trade-history fallback).
   * Sends one on-chain redeem tx per conditionId. Used when AUTO_REDEEM_ENABLED=true.
   * @returns {Promise<{redeemed: number, failed: number}>}
   */
  async redeemRedeemablePositions() {
    await this._ensureInitialized();
    let list = await this._getRedeemableConditionIdsFromDataApi();
    if (this.options.verbose && list.length > 0) {
      console.log(`📊 Data-API found ${list.length} redeemable position(s)`);
    }
    if (list.length === 0) {
      list = await this._getRedeemableConditionIdsFromTradeHistory();
      if (this.options.verbose && list.length > 0) {
        console.log(`📊 Trade history fallback found ${list.length} redeemable position(s)`);
      }
    }
    if (list.length === 0) {
      if (this.options.verbose) console.log('📊 No redeemable positions found');
      return { redeemed: 0, failed: 0 };
    }

    const iface = new ethers.utils.Interface(REDEEM_ABI);
    const parentCollectionId = ethers.constants.HashZero;
    const indexSets = [1, 2];
    let feeData;
    try {
      feeData = await this.provider.getFeeData();
    } catch (e) {
      if (this.options.verbose) console.error('getFeeData:', e.message);
      return { redeemed: 0, failed: list.length };
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

    let redeemed = 0;
    let failed = 0;
    for (const { conditionId, slug } of list) {
      const displayName = slug || `${conditionId.slice(0, 10)}...${conditionId.slice(-8)}`;
      try {
        if (this.options.verbose) console.log(`💰 Redeeming: ${displayName}`);
        const data = iface.encodeFunctionData('redeemPositions', [
          USDC_ADDRESS,
          parentCollectionId,
          conditionId,
          indexSets,
        ]);
        const tx = await this.signer.sendTransaction({
          to: CTF_REDEEM_ADDRESS,
          data,
          value: ethers.constants.Zero,
          ...gasOverrides,
        });
        await tx.wait();
        redeemed++;
        if (this.options.verbose) console.log(`✅ Redeemed ${displayName}: ${tx.hash}`);
      } catch (err) {
        failed++;
        // Check if error is "nothing to redeem" or actual failure
        const isEmptyPosition = err.message?.includes('revert') || err.message?.includes('Nothing to redeem');
        if (this.options.verbose) {
          if (isEmptyPosition) {
            console.log(`⚠️  ${displayName}: position already redeemed or empty`);
          } else {
            console.error(`❌ Redeem failed ${displayName}:`, err.message);
          }
        }
      }
    }
    return { redeemed, failed };
  }

  /**
   * Get statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    const totalOrders = this.stats.ordersPlaced + this.stats.ordersFailed;
    const successRate = totalOrders > 0
      ? ((this.stats.ordersPlaced / totalOrders) * 100).toFixed(1)
      : '0.0';

    return {
      ordersPlaced: this.stats.ordersPlaced,
      ordersFilled: this.stats.ordersFilled,
      ordersCancelled: this.stats.ordersCancelled,
      ordersFailed: this.stats.ordersFailed,
      totalVolume: this.stats.totalVolume,
      successRate: successRate
    };
  }

  /**
   * Ensure OrderManager is initialized
   * @private
   */
  async _ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
}

export default OrderManager;
