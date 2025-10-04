/**
 * DCA SQL Wrapper Module
 * 
 * Bypasses Drizzle ORM cache for DCA-related database operations.
 * Uses raw SQL execution to avoid the schema caching bug.
 */

import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * DCA Strategy Parameters
 */
export interface DCAStrategyParams {
  dcaStartStepPercent: string;
  dcaSpacingConvexity: string;
  dcaSizeGrowth: string;
  dcaMaxRiskPercent: string;
  dcaVolatilityRef: string;
  dcaExitCushionMultiplier: string;
}

/**
 * Get strategy with DCA parameters
 */
export async function getStrategyWithDCA(strategyId: string) {
  const result = await db.execute(sql`
    SELECT 
      id, name, user_id, selected_assets, percentile_threshold,
      liquidation_lookback_hours, max_layers, position_size_percent,
      profit_target_percent, stop_loss_percent,
      dca_start_step_percent, dca_spacing_convexity, dca_size_growth,
      dca_max_risk_percent, dca_volatility_ref, dca_exit_cushion_multiplier,
      margin_mode, leverage, order_delay_ms, slippage_tolerance_percent,
      order_type, max_retry_duration_ms, margin_amount, trading_mode,
      hedge_mode, is_active, paused, live_session_started_at,
      created_at, updated_at
    FROM strategies
    WHERE id = ${strategyId}
  `);
  
  return result.rows[0] || null;
}

/**
 * Get all strategies for a user with DCA parameters
 */
export async function getStrategiesByUserWithDCA(userId: string) {
  const result = await db.execute(sql`
    SELECT 
      id, name, user_id, selected_assets, percentile_threshold,
      liquidation_lookback_hours, max_layers, position_size_percent,
      profit_target_percent, stop_loss_percent,
      dca_start_step_percent, dca_spacing_convexity, dca_size_growth,
      dca_max_risk_percent, dca_volatility_ref, dca_exit_cushion_multiplier,
      margin_mode, leverage, order_delay_ms, slippage_tolerance_percent,
      order_type, max_retry_duration_ms, margin_amount, trading_mode,
      hedge_mode, is_active, paused, live_session_started_at,
      created_at, updated_at
    FROM strategies
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `);
  
  return result.rows;
}

/**
 * Update DCA parameters for a strategy
 */
export async function updateStrategyDCAParams(
  strategyId: string,
  params: Partial<DCAStrategyParams>
) {
  const setParts: any[] = [];
  
  if (params.dcaStartStepPercent !== undefined) {
    setParts.push(sql`dca_start_step_percent = ${params.dcaStartStepPercent}`);
  }
  if (params.dcaSpacingConvexity !== undefined) {
    setParts.push(sql`dca_spacing_convexity = ${params.dcaSpacingConvexity}`);
  }
  if (params.dcaSizeGrowth !== undefined) {
    setParts.push(sql`dca_size_growth = ${params.dcaSizeGrowth}`);
  }
  if (params.dcaMaxRiskPercent !== undefined) {
    setParts.push(sql`dca_max_risk_percent = ${params.dcaMaxRiskPercent}`);
  }
  if (params.dcaVolatilityRef !== undefined) {
    setParts.push(sql`dca_volatility_ref = ${params.dcaVolatilityRef}`);
  }
  if (params.dcaExitCushionMultiplier !== undefined) {
    setParts.push(sql`dca_exit_cushion_multiplier = ${params.dcaExitCushionMultiplier}`);
  }
  
  if (setParts.length === 0) {
    return null;
  }
  
  // Build the SET clause by joining with commas
  const setClause = sql.join(setParts, sql.raw(', '));
  
  const result = await db.execute(sql`
    UPDATE strategies
    SET ${setClause}, updated_at = NOW()
    WHERE id = ${strategyId}
    RETURNING *
  `);
  
  return result.rows[0] || null;
}

/**
 * Get position with initial entry price
 */
export async function getPositionWithDCA(positionId: string) {
  const result = await db.execute(sql`
    SELECT 
      id, session_id, symbol, side, total_quantity, avg_entry_price,
      initial_entry_price, total_cost, unrealized_pnl, realized_pnl,
      layers_filled, max_layers, last_layer_price, leverage,
      is_open, opened_at, closed_at, updated_at
    FROM positions
    WHERE id = ${positionId}
  `);
  
  return result.rows[0] || null;
}

/**
 * Update initial entry price for a position
 */
export async function updatePositionInitialPrice(
  positionId: string,
  initialEntryPrice: string
) {
  const result = await db.execute(sql`
    UPDATE positions
    SET 
      initial_entry_price = ${initialEntryPrice},
      updated_at = NOW()
    WHERE id = ${positionId}
    RETURNING *
  `);
  
  return result.rows[0] || null;
}

/**
 * Get open positions for a session with DCA data
 */
export async function getOpenPositionsWithDCA(sessionId: string) {
  const result = await db.execute(sql`
    SELECT 
      id, session_id, symbol, side, total_quantity, avg_entry_price,
      initial_entry_price, total_cost, unrealized_pnl, realized_pnl,
      layers_filled, max_layers, last_layer_price, leverage,
      is_open, opened_at, closed_at, updated_at
    FROM positions
    WHERE session_id = ${sessionId}
      AND is_open = true
    ORDER BY opened_at DESC
  `);
  
  return result.rows;
}
