interface CascadeStatus {
  score: number;
  LQ: number;
  RET: number;
  OI: number;
  light: 'green' | 'yellow' | 'orange' | 'red';
  autoBlock: boolean;
  autoEnabled: boolean;
  medianLiq: number;
  dOI_1m: number;
  dOI_3m: number;
  reversal_quality: number;
  rq_bucket: 'poor' | 'ok' | 'good' | 'excellent';
  volatility_regime: 'low' | 'medium' | 'high';
  rq_threshold_adjusted: number;
}

interface OISnapshot {
  value: number;
  timestamp: number;
}

export class CascadeDetector {
  private liq1mSameSide: number[] = [];
  private ret1m: number[] = [];
  private oi5m: OISnapshot[] = [];
  
  private autoEnabled: boolean;
  private currentLight: 'green' | 'yellow' | 'orange' | 'red' = 'green';
  private currentScore: number = 0;
  private coolingCounter: number = 0;
  
  // Store last calculated values for getCurrentStatus()
  private lastLQ: number = 0;
  private lastRET: number = 0;
  private lastOI: number = 0;
  private lastMedianLiq: number = 0;
  private lastDOI_1m: number = 0;
  private lastDOI_3m: number = 0;
  private lastReversalQuality: number = 0;
  private lastRQBucket: 'poor' | 'ok' | 'good' | 'excellent' = 'poor';
  private lastVolatilityRegime: 'low' | 'medium' | 'high' = 'low';
  private lastRQThresholdAdjusted: number = 1;
  
  private readonly WINDOW_1M = 60;
  private readonly WINDOW_5M = 300;
  private readonly COOLING_SECONDS = 6;
  
  constructor(autoEnabled: boolean = true) {
    this.autoEnabled = autoEnabled;
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private stddev(arr: number[]): number {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;
    const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }

  private getColorFromScore(score: number): 'green' | 'yellow' | 'orange' | 'red' {
    if (score >= 6) return 'red';
    if (score >= 4) return 'orange';
    if (score >= 2) return 'yellow';
    return 'green';
  }

  private getLowerBand(light: 'green' | 'yellow' | 'orange' | 'red'): number {
    switch (light) {
      case 'red': return 4;
      case 'orange': return 2;
      case 'yellow': return 0;
      default: return 0;
    }
  }

  private calculateOIDelta(secondsAgo: number): number {
    if (this.oi5m.length === 0) return 0;
    
    const now = Date.now();
    const targetTime = now - (secondsAgo * 1000);
    const currentOI = this.oi5m[this.oi5m.length - 1].value;
    
    let closestSnapshot: OISnapshot | null = null;
    let minTimeDiff = Infinity;
    
    for (const snapshot of this.oi5m) {
      const timeDiff = Math.abs(snapshot.timestamp - targetTime);
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff;
        closestSnapshot = snapshot;
      }
    }
    
    if (!closestSnapshot || closestSnapshot.value === 0) return 0;
    
    const percentChange = ((currentOI - closestSnapshot.value) / closestSnapshot.value) * 100;
    return parseFloat(percentChange.toFixed(2));
  }

  /**
   * Calculate Reversal Quality Score
   * 
   * Scoring algorithm (0-6 points):
   * 
   * Liquidation Quality (LQ):
   *   - LQ ≥ 8: +2 points (large liquidations)
   *   - LQ ≥ 6: +1 point (medium liquidations)
   *   
   *   Note: LQ thresholds (8, 6) are FIXED by algorithm design. These values define what
   *   constitutes "large" vs "medium" liquidations based on the ratio sumLiq/medianLiq.
   *   LQ = 8 means liquidations are 8x the historical median - empirically this indicates
   *   significant market stress and high reversal probability. LQ = 6 (6x median) is the
   *   minimum threshold for a meaningful liquidation cascade. These are NOT user-configurable
   *   as they represent fundamental market structure breakpoints.
   * 
   * Volatility (RET):
   *   - RET ≥ retMediumThreshold: +1 point (user-configurable)
   * 
   * Open Interest Change (dOI):
   *   - dOI_1m ≤ -1.0% OR dOI_3m ≤ -1.5%: +2 points (strong OI drop)
   *   - dOI_1m ≤ -0.5% OR dOI_3m ≤ -1.0%: +1 point (moderate OI drop)
   *   - dOI_1m > 0 AND dOI_3m > 0: -2 points (OI increasing = not a reversal)
   *   
   *   Note: OI percentage thresholds (-1.0%, -1.5%, -0.5%, -1.0%) are FIXED by algorithm design.
   *   These represent empirically derived breakpoints where open interest decline indicates
   *   forced position unwinding (cascade) vs normal market activity. -1.0% in 1 minute or
   *   -1.5% in 3 minutes represents rapid forced closures typical of liquidation cascades.
   *   These are NOT user-configurable as they represent fundamental market microstructure.
   * 
   * Score buckets:
   *   - 0-1: "poor"
   *   - 2: "ok"
   *   - 3: "good"
   *   - 4+: "excellent"
   */
  private calculateReversalQuality(LQ: number, RET: number, dOI_1m: number, dOI_3m: number, retMediumThreshold: number = 25): { reversal_quality: number; rq_bucket: 'poor' | 'ok' | 'good' | 'excellent' } {
    let score = 0;
    
    // Liquidation Quality scoring (FIXED thresholds - see function documentation)
    if (LQ >= 8) score += 2;
    else if (LQ >= 6) score += 1;
    
    // Volatility scoring (user-configurable threshold)
    if (RET >= retMediumThreshold) score += 1;
    
    // Open Interest scoring
    if (dOI_1m <= -1.0 || dOI_3m <= -1.5) score += 2;
    else if (dOI_1m <= -0.5 || dOI_3m <= -1.0) score += 1;
    
    // Penalty for increasing OI (not a reversal)
    if (dOI_1m > 0 && dOI_3m > 0) score -= 2;
    
    score = Math.max(0, score);
    
    let rq_bucket: 'poor' | 'ok' | 'good' | 'excellent';
    if (score <= 1) rq_bucket = 'poor';
    else if (score === 2) rq_bucket = 'ok';
    else if (score === 3) rq_bucket = 'good';
    else rq_bucket = 'excellent';
    
    return { reversal_quality: score, rq_bucket };
  }

  private calculateVolatilityRegime(
    RET: number,
    retHighThreshold: number = 35,
    retMediumThreshold: number = 25
  ): { volatility_regime: 'low' | 'medium' | 'high'; rq_threshold_adjusted: number } {
    // Use RET (realized volatility) to determine market regime
    // RET = sum of |returns| / std dev (properly normalized, asset-agnostic)
    // Thresholds are user-configurable for fine-tuning based on observed market behavior
    
    let volatility_regime: 'low' | 'medium' | 'high';
    let rq_threshold_adjusted: number;
    
    if (RET >= retHighThreshold) {
      // Extreme volatility: Be highly selective, require excellent quality
      volatility_regime = 'high';
      rq_threshold_adjusted = 3; // Require "good" quality
    } else if (RET >= retMediumThreshold) {
      // Elevated volatility: Moderate selectivity
      volatility_regime = 'medium';
      rq_threshold_adjusted = 2; // Require "ok" quality
    } else {
      // Normal/low volatility: Less selective, allow lower quality
      volatility_regime = 'low';
      rq_threshold_adjusted = 1; // Require minimal quality (poor/ok bucket)
    }
    
    return { volatility_regime, rq_threshold_adjusted };
  }

  public ingestTick(
    liqNotionalSameSide: number,
    ret1s: number,
    oiSnapshot: number,
    retSideMatchesLiq: boolean,
    retHighThreshold: number = 35,
    retMediumThreshold: number = 25
  ): CascadeStatus {
    this.liq1mSameSide.push(liqNotionalSameSide);
    if (this.liq1mSameSide.length > this.WINDOW_1M) {
      this.liq1mSameSide.shift();
    }

    this.ret1m.push(ret1s);
    if (this.ret1m.length > this.WINDOW_1M) {
      this.ret1m.shift();
    }

    const now = Date.now();
    this.oi5m.push({ value: oiSnapshot, timestamp: now });
    if (this.oi5m.length > this.WINDOW_5M) {
      this.oi5m.shift();
    }

    const medianLiq = this.median(this.liq1mSameSide);
    const retSigma = this.stddev(this.ret1m);

    const sumLiq = this.liq1mSameSide.reduce((sum, val) => sum + val, 0);
    const LQ = medianLiq > 0 ? sumLiq / medianLiq : 0;

    // RET: Realized volatility - sum of absolute returns normalized by std dev
    // This measures total price variation regardless of direction
    // Properly normalized to work across all asset classes (stocks, crypto, forex, etc.)
    const sumRet = this.ret1m.reduce((sum, val) => sum + Math.abs(val), 0);
    const RET = retSigma > 0 ? sumRet / retSigma : 0;

    let OI = 0;
    if (this.oi5m.length >= 2) {
      const oiValues = this.oi5m.map(s => s.value);
      const oiPrev = Math.max(...oiValues.slice(0, -1));
      const oiNow = this.oi5m[this.oi5m.length - 1].value;
      if (oiPrev > 0) {
        OI = Math.max(0, ((oiPrev - oiNow) / oiPrev) * 100);
      }
    }

    const dOI_1m = this.calculateOIDelta(60);
    const dOI_3m = this.calculateOIDelta(180);

    // Traffic light scoring system for real-time cascade detection
    // This differs from reversal quality scoring - it's for immediate risk assessment
    let score = 0;
    
    // LQ thresholds (FIXED by algorithm design):
    // - LQ >= 8: Extreme liquidations (8x median) - highest risk
    // - LQ >= 4: Elevated liquidations (4x median) - moderate risk
    // These breakpoints define market stress levels empirically observed during cascades
    if (LQ >= 8) score += 2;
    else if (LQ >= 4) score += 1;

    // RET thresholds (user-configurable):
    // Only counts if volatility direction matches liquidation side (retSideMatchesLiq)
    if (retSideMatchesLiq) {
      if (RET >= retHighThreshold) score += 2;
      else if (RET >= retMediumThreshold) score += 1;
    }

    // OI percentage drop thresholds (FIXED by algorithm design):
    // - OI >= 4%: Massive position unwinding over 5-minute window
    // - OI >= 2%: Significant position unwinding over 5-minute window
    // These represent forced closures typical of liquidation cascades, not user-configurable
    if (OI >= 4) score += 2;
    else if (OI >= 2) score += 1;

    const newColor = this.getColorFromScore(score);

    if (newColor !== this.currentLight) {
      const colorOrder = ['green', 'yellow', 'orange', 'red'];
      const currentIndex = colorOrder.indexOf(this.currentLight);
      const newIndex = colorOrder.indexOf(newColor);

      if (newIndex > currentIndex) {
        this.currentLight = newColor;
        this.coolingCounter = 0;
      } else {
        const lowerBand = this.getLowerBand(this.currentLight);
        if (score <= lowerBand) {
          this.coolingCounter++;
          if (this.coolingCounter >= this.COOLING_SECONDS) {
            this.currentLight = newColor;
            this.coolingCounter = 0;
          }
        } else {
          this.coolingCounter = 0;
        }
      }
    } else {
      this.coolingCounter = 0;
    }

    this.currentScore = score;

    const autoBlock = this.autoEnabled && (this.currentLight === 'orange' || this.currentLight === 'red');

    const { reversal_quality, rq_bucket } = this.calculateReversalQuality(LQ, RET, dOI_1m, dOI_3m, retMediumThreshold);
    const { volatility_regime, rq_threshold_adjusted } = this.calculateVolatilityRegime(RET, retHighThreshold, retMediumThreshold);

    // Store calculated values for getCurrentStatus()
    this.lastLQ = parseFloat(LQ.toFixed(1));
    this.lastRET = parseFloat(RET.toFixed(1));
    this.lastOI = parseFloat(OI.toFixed(1));
    this.lastMedianLiq = parseFloat(medianLiq.toFixed(0));
    this.lastDOI_1m = dOI_1m;
    this.lastDOI_3m = dOI_3m;
    this.lastReversalQuality = reversal_quality;
    this.lastRQBucket = rq_bucket;
    this.lastVolatilityRegime = volatility_regime;
    this.lastRQThresholdAdjusted = rq_threshold_adjusted;

    return {
      score,
      LQ: this.lastLQ,
      RET: this.lastRET,
      OI: this.lastOI,
      light: this.currentLight,
      autoBlock,
      autoEnabled: this.autoEnabled,
      medianLiq: this.lastMedianLiq,
      dOI_1m: this.lastDOI_1m,
      dOI_3m: this.lastDOI_3m,
      reversal_quality: this.lastReversalQuality,
      rq_bucket: this.lastRQBucket,
      volatility_regime: this.lastVolatilityRegime,
      rq_threshold_adjusted: this.lastRQThresholdAdjusted
    };
  }

  public setAutoEnabled(enabled: boolean): void {
    this.autoEnabled = enabled;
  }

  public getAutoEnabled(): boolean {
    return this.autoEnabled;
  }

  public getCurrentStatus(): CascadeStatus {
    return {
      score: this.currentScore,
      LQ: this.lastLQ,
      RET: this.lastRET,
      OI: this.lastOI,
      light: this.currentLight,
      autoBlock: this.autoEnabled && (this.currentLight === 'orange' || this.currentLight === 'red'),
      autoEnabled: this.autoEnabled,
      medianLiq: this.lastMedianLiq,
      dOI_1m: this.lastDOI_1m,
      dOI_3m: this.lastDOI_3m,
      reversal_quality: this.lastReversalQuality,
      rq_bucket: this.lastRQBucket,
      volatility_regime: this.lastVolatilityRegime,
      rq_threshold_adjusted: this.lastRQThresholdAdjusted
    };
  }
}
