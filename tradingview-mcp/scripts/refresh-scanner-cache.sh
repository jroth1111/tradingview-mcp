#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${SCANNER_CACHE_DIR:-data/scanner}"
mkdir -p "$OUT_DIR"

post() {
  local url="$1"
  local out="$2"
  echo "post $out"
  curl -fL --max-time 30 -sS -X POST "$url" > "$out"
}

enum() {
  local label="$1"
  local ids="$2"
  local out="$3"
  echo "enum $out"
  curl -fL --max-time 30 -sS -G "https://scanner.tradingview.com/enum/ordered" \
    --data-urlencode "id=$ids" \
    --data-urlencode "lang=en" \
    --data-urlencode "label-product=$label" \
    > "$out"
}

STOCK_ENUM_IDS="index,country,exchange,industry,sector,submarket,currency_id,analyst_rating,technical_rating"
ETF_ENUM_IDS="actively_managed,asset_class,brand,category,country,currency_hedged_flag,dividend_treatment,dividends_frequency,exchange,focus,index_tracked,holdings_region,holds_derivatives_flag,index_provider,issuer,k1_form,leverage,leverage_ratio,leveraged_flag,niche,selection_criteria,strategy,transparent_holding_flag,ucits_compliant_flag,weighting_scheme,currency_id,technical_rating"
BOND_ENUM_IDS="exchange,bond_type_gen,call_frequency,conversion_option,coupon_currency,coupon_change_type,coupon_daycount_type,coupon_frequency,coupon_link,coupon_pmt_date_type,coupon_reset_frequency,coupon_type_general,coupon_underlying_index,covenant,country,credit_enhancement_status,credit_enhancement_type,bond_issuer_cr_parent,coupon_type_current,industry,inflation_protection,fundamental_currency_code,issue_status,bond_issuer,bond_issuer_type,make_whole_call_option,maturity_type,offer_type,ownership_form,placement_type,pledge_status,poison_put_option,premature_redemption,principal_redemption_type,put_frequency,redemption_type,sector,seniority_level,sinking_fund,bond_snp_outlook_lt,social_responsibility,bond_snp_rating_lt,bond_issuer_snp_rating_lt,bond_issuer_snp_rating_st,bond_issuer_snp_outlook_lt,duration_type"
CEX_ENUM_IDS="exchange,base_currency_id,currency_id,technical_rating"
DEX_ENUM_IDS="blockchain-id,exchange,technical_rating"
COIN_ENUM_IDS="crypto_blockchain_ecosystems,crypto_common_categories,crypto_consensus_algorithms,technical_rating"

post "https://scanner.tradingview.com/america/metainfo?label-product=screener-stock" \
  "$OUT_DIR/metainfo.america.screener-stock.json"
post "https://scanner.tradingview.com/global/metainfo?label-product=screener-stock" \
  "$OUT_DIR/metainfo.global.screener-stock.json"
enum "screener-stock" "$STOCK_ENUM_IDS" \
  "$OUT_DIR/enum-ordered.screener-stock.json"

post "https://scanner.tradingview.com/america/metainfo?label-product=screener-etf" \
  "$OUT_DIR/metainfo.america.screener-etf.json"
post "https://scanner.tradingview.com/global/metainfo?label-product=screener-etf" \
  "$OUT_DIR/metainfo.global.screener-etf.json"
enum "screener-etf" "$ETF_ENUM_IDS" \
  "$OUT_DIR/enum-ordered.screener-etf.json"

post "https://scanner.tradingview.com/bond/metainfo?label-product=screener-bond" \
  "$OUT_DIR/metainfo.bond.screener-bond.json"
enum "screener-bond" "$BOND_ENUM_IDS" \
  "$OUT_DIR/enum-ordered.screener-bond.json"

post "https://scanner.tradingview.com/forex/metainfo?label-product=screener-forex-old" \
  "$OUT_DIR/metainfo.forex.screener-forex-old.json"

post "https://scanner.tradingview.com/crypto/metainfo?label-product=screener-crypto-old" \
  "$OUT_DIR/metainfo.crypto.screener-crypto-old.json"

post "https://scanner.tradingview.com/crypto/metainfo?label-product=screener-crypto-cex" \
  "$OUT_DIR/metainfo.crypto.screener-crypto-cex.json"
enum "screener-crypto-cex" "$CEX_ENUM_IDS" \
  "$OUT_DIR/enum-ordered.screener-crypto-cex.json"

post "https://scanner.tradingview.com/crypto/metainfo?label-product=screener-crypto-dex" \
  "$OUT_DIR/metainfo.crypto.screener-crypto-dex.json"
enum "screener-crypto-dex" "$DEX_ENUM_IDS" \
  "$OUT_DIR/enum-ordered.screener-crypto-dex.json"

post "https://scanner.tradingview.com/coin/metainfo?label-product=screener-coin" \
  "$OUT_DIR/metainfo.coin.screener-coin.json"
enum "screener-coin" "$COIN_ENUM_IDS" \
  "$OUT_DIR/enum-ordered.screener-coin.json"

echo "done"
