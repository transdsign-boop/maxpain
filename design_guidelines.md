# Liquidation Stream Dashboard Design Guidelines

## Design Approach
**Utility-Focused Design System Approach** - This is a real-time financial data application where efficiency, clarity, and immediate data comprehension are paramount. Using a modified **Fluent Design** approach optimized for trading interfaces.

## Core Design Principles
- **Data-First Design**: All visual elements serve data clarity and quick decision-making
- **Real-time Performance**: Minimal visual distractions that could impede data processing
- **Professional Trading Aesthetic**: Clean, modern interface that conveys trust and precision

## Color Palette

### Dark Mode (Primary)
- **Background**: 0 0% 6% (near black, slightly lighter than pure black)
- **Surface**: 0 0% 9% (elevated panels)
- **Border**: 0 0% 15% (subtle dividers)
- **Text Primary**: 0 0% 95% (high contrast white)
- **Text Secondary**: 0 0% 65% (muted text)

### Accent Colors
- **Primary/Highlight**: 67 100% 50% (bright yellow/lime - main accent)
- **Success/Long**: 142 76% 55% (forest green)
- **Danger/Short**: 0 84% 60% (vibrant red)
- **Warning**: 67 100% 50% (bright yellow/lime)
- **Info**: 217 91% 70% (blue for neutral data)

### Light Mode (Secondary)
- **Background**: 220 15% 98%
- **Surface**: 220 10% 100%
- **Border**: 220 8% 88%
- **Text Primary**: 220 15% 8%
- **Text Secondary**: 220 5% 40%

## Typography
- **Primary Font**: Inter (Google Fonts) - excellent for data readability
- **Monospace Font**: JetBrains Mono (Google Fonts) - for timestamps and numerical data
- **Hierarchy**: text-sm for data tables, text-base for labels, text-lg for headers

## Layout System
**Spacing Primitives**: Consistent use of Tailwind units 2, 4, 6, and 8
- `p-4` for standard component padding
- `gap-6` for section spacing
- `m-2` for tight element margins
- `h-8` for standard component heights

## Component Library

### Core Components
- **Data Tables**: Dense, scannable rows with alternating backgrounds
- **Real-time Cards**: Live updating panels with subtle pulse animations on data changes
- **Filter Controls**: Clean dropdown selectors and toggle switches
- **Timestamp Displays**: Monospace formatting with relative time indicators

### Navigation
- **Sidebar Navigation**: Minimal, icon-based with tooltips
- **Top Bar**: Application title, connection status indicator, and user preferences

### Data Visualization
- **Volume Indicators**: Horizontal bar charts with directional color coding
- **Liquidation Feed**: Vertical scrolling list with auto-scroll capability
- **Statistics Panels**: Clean metric cards with large numbers and trend indicators

## Special Considerations

### Real-time Data Presentation
- **Connection Status**: Prominent WebSocket connection indicator (green dot for connected)
- **Data Freshness**: Subtle timestamp indicators showing last update times
- **Loading States**: Skeleton screens for initial data load, subtle spinners for updates

### Trading Interface Elements
- **Directional Indicators**: Clear long/short visual distinction using green/red color coding
- **Volume Scaling**: Visual weight proportional to liquidation size
- **Time-bound Filters**: Intuitive time range selectors (1m, 5m, 15m, 1h, 4h, 1d)

### Performance Optimizations
- **Minimal Animations**: Only essential feedback animations (connection status, new data arrival)
- **Efficient Updates**: Smooth transitions for real-time data without visual disruption
- **Responsive Design**: Optimized for both desktop trading setups and mobile monitoring

## Images
No hero images or decorative graphics needed. This is a pure data application where any imagery would distract from the core functionality. Focus on clean iconography for navigation and status indicators only.