/**
 * DCA SQL Wrapper Module
 * 
 * Bypasses Drizzle ORM cache for DCA-related database operations.
 * Uses raw SQL execution to avoid the schema caching bug.
 */

import { sql, eq } from 'drizzle-orm';
import { db } from './db';
import { strategies } from '@shared/schema';

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
  retHighThreshold: string;
  retMediumThreshold: string;
  adaptiveTpEnabled: boolean;
  tpAtrMultiplier: string;
  minTpPercent: string;
  maxTpPercent: string;
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
      adaptive_tp_enabled, tp_atr_multiplier, min_tp_percent, max_tp_percent,
      ret_high_threshold, ret_medium_threshold,
      margin_mode, leverage, order_delay_ms, slippage_tolerance_percent,
      order_type, max_retry_duration_ms, margin_amount,
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
      order_type, max_retry_duration_ms, margin_amount,
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
  // Build SET clauses manually with explicit quoting
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;
  
  if (params.dcaStartStepPercent !== undefined) {
    setClauses.push(`"dca_start_step_percent" = $${paramIndex++}`);
    values.push(params.dcaStartStepPercent);
  }
  if (params.dcaSpacingConvexity !== undefined) {
    setClauses.push(`"dca_spacing_convexity" = $${paramIndex++}`);
    values.push(params.dcaSpacingConvexity);
  }
  if (params.dcaSizeGrowth !== undefined) {
    setClauses.push(`"dca_size_growth" = $${paramIndex++}`);
    values.push(params.dcaSizeGrowth);
  }
  if (params.dcaMaxRiskPercent !== undefined) {
    setClauses.push(`"dca_max_risk_percent" = $${paramIndex++}`);
    values.push(params.dcaMaxRiskPercent);
  }
  if (params.dcaVolatilityRef !== undefined) {
    setClauses.push(`"dca_volatility_ref" = $${paramIndex++}`);
    values.push(params.dcaVolatilityRef);
  }
  if (params.dcaExitCushionMultiplier !== undefined) {
    setClauses.push(`"dca_exit_cushion_multiplier" = $${paramIndex++}`);
    values.push(params.dcaExitCushionMultiplier);
  }
  if (params.retHighThreshold !== undefined) {
    setClauses.push(`"ret_high_threshold" = $${paramIndex++}`);
    values.push(params.retHighThreshold);
  }
  if (params.retMediumThreshold !== undefined) {
    setClauses.push(`"ret_medium_threshold" = $${paramIndex++}`);
    values.push(params.retMediumThreshold);
  }
  if (params.adaptiveTpEnabled !== undefined) {
    setClauses.push(`"adaptive_tp_enabled" = $${paramIndex++}`);
    values.push(params.adaptiveTpEnabled);
  }
  if (params.tpAtrMultiplier !== undefined) {
    setClauses.push(`"tp_atr_multiplier" = $${paramIndex++}`);
    values.push(params.tpAtrMultiplier);
  }
  if (params.minTpPercent !== undefined) {
    setClauses.push(`"min_tp_percent" = $${paramIndex++}`);
    values.push(params.minTpPercent);
  }
  if (params.maxTpPercent !== undefined) {
    setClauses.push(`"max_tp_percent" = $${paramIndex++}`);
    values.push(params.maxTpPercent);
  }
  
  if (setClauses.length === 0) {
    return null;
  }
  
  // Add updated_at
  setClauses.push(`"updated_at" = NOW()`);
  
  // Build complete SQL query with embedded values (escape quotes)
  const escapedId = strategyId.replace(/'/g, "''");
  const setClauseStr = setClauses.map((clause, i) => {
    const value = values[i];
    const escapedValue = typeof value === 'string' ? value.replace(/'/g, "''") : value;
    return clause.replace(`$${i + 1}`, `'${escapedValue}'`);
  }).join(', ');
  
  const queryString = `
    UPDATE "strategies"
    SET ${setClauseStr}
    WHERE "id" = '${escapedId}'
    RETURNING *
  `;
  
  // Execute raw SQL
  const result = await db.execute(sql.raw(queryString));
  
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
