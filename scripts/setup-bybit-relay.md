# 🚀 Simple Bybit API Setup (One-Time, 5 Minutes)

Your Bybit connection doesn't work because Replit's servers are blocked by Bybit. This setup creates a proxy that bypasses the block - **fully automated**, you just need 2 pieces of info from Cloudflare (free account).

## Step 1: Create Free Cloudflare Account (1 minute)

1. Go to: https://dash.cloudflare.com/sign-up
2. Sign up with your email (it's free, no credit card needed)
3. Verify your email

## Step 2: Get Your Account ID (30 seconds)

1. Go to: https://dash.cloudflare.com/
2. Look at the right sidebar - copy your **Account ID** (it looks like: `a1b2c3d4e5f6...`)

## Step 3: Get API Token (1 minute)

1. Go to: https://dash.cloudflare.com/profile/api-tokens
2. Click **"Create Token"**
3. Click **"Use template"** next to **"Edit Cloudflare Workers"**
4. Click **"Continue to summary"**
5. Click **"Create Token"**
6. Copy the token (starts with `...`)

## Step 4: Add to Replit Secrets (1 minute)

In your Replit project:
1. Click the **Secrets** icon (🔒) in the left sidebar
2. Add these secrets:
   - `CLOUDFLARE_API_TOKEN` = (paste the token from Step 3)
   - `CLOUDFLARE_ACCOUNT_ID` = (paste the ID from Step 2)

## Step 5: Run Automated Deployment (1 minute)

In your Replit Shell, run:
```bash
npm run deploy-worker
```

This will:
- ✅ Upload the proxy to Cloudflare (runs in non-blocked region)
- ✅ Configure all secrets automatically
- ✅ Give you the Worker URL to use

**That's it!** After this runs, your Bybit connection will work! 🎉

---

## Troubleshooting

**"CLOUDFLARE_API_TOKEN not found"**
- Make sure you added the secret in Step 4 (Secrets panel, not .env file)

**"Account ID invalid"**
- Double-check you copied the Account ID from the right sidebar at dash.cloudflare.com

**"Permission denied"**
- Make sure your API token has "Edit Cloudflare Workers" permission
