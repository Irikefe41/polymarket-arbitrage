
import config from '../config/index.js';
import OrderManager from '../src/order-manager.js';

async function main() {
    console.log('🚀 Starting USDC Allowance Setup');

    if (!config.wallet.privateKey) {
        console.error('❌ Error: POLYGON_PRIVATE_KEY not found in .env');
        process.exit(1);
    }

    // Initialize Order Manager in LIVE mode (not dry run) to actually send the transaction
    const orderManager = new OrderManager(config.wallet.privateKey, {
        rpcUrl: config.wallet.rpcUrl,
        dryRun: false,
        verbose: true
    });

    try {
        await orderManager.initialize();

        console.log('\n--- Transaction Details ---');
        console.log(`Wallet: ${config.wallet.address || orderManager.address}`);
        console.log('Network: Polygon Mainnet');
        console.log('Token: USDC');
        console.log('---------------------------\n');

        // Set allowance for 1,000,000 USDC (standard amount)
        // This will prompt an on-chain transaction
        const success = await orderManager.setAllowance('1000000');

        if (success) {
            console.log('\n✅ Successfully set USDC allowance!');
            console.log('You are now ready for live trading.');
        } else {
            console.error('\n❌ Failed to set allowance. check your MATIC balance for gas.');
        }
    } catch (error) {
        console.error('\n❌ Error during setup:', error.message);
    }
}

main();
