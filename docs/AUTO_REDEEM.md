# Auto-Redeem: No Manual Payout Tracking

## Resolution vs redemption

- **Market resolution** (whether the outcome is Up or Down) is **automatic**. Polymarket uses Chainlink (for BTC 15m markets) and resolves without you doing anything.
- **Redemption** (converting winning outcome tokens into USDC) requires calling the CTF contract. When you trade via the **bot/API** with an EOA wallet, Polymarket does **not** auto-redeem for you—you must trigger redemption.

## How other bots do it (scalable)

Production bots use **Polymarket’s Data-API positions endpoint**:

- **One request**: `GET https://data-api.polymarket.com/positions?user=<address>&redeemable=true&limit=500`
- Response: list of positions with **conditionId**, **redeemable**, **size**, **slug**, etc.
- No trade-history parsing, no guessing slugs, works for **any market type** (not only btc-updown-15m). Same pattern as Polymarket’s own UI and other indexers.

`auto-redeem` uses this as the **primary path**. If the Data-API returns no positions (e.g. your EOA isn’t indexed yet), it **falls back** to trade-history + Gamma slugs so existing setups still work.

## Usage

```bash
# Redeem all redeemable positions (Data-API, then fallback if empty)
npm run auto-redeem

# Dry run: only list what would be redeemed
DRY_RUN=true npm run auto-redeem

# Skip Data-API and use only trade-history + Gamma (fallback)
npm run auto-redeem -- --fallback-only
```

Override the Data-API base URL if needed: `DATA_API_URL=https://data-api.polymarket.com`

## Scheduling (e.g. daily)

Run `auto-redeem` on a schedule so you don’t have to remember:

**macOS/Linux (cron, daily at 9:00):**

```bash
crontab -e
```

Add:

```
0 9 * * * cd /path/to/LLMs && npm run auto-redeem >> logs/auto-redeem.log 2>&1
```

Replace `/path/to/LLMs` with your project path. Ensure `POLYGON_PRIVATE_KEY` and `RPC_URL` are set (e.g. in `.env`); cron runs with a minimal environment, so use absolute paths and consider sourcing env if needed.

**Alternative: launchd (macOS)**  
Create a plist that runs a shell script which `cd`s into the project and runs `npm run auto-redeem`, then load it with `launchctl`.

## Payouts

- Payouts are in **USDC.e (bridged)** on Polygon: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`.
- Check that token in your wallet or on PolygonScan, not native USDC.
