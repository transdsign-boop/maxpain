// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

// Import console logger FIRST to capture all output
import "./console-logger";

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Clear any existing orchestrator intervals from previous runs
  const { liveDataOrchestrator } = await import('./live-data-orchestrator');
  liveDataOrchestrator.stopAll();
  console.log('🧹 Cleared existing orchestrator intervals');
  
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, async () => {
    log(`serving on port ${port}`);
    
    // Initialize strategy engine and auto-register strategies AFTER server is listening
    // This prevents blocking the HTTP server from opening port 5000 (120s timeout)
    try {
      const { strategyEngine } = await import('./strategy-engine');
      const { storage } = await import('./storage');
      
      // Start the strategy engine (this can be slow)
      console.log('🚀 Initializing strategy engine in background...');
      await strategyEngine.start();
      
      // Auto-register active strategies
      console.log('🔄 Checking for active strategies to auto-register...');
      const activeStrategies = await storage.getAllActiveStrategies();
      
      if (activeStrategies.length > 0) {
        console.log(`📋 Found ${activeStrategies.length} active strategy(ies) - registering with strategy engine...`);
        for (const strategy of activeStrategies) {
          console.log(`   - Registering: ${strategy.name} (paused: ${strategy.paused})`);
          await strategyEngine.registerStrategy(strategy);
          liveDataOrchestrator.start(strategy.id);
        }
        console.log('✅ Active strategies auto-registered successfully');
      } else {
        console.log('ℹ️  No active strategies found - ready for manual activation');
      }
    } catch (error) {
      console.error('❌ Error initializing trading strategies:', error);
      // Don't crash the server - just log the error
    }
  });
})();
