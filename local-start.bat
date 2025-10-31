@echo off
REM MPI Liquidation Hunter - Local Docker Setup Script for Windows

echo ================================================
echo MPI Liquidation Hunter - Local Setup
echo ================================================
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo X Docker is not installed!
    echo.
    echo Please install Docker Desktop first:
    echo https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo X Docker is not running!
    echo.
    echo Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

echo [OK] Docker is installed and running
echo.

REM Check if .env file exists
if not exist .env (
    echo ! No .env file found!
    echo.
    echo Creating .env from template...
    copy .env.example .env >nul
    echo.
    echo [OK] Created .env file
    echo.
    echo IMPORTANT: You need to edit .env with your actual values:
    echo    - NEON_DATABASE_URL
    echo    - ASTER_API_KEY
    echo    - ASTER_SECRET_KEY
    echo    - SESSION_SECRET
    echo.
    echo You can find these values in your Replit 'Secrets' tab.
    echo.
    pause
    echo.
)

echo Starting MPI Liquidation Hunter Bot...
echo.

REM Build and start containers
docker-compose up -d --build

if %errorlevel% equ 0 (
    echo.
    echo ================================================
    echo [OK] Bot is now running!
    echo ================================================
    echo.
    echo Dashboard: http://localhost:5000
    echo.
    echo View logs:
    echo    docker-compose logs -f
    echo.
    echo Stop the bot:
    echo    docker-compose down
    echo.
    echo For more info, see LOCAL_SETUP.md
    echo.
) else (
    echo.
    echo X Failed to start the bot!
    echo.
    echo Check the errors above and:
    echo   1. Make sure .env has correct values
    echo   2. Try: docker-compose logs
    echo.
    pause
    exit /b 1
)

pause
