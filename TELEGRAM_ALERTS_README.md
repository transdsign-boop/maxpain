# Telegram Alerts System - Simplified Guide

## ✅ System Status

**Telegram alerts have been simplified to show only essential trading information.**

## 📱 Active Alert Types

The system now sends only 2 types of alerts:

### 1. **Position Closed** 🟢/🔴
**Triggers:** When a position exits (TP hit, SL hit, or manual close)
**Information:**
- Symbol, side, entry/exit prices, quantity
- **Position P&L** ($ and % ROI)
- **Balance before/after**
- **Total P&L across all trades**
- Timestamp (Pacific Time)

**Example (Profit):**
```
🟢 POSITION CLOSED

Symbol: BTCUSDT
Side: LONG
Entry: $42,350.25
Exit: $42,780.60
Quantity: 2.5

🟢 P&L: +$1,075.88 (+2.54%)

💰 Balance Update:
Before: $10,000.00
After: $11,075.88

🟢 Total P&L (All Trades): +$1,075.88

Time: 10/25/2025 5:45 pm PT
```

**Example (Loss):**
```
🔴 POSITION CLOSED

Symbol: ETHUSDT
Side: SHORT
Entry: $2,250.50
Exit: $2,280.75
Quantity: 10

🔴 P&L: -$302.50 (-1.34%)

💰 Balance Update:
Before: $11,075.88
After: $10,773.38

🟢 Total P&L (All Trades): +$773.38

Time: 10/25/2025 6:00 pm PT
```

---

### 2. **Open Positions Summary** 📊
**Triggers:** Automatically sent after a position closes
**Information:**
- List of all currently open positions
- Entry price, quantity, value for each position
- DCA layers filled for each position
- Total exposure across all positions
- **Current balance**
- **Total P&L across all trades**
- Timestamp (Pacific Time)

**Example (With Open Positions):**
```
📊 OPEN POSITIONS SUMMARY

Total Open: 2 positions
Total Exposure: $5,250.00

BTCUSDT LONG
  Entry: $42,100.50
  Qty: 0.8
  Value: $3,368.04
  Layers: 2/5

ETHUSDT SHORT
  Entry: $2,240.00
  Qty: 8.4
  Value: $1,881.96
  Layers: 1/5

💰 Current Balance: $10,773.38
🟢 Total P&L (All Trades): +$773.38

Time: 10/25/2025 6:01 pm PT
```

**Example (No Open Positions):**
```
📊 OPEN POSITIONS SUMMARY

✅ No open positions

💰 Current Balance: $10,773.38
📈 Total P&L: +$773.38

Time: 10/25/2025 6:01 pm PT
```

---

## 🚫 Disabled Alert Types

The following alerts have been **disabled** per user request:
- ❌ Position Opened (Layer 1 fills)
- ❌ DCA Layer Filled (Layer 2+ fills)
- ❌ Take Profit Hit 🎯
- ❌ Stop Loss Hit 🛑
- ❌ Hourly Performance Reports 📊
- ❌ Risk Level Warnings 🟡/🟠/🔴
- ❌ Cascade Detector Alerts 🟢/🟡/🟠
- ❌ Market Condition Changes 🌍
- ❌ System Health Alerts 🔴/🟡/🔄/⏸️

**Why simplified?**
The user requested only essential information:
1. Know when positions close (with P&L and balance impact)
2. See what's currently open after each close
3. Track total balance and cumulative P&L

All other notifications create noise and aren't needed for effective trading monitoring.

---

## 🔧 Configuration

### Environment Variables

```bash
# Required for Telegram alerts
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
```

### Getting Your Telegram Credentials

1. **Create Bot:**
   - Message @BotFather on Telegram
   - Send `/newbot`
   - Follow instructions to get your `TELEGRAM_BOT_TOKEN`

2. **Get Chat ID:**
   - Message your bot
   - Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find your `chat.id` in the response

3. **Add to .env:**
   ```bash
   TELEGRAM_BOT_TOKEN=7325558886:AAHwaZUjc_zp_ZaIY5Su3TuG1tACsW3ieT8
   TELEGRAM_CHAT_ID=7132626171
   ```

---

## 🧪 Testing Alerts

### Test Connection
```bash
curl -X POST http://localhost:5000/api/telegram/test
```

### Send Manual Summary
You can manually trigger the open positions summary anytime:
```bash
curl -X POST http://localhost:5000/api/telegram/daily-report \
  -H "Content-Type: application/json" \
  -d '{"strategyId":"your-strategy-id"}'
```

---

## 📊 Data Accuracy

All alerts now use **accurate data sources**:

### Position Closed
- ✅ **Real P&L from exchange API** (`/fapi/v1/userTrades`)
- ✅ Actual exit prices from fills
- ✅ Accurate ROI calculation (P&L / position value × 100)
- ✅ Includes all fees
- ✅ Balance tracked before and after each position
- ✅ Total P&L accumulated across all trades

### Open Positions Summary
- ✅ Fetches positions from database
- ✅ Accurate entry prices and quantities
- ✅ Shows actual DCA layers filled
- ✅ Current balance from latest session
- ✅ Total P&L from all closed positions

---

## 🕐 Timezone Support

**All timestamps display in Pacific Time (PST/PDT)**
- Automatically handles daylight saving transitions
- Format: `10/25/2025 3:30 pm PT`

---

## 🐛 Troubleshooting

### Alerts Not Sending

1. **Check credentials:**
   ```bash
   env | grep TELEGRAM
   ```

2. **Test connection:**
   ```bash
   curl -X POST http://localhost:5000/api/telegram/test
   ```

3. **Check server logs:**
   ```bash
   grep "Telegram" /tmp/dev_restart.log
   ```

### Data Issues

- ✅ **FIXED:** All data now comes from exchange API or accurate database queries
- ✅ **FIXED:** P&L uses actual realized values from exchange
- ✅ **FIXED:** Balance tracked accurately before and after each trade
- ✅ **FIXED:** Total P&L accumulated correctly across all trades

### Timezone Issues

- ✅ **FIXED:** All timestamps now show Pacific Time (PT)
- ✅ **FIXED:** Format: `MM/DD/YYYY h:mm a PT`

---

## 📝 Recent Changes (10/25/2025)

### Simplified Alert System
1. ✅ **Removed unnecessary alerts** - Disabled position opened, DCA layers, TP/SL hits, hourly reports, risk warnings, cascade alerts, etc.
2. ✅ **Enhanced position closed alert** - Added balance before/after and total P&L
3. ✅ **Added open positions summary** - Automatically sent after each position closes
4. ✅ **Accurate balance tracking** - Shows exact balance impact of each trade
5. ✅ **Cumulative P&L tracking** - Total P&L across all trades displayed in every alert

---

## 🎯 Summary

Your Telegram alert system now provides **only essential information**:
- ✅ Position closed with P&L, balance update, and total P&L
- ✅ Open positions summary after each close
- ✅ Accurate data from exchange API
- ✅ Pacific Time timezone throughout
- ✅ No noise from unnecessary alerts

**You'll know exactly:**
1. When positions close and how much you made/lost
2. How your balance changed
3. Your total P&L across all trades
4. What positions are still open

Check your Telegram to see the simplified alerts in action! 📱
