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
}

export class CascadeDetector {
  private liq1mSameSide: number[] = [];
  private ret1m: number[] = [];
  private oi5m: number[] = [];
  
  private autoEnabled: boolean;
  private currentLight: 'green' | 'yellow' | 'orange' | 'red' = 'green';
  private currentScore: number = 0;
  private coolingCounter: number = 0;
  
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

  public ingestTick(
    liqNotionalSameSide: number,
    ret1s: number,
    oiSnapshot: number,
    retSideMatchesLiq: boolean
  ): CascadeStatus {
    this.liq1mSameSide.push(liqNotionalSameSide);
    if (this.liq1mSameSide.length > this.WINDOW_1M) {
      this.liq1mSameSide.shift();
    }

    this.ret1m.push(ret1s);
    if (this.ret1m.length > this.WINDOW_1M) {
      this.ret1m.shift();
    }

    this.oi5m.push(oiSnapshot);
    if (this.oi5m.length > this.WINDOW_5M) {
      this.oi5m.shift();
    }

    const medianLiq = this.median(this.liq1mSameSide);
    const retSigma = this.stddev(this.ret1m);

    const sumLiq = this.liq1mSameSide.reduce((sum, val) => sum + val, 0);
    const LQ = medianLiq > 0 ? sumLiq / medianLiq : 0;

    const sumRet = Math.abs(this.ret1m.reduce((sum, val) => sum + val, 0));
    const RET = retSigma > 0 ? sumRet / retSigma : 0;

    let OI = 0;
    if (this.oi5m.length >= 2) {
      const oiPrev = Math.max(...this.oi5m.slice(0, -1));
      const oiNow = this.oi5m[this.oi5m.length - 1];
      if (oiPrev > 0) {
        OI = Math.max(0, ((oiPrev - oiNow) / oiPrev) * 100);
      }
    }

    let score = 0;
    
    if (LQ >= 8) score += 2;
    else if (LQ >= 4) score += 1;

    if (retSideMatchesLiq) {
      if (RET >= 4) score += 2;
      else if (RET >= 2.5) score += 1;
    }

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

    return {
      score,
      LQ: parseFloat(LQ.toFixed(1)),
      RET: parseFloat(RET.toFixed(1)),
      OI: parseFloat(OI.toFixed(1)),
      light: this.currentLight,
      autoBlock,
      autoEnabled: this.autoEnabled,
      medianLiq: parseFloat(medianLiq.toFixed(0))
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
      LQ: 0,
      RET: 0,
      OI: 0,
      light: this.currentLight,
      autoBlock: this.autoEnabled && (this.currentLight === 'orange' || this.currentLight === 'red'),
      autoEnabled: this.autoEnabled,
      medianLiq: 0
    };
  }
}
