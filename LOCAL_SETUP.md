# Running MPI Liquidation Hunter Locally with Docker

This is a quick-start guide for running your bot locally on your own computer using Docker.

## What You'll Need

1. **Docker Desktop** installed on your computer
   - Download from: https://www.docker.com/products/docker-desktop/
   - Works on Windows, Mac, and Linux

2. **Your Replit environment variables** (from your current `.env` file)
   - `NEON_DATABASE_URL`
   - `ASTER_API_KEY`
   - `ASTER_SECRET_KEY`
   - `SESSION_SECRET`

## Step-by-Step Instructions

### 1. Get Your Code Locally

Since you already have your code on GitHub, clone it:

```bash
# Clone your repository
git clone https://github.com/transdsign-boop/maxpain.git
cd maxpain
```

### 2. Set Up Environment Variables

Copy the example environment file and add your real values:

```bash
# Create your .env file
cp .env.example .env
```

Now edit `.env` with your actual values. You can find these in your Replit "Secrets" tab:

```bash
# On Mac/Linux
nano .env

# On Windows
notepad .env
```

Paste your values from Replit:

```env
NEON_DATABASE_URL=postgresql://user:password@your-neon-host.neon.tech/database?sslmode=require
ASTER_API_KEY=your_actual_api_key
ASTER_SECRET_KEY=your_actual_secret_key
SESSION_SECRET=your_session_secret
NODE_ENV=production
```

**Save the file** and close the editor.

### 3. Run the Application

```bash
# Start the bot (this will build and run the container)
docker-compose up -d

# View the logs to make sure it's working
docker-compose logs -f
```

That's it! The bot is now running on your local machine.

### 4. Access the Dashboard

Open your browser and go to:
```
http://localhost:5000
```

You should see your MPI Liquidation Hunter dashboard!

## Common Commands

```bash
# Start the bot
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the bot
docker-compose down

# Restart the bot (after making code changes)
docker-compose down
docker-compose build
docker-compose up -d

# Check if container is running
docker-compose ps
```

## Troubleshooting

### "Port already in use"

If port 5000 is already being used, edit `docker-compose.yml` and change:

```yaml
ports:
  - "8080:5000"  # Change first number to any available port
```

Then access at `http://localhost:8080` instead.

### "Connection refused" or database errors

Make sure your `NEON_DATABASE_URL` includes `?sslmode=require` at the end.

### Build fails

Try a clean rebuild:

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Can't see logs

```bash
# Follow logs in real-time
docker-compose logs -f app

# See last 100 lines
docker-compose logs --tail=100 app
```

## Updating Your Local Bot

When you push new code to GitHub:

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose down
docker-compose build
docker-compose up -d
```

## Running Both Replit and Local Simultaneously

Yes, you can! Both can use the same Neon database. They will:
- Share the same trading data
- Both receive liquidation events
- Operate independently

Just make sure you don't have the same strategy active in both places to avoid duplicate trades.

## Stopping the Bot

```bash
# Stop but keep data
docker-compose down

# Stop and remove all data/volumes
docker-compose down -v
```

## Advantages of Running Locally

✅ **No Replit limits** - No bandwidth or CPU restrictions
✅ **Faster performance** - Dedicated resources
✅ **Always running** - Won't stop when you close browser
✅ **Free** - No Replit subscription needed
✅ **Full control** - Access to all system resources

## Need More Details?

For advanced deployment options (VPS, cloud providers, etc.), see:
- `README-DOCKER.md` - Comprehensive Docker deployment guide
- `MPI_LIQUIDATION_HUNTER_DOCUMENTATION.md` - Full bot documentation

## Quick Reference

```bash
# Status check
docker-compose ps

# View resource usage
docker stats

# Access container shell (for debugging)
docker-compose exec app sh

# View environment variables (debug)
docker-compose exec app env | grep ASTER

# Full restart
docker-compose restart
```

That's everything you need to run your bot locally! 🚀
