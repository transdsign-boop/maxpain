# Aster DEX Liquidation Trading Dashboard Design Guidelines

## Design Approach
**Professional Trading Terminal - Fluent Design System** - This sophisticated financial application prioritizes data density, real-time performance, and professional trading aesthetics. Every design element serves trading efficiency and risk management clarity.

## Core Design Principles
- **Terminal-Grade Interface**: Dense, information-rich layouts optimized for professional traders
- **Real-time Performance**: Minimal visual interference with live data processing
- **Risk-First Design**: Critical risk indicators and controls prominently positioned
- **Multi-Position Management**: Clear visual hierarchy for tracking multiple concurrent positions

## Color Palette

### Dark Mode (Primary)
- **Background**: 220 15% 6% (deep terminal black)
- **Surface Primary**: 220 12% 10% (elevated panels)
- **Surface Secondary**: 220 10% 14% (secondary panels)
- **Border**: 220 8% 20% (panel dividers)
- **Text Primary**: 220 5% 96% (high contrast)
- **Text Secondary**: 220 5% 75% (labels)
- **Text Muted**: 220 5% 55% (metadata)

### Trading Status Colors
- **Long/Profit**: 142 76% 42% (trading green)
- **Short/Loss**: 0 84% 58% (trading red)
- **Warning/Risk**: 38 92% 50% (amber alerts)
- **Neutral/Info**: 217 91% 65% (data blue)
- **Critical Alert**: 0 100% 67% (urgent red)
- **Success Action**: 142 76% 48% (confirmation green)

### Strategy & Risk Indicators
- **Active Strategy**: 142 65% 45% (enabled green)
- **Paused Strategy**: 38 85% 55% (paused amber)
- **Risk Threshold**: 0 75% 60% (risk red)
- **Safe Zone**: 142 45% 50% (safe green)

## Typography
- **Primary Font**: Inter (Google Fonts) - optimal for dense financial data
- **Monospace Font**: JetBrains Mono (Google Fonts) - prices, timestamps, addresses
- **Hierarchy**: 
  - text-xs for dense table data
  - text-sm for labels and secondary info
  - text-base for primary content
  - text-lg for panel headers
  - text-xl for critical metrics

## Layout System
**Spacing Primitives**: Tailwind units 1, 2, 3, 4, 6, 8
- `p-3` for compact component padding
- `p-4` for standard panel padding
- `gap-4` for component spacing
- `gap-6` for section separation
- `h-8` for control heights
- `h-12` for prominent buttons

## Component Library

### Trading Terminal Components
- **Position Cards**: Compact cards showing P&L, risk level, and quick actions
- **Strategy Configuration Panels**: Expandable sections with parameter controls
- **Risk Control Dashboard**: Prominent risk metrics with threshold indicators
- **Liquidation Stream**: High-density scrolling feed with size-based visual weights
- **Cascade Detection Alerts**: Prominent warning panels with risk escalation indicators

### Data Tables
- **Dense Financial Tables**: Minimal row height with alternating subtle backgrounds
- **Real-time Price Feeds**: Monospace numbers with directional color flashing
- **Position Management Grid**: Sortable columns with inline editing capabilities
- **Strategy Performance Tables**: Historical data with trend indicators

### Navigation & Layout
- **Sidebar Navigation**: Collapsible icon-based menu with trading sections
- **Multi-Panel Layout**: Resizable panels for customizable workspace
- **Quick Action Toolbar**: Prominent emergency controls (stop all, pause strategies)
- **Status Bar**: Connection health, account balance, active positions count

### Controls & Inputs
- **Strategy Toggles**: Large, clear on/off switches for strategy activation
- **Risk Sliders**: Visual range controls with color-coded safe/warning zones
- **Parameter Inputs**: Validated numerical inputs with unit indicators
- **Time Range Selectors**: Button groups for timeframe selection (1m, 5m, 15m, 1h, 4h, 1d)

## Real-time Features

### Live Data Presentation
- **Connection Indicators**: Prominent WebSocket status with latency display
- **Data Freshness**: Subtle pulse animations on updated values
- **Price Movement**: Brief color flashes for price changes (green up, red down)
- **Position Updates**: Smooth transitions for P&L changes

### Alert System
- **Risk Escalation**: Progressive color intensity for increasing risk levels
- **Cascade Warnings**: Prominent modal overlays for cascade detection
- **Strategy Notifications**: Subtle toast notifications for strategy events
- **System Alerts**: Critical notifications for connection or system issues

## Performance & Responsiveness
- **Minimal Animation**: Only essential feedback (connection status, alerts)
- **Efficient Updates**: Optimized for high-frequency data without visual disruption  
- **Desktop-First**: Optimized for multi-monitor trading setups
- **Responsive Breakpoints**: Tablet and mobile views for monitoring on-the-go

## Images
No decorative images or hero graphics. This is a pure trading application where any non-functional imagery would distract from critical financial data. Use only essential iconography for navigation, status indicators, and trading actions (buy/sell/stop icons, connection status, alert symbols).