# Docker Deployment Guide for Aster DEX Liquidations Dashboard

This guide explains how to run the Aster DEX Liquidations Dashboard using Docker outside of Replit.

## Prerequisites

- Docker installed (version 20.10 or higher)
- Docker Compose installed (version 2.0 or higher)
- Neon PostgreSQL database (the same one you're using on Replit)
- Aster DEX API credentials

## Quick Start

### 1. Download the Project

You can download the project from Replit in several ways:

**Option A: Using Git (Recommended)**
```bash
# If your Replit is connected to GitHub, clone it directly
git clone https://github.com/your-username/your-repo.git
cd your-repo
```

**Option B: Download ZIP**
- In Replit, click the three dots menu → Download as ZIP
- Extract the ZIP file on your local machine
- Navigate to the extracted folder

### 2. Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your actual values
nano .env  # or use your preferred text editor
```

Required environment variables:
- `NEON_DATABASE_URL` - Your Neon PostgreSQL connection string (same as Replit)
- `ASTER_API_KEY` - Your Aster DEX API key
- `ASTER_SECRET_KEY` - Your Aster DEX secret key
- `SESSION_SECRET` - A random secret for session encryption

### 3. Build and Run

```bash
# Build and start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```

The application will be available at `http://localhost:5000`

## Alternative: Using Docker Without Compose

If you prefer to use Docker commands directly:

```bash
# Build the image
docker build -t aster-dex-dashboard .

# Run the container
docker run -d \
  --name aster-dex \
  -p 5000:5000 \
  -e NEON_DATABASE_URL="your_neon_url" \
  -e ASTER_API_KEY="your_api_key" \
  -e ASTER_SECRET_KEY="your_secret_key" \
  -e SESSION_SECRET="your_session_secret" \
  aster-dex-dashboard

# View logs
docker logs -f aster-dex

# Stop the container
docker stop aster-dex
docker rm aster-dex
```

## Production Deployment

### Using a Cloud Provider

**DigitalOcean App Platform:**
1. Create a new App from your GitHub repository
2. Select Docker as the build method
3. Set environment variables in the dashboard
4. Deploy

**AWS ECS/Fargate:**
1. Push image to ECR: `docker tag aster-dex-dashboard:latest <your-ecr-repo>`
2. Create ECS task definition with environment variables
3. Create ECS service

**Google Cloud Run:**
```bash
# Build and push to Google Container Registry
gcloud builds submit --tag gcr.io/PROJECT-ID/aster-dex-dashboard

# Deploy to Cloud Run
gcloud run deploy aster-dex-dashboard \
  --image gcr.io/PROJECT-ID/aster-dex-dashboard \
  --platform managed \
  --set-env-vars NEON_DATABASE_URL="...",ASTER_API_KEY="...",ASTER_SECRET_KEY="...",SESSION_SECRET="..."
```

**Fly.io:**
```bash
# Install Fly CLI and login
flyctl auth login

# Launch the app
flyctl launch

# Set secrets
flyctl secrets set NEON_DATABASE_URL="your_url"
flyctl secrets set ASTER_API_KEY="your_key"
flyctl secrets set ASTER_SECRET_KEY="your_secret"
flyctl secrets set SESSION_SECRET="your_session_secret"

# Deploy
flyctl deploy
```

### Using Your Own Server (VPS)

1. **Install Docker on your server:**
```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

2. **Upload your project:**
```bash
# From your local machine
scp -r /path/to/project user@your-server-ip:/home/user/aster-dex
```

3. **Run on server:**
```bash
ssh user@your-server-ip
cd /home/user/aster-dex
docker-compose up -d
```

4. **Setup reverse proxy (optional but recommended):**

Using Nginx:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Important Notes

### Database Connection
- This app uses the **same Neon database** as your Replit deployment
- Make sure the connection string includes `?sslmode=require`
- Both Replit and Docker deployments can run simultaneously using the same database

### WebSocket Connections
- The app uses WebSockets for real-time updates
- Ensure your firewall/reverse proxy supports WebSocket connections
- WebSocket endpoint: `ws://your-domain/ws`

### Port Configuration
- Default port: 5000
- Change in `docker-compose.yml` if needed: `"8080:5000"` (maps port 8080 externally to 5000 internally)

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose logs app

# Common issues:
# - Missing environment variables
# - Invalid database connection string
# - Port already in use
```

### Database connection errors
```bash
# Test database connectivity
docker run --rm -it postgres:alpine psql "$NEON_DATABASE_URL"

# Make sure SSL mode is enabled
# URL should end with: ?sslmode=require
```

### Build failures
```bash
# Clean rebuild
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Memory issues
```bash
# Increase Docker memory limit in Docker Desktop settings
# Or add memory limits to docker-compose.yml:
services:
  app:
    deploy:
      resources:
        limits:
          memory: 512M
```

## Updating the Application

```bash
# Pull latest changes (if using Git)
git pull

# Rebuild and restart
docker-compose down
docker-compose build
docker-compose up -d
```

## Monitoring

### View real-time logs
```bash
docker-compose logs -f app
```

### Check container health
```bash
docker-compose ps
```

### Resource usage
```bash
docker stats
```

## Security Checklist

- [ ] Change `SESSION_SECRET` to a strong random value
- [ ] Never commit `.env` file to version control
- [ ] Use HTTPS in production (setup SSL certificate)
- [ ] Keep Docker and images updated
- [ ] Set up firewall rules to restrict access
- [ ] Use Docker secrets for sensitive data in production

## Getting Help

If you encounter issues:
1. Check the logs: `docker-compose logs -f`
2. Verify environment variables are set correctly
3. Ensure database connection string is valid
4. Check that Aster DEX API credentials are correct

## Advantages Over Replit

✅ **Full control** - Run on any infrastructure  
✅ **No resource limits** - Scale as needed  
✅ **Lower costs** - Use cheaper VPS providers  
✅ **Better performance** - Dedicated resources  
✅ **Custom domains** - Easy SSL/HTTPS setup  
✅ **Backup control** - Manage your own backups

The Docker deployment gives you complete control while maintaining the exact same functionality as your Replit version.
