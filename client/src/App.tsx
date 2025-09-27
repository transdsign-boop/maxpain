import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import ThemeToggle from "@/components/ThemeToggle";

// Pages
import Dashboard from "@/pages/Dashboard";
import TradingDashboard from "@/pages/TradingDashboard";
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
      <Route path="/trading" component={TradingDashboard} />
      {/* TODO: Add these routes back once pages are created
      <Route path="/strategies" component={StrategyConfig} />
      <Route path="/risk" component={RiskManagement} />
      <Route path="/portfolio" component={Portfolio} />
      <Route path="/cascade" component={CascadeDetection} />
      <Route path="/analytics" component={Analytics} />
      */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // Professional trading interface with wider sidebar
  const style = {
    "--sidebar-width": "20rem",       // 320px for better content
    "--sidebar-width-icon": "4rem",   // default icon width
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <div className="flex flex-col flex-1">
              <header className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="flex items-center gap-4">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-semibold text-foreground">Aster DEX Trading</h1>
                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Connected" />
                  </div>
                </div>
                <ThemeToggle />
              </header>
              <main className="flex-1 overflow-hidden">
                <Router />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
