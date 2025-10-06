# Bybit API Relay Worker

This Cloudflare Worker acts as a secure proxy to bypass Bybit's geo-blocking restrictions on Replit servers.

## Setup Instructions

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Set Worker Secrets

You need to configure three secrets:

```bash
# Your Bybit API credentials (same ones stored in the app database)
wrangler secret put BYBIT_API_KEY
wrangler secret put BYBIT_API_SECRET

# Generate a random auth token for Replit to authenticate with the Worker
# Use a strong random string (e.g., openssl rand -hex 32)
wrangler secret put RELAY_AUTH_TOKEN
```

### 4. Deploy the Worker

```bash
wrangler deploy
```

After deployment, you'll get a Worker URL like:
```
https://bybit-api-relay.YOUR-SUBDOMAIN.workers.dev
```

### 5. Configure Replit Backend

Add these environment variables to your Replit project:

```env
BYBIT_WORKER_URL=https://bybit-api-relay.YOUR-SUBDOMAIN.workers.dev
BYBIT_WORKER_AUTH_TOKEN=<same-token-from-step-3>
```

## Testing

Test the health endpoint:
```bash
curl https://bybit-api-relay.YOUR-SUBDOMAIN.workers.dev/health
```

Expected response:
```json
{
  "status": "healthy",
  "bybit": "reachable",
  "timestamp": "1234567890"
}
```

## Security

- Worker validates all requests with `RELAY_AUTH_TOKEN`
- Bybit credentials are stored only in Worker secrets (never exposed)
- CORS is currently set to `*` - restrict to your Replit domain in production
- All traffic uses HTTPS/TLS

## Monitoring

View logs:
```bash
wrangler tail
```

## Updating Secrets

To rotate credentials:
```bash
wrangler secret put BYBIT_API_KEY
wrangler secret put BYBIT_API_SECRET
```
