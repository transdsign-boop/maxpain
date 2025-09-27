import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ThemeToggle from "@/components/ThemeToggle";

// Pages
import Dashboard from "@/pages/Dashboard";
import NotFound from "@/pages/not-found";

// TODO: Add these pages back once created
// import StrategyConfig from "@/pages/StrategyConfig";
// import RiskManagement from "@/pages/RiskManagement";
// import Portfolio from "@/pages/Portfolio";
// import CascadeDetection from "@/pages/CascadeDetection";
// import Analytics from "@/pages/Analytics";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-background">
          <header className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground">Aster DEX Trading</h1>
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Connected" />
            </div>
            <ThemeToggle />
          </header>
          <main>
            <Router />
          </main>
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
