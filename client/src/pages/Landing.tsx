import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown, TrendingUp, Target, Shield, Zap } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">Aster DEX Trading Platform</h1>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Button onClick={() => window.location.href = '/api/login'} data-testid="button-login">
              Log In
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">
            Professional Trading Platform for Aster DEX
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            Real-time liquidation monitoring and automated trading strategies. Track market movements and execute trades with precision.
          </p>
          <Button 
            size="lg" 
            onClick={() => window.location.href = '/api/login'}
            className="text-lg px-8"
            data-testid="button-get-started"
          >
            Get Started
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-16">
          <Card>
            <CardHeader>
              <Target className="h-12 w-12 mb-2 text-primary" />
              <CardTitle>Real-Time Liquidations</CardTitle>
              <CardDescription>
                Monitor live liquidation events across all cryptocurrency pairs on Aster DEX with instant notifications
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Zap className="h-12 w-12 mb-2 text-primary" />
              <CardTitle>Automated Trading</CardTitle>
              <CardDescription>
                Create and deploy trading strategies that automatically respond to market liquidations with customizable parameters
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Shield className="h-12 w-12 mb-2 text-primary" />
              <CardTitle>Risk Management</CardTitle>
              <CardDescription>
                Built-in stop-loss, take-profit, and position sizing controls to protect your capital
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="text-center">Ready to Start Trading?</CardTitle>
            <CardDescription className="text-center">
              Log in to access your personalized trading dashboard
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button 
              size="lg"
              onClick={() => window.location.href = '/api/login'}
              data-testid="button-login-bottom"
            >
              Log In to Dashboard
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
