/**
 * risk.mjs — Risk management engine
 */

export class RiskEngine {
  constructor(config) {
    this.config = config;
    this._halted = false;
    this._haltReason = '';
    this._lastMexcPrice = null;
    this._baselinePrice = null;
  }

  /** Check if an order is within risk limits */
  checkOrder(side, kasAmount, customerAddress, isNewAddress) {
    if (this._halted) return { ok: false, reason: `Trading halted: ${this._haltReason}` };
    if (kasAmount > this.config.maxOrderKas) return { ok: false, reason: `Exceeds max order (${this.config.maxOrderKas} KAS)` };
    if (isNewAddress && kasAmount > this.config.newAddressLimitKas) return { ok: false, reason: `New address limit (${this.config.newAddressLimitKas} KAS)` };
    return { ok: true };
  }

  /** Check if we should halt quoting (price deviation) */
  checkPriceDeviation(currentPrice) {
    if (!this._baselinePrice) { this._baselinePrice = currentPrice; return; }
    const deviation = Math.abs(currentPrice - this._baselinePrice) / this._baselinePrice * 100;
    if (deviation > this.config.priceDeviationHaltPct) {
      this._halted = true;
      this._haltReason = `Price deviation ${deviation.toFixed(1)}% exceeds ${this.config.priceDeviationHaltPct}%`;
    } else if (this._halted && this._haltReason.startsWith('Price deviation')) {
      this._halted = false;
      this._haltReason = '';
    }
    this._baselinePrice = currentPrice; // rolling baseline
  }

  /** Check inventory levels */
  checkInventory(kasBalance, usdtBalance) {
    const canSell = kasBalance >= this.config.minKasReserve;
    const canBuy = usdtBalance >= this.config.minUsdtReserve;
    return { canSell, canBuy };
  }

  /** Calculate batch delivery plan */
  getBatchPlan(usdtAmount, kasAmount) {
    if (usdtAmount <= this.config.batchThresholdUsdt) {
      return [{ kasAmount, usdtAmount, index: 0, total: 1 }];
    }
    const n = this.config.batchSize;
    const batches = [];
    for (let i = 0; i < n; i++) {
      batches.push({
        kasAmount: parseFloat((kasAmount / n).toFixed(2)),
        usdtAmount: parseFloat((usdtAmount / n).toFixed(2)),
        index: i,
        total: n,
      });
    }
    return batches;
  }

  /** Check if rebalancing needed */
  needsRebalance(kasBalance, targetKas) {
    return Math.abs(kasBalance - targetKas) > this.config.rebalanceThresholdKas;
  }

  get isHalted() { return this._halted; }
  get haltReason() { return this._haltReason; }
}
