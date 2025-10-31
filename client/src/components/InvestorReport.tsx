import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Download, TrendingDown, TrendingUp, Calendar } from 'lucide-react';

interface InvestorPosition {
  investor: string;
  capitalInvested: number;
  currentBalance: number;
  pnl: number;
  roiPercent: number;
  currentOwnership: number;
}

interface Period {
  periodNumber: number;
  startBalance: number;
  endBalance: number;
  gainLoss: number;
  roiPercent: number;
  ownership: Record<string, number>;
  allocations: Record<string, number>;
}

interface Deposit {
  date: string;
  investor: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
}

interface InvestorReportData {
  reportDate: string;
  fundBalance: number;
  totalCapital: number;
  overallPnl: number;
  overallRoi: number;
  investors: InvestorPosition[];
  periods: Period[];
  deposits: Deposit[];
  methodology: string;
}

export function InvestorReport() {
  const printRef = useRef<HTMLDivElement>(null);
  const [selectedDate, setSelectedDate] = useState<string>('current');

  // Fetch list of archived report dates
  const { data: archivedDates } = useQuery<{ dates: string[] }>({
    queryKey: ['investor-report-archived-dates'],
    queryFn: async () => {
      const res = await fetch('/api/account/investor-report/archived');
      if (!res.ok) throw new Error('Failed to fetch archived dates');
      return res.json();
    },
    refetchInterval: 300000, // Refetch every 5 minutes
  });

  // Fetch current or archived report based on selection
  const { data, isLoading, error } = useQuery<InvestorReportData>({
    queryKey: ['investor-report', selectedDate],
    queryFn: async () => {
      const url = selectedDate === 'current'
        ? '/api/account/investor-report'
        : `/api/account/investor-report/archived/${selectedDate}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch report');
      return res.json();
    },
    refetchInterval: selectedDate === 'current' ? 60000 : undefined, // Only refetch current report
  });

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <FileText className="h-4 w-4 mr-2" />
            IPR
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Loading Report...</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  if (error || !data) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <FileText className="h-4 w-4 mr-2" />
            IPR
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Error Loading Report</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-destructive">Failed to load investor report data.</p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="h-4 w-4 mr-2" />
          IPR
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span>MPI™ Fund - Investor Performance Report</span>
              <Select value={selectedDate} onValueChange={setSelectedDate}>
                <SelectTrigger className="w-[200px] no-print">
                  <Calendar className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current (Live)</SelectItem>
                  {archivedDates?.dates.map((date) => (
                    <SelectItem key={date} value={date}>
                      {new Date(date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handlePrint} size="sm" variant="secondary" className="no-print">
              <Download className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div ref={printRef} className="space-y-6 print:p-8">
          {/* Header */}
          <div className="text-center space-y-2 print:mb-8">
            <h1 className="text-3xl font-bold hidden print:block">MPI™ Fund</h1>
            <h2 className="text-xl font-semibold hidden print:block">Investor Performance Report</h2>
            <p className="text-sm text-muted-foreground">
              Report Date: {formatDate(data.reportDate)}
            </p>
            <p className="text-xs text-muted-foreground italic">{data.methodology}</p>
          </div>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Executive Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Fund Balance</p>
                  <p className="text-xl font-bold">{formatCurrency(data.fundBalance)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Capital</p>
                  <p className="text-xl font-bold">{formatCurrency(data.totalCapital)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Overall P&L</p>
                  <p className={`text-xl font-bold ${data.overallPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(data.overallPnl)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Overall ROI</p>
                  <p className={`text-xl font-bold ${data.overallRoi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatPercent(data.overallRoi)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Investor Positions */}
          <Card>
            <CardHeader>
              <CardTitle>Current Investor Positions</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Investor</TableHead>
                    <TableHead className="text-right">Capital Invested</TableHead>
                    <TableHead className="text-right">Current Balance</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    <TableHead className="text-right">ROI %</TableHead>
                    <TableHead className="text-right">Ownership %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.investors.map((inv) => (
                    <TableRow key={inv.investor}>
                      <TableCell className="font-medium">{inv.investor}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(inv.capitalInvested)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(inv.currentBalance)}</TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${inv.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(inv.pnl)}
                      </TableCell>
                      <TableCell className={`text-right font-mono ${inv.roiPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatPercent(inv.roiPercent)}
                      </TableCell>
                      <TableCell className="text-right font-mono">{inv.currentOwnership.toFixed(2)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Period-by-Period Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Period-by-Period Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.periods.map((period) => (
                  <div key={period.periodNumber} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-lg flex items-center">
                        Period {period.periodNumber}
                        {period.gainLoss >= 0 ? (
                          <TrendingUp className="h-5 w-5 ml-2 text-green-600" />
                        ) : (
                          <TrendingDown className="h-5 w-5 ml-2 text-red-600" />
                        )}
                      </h3>
                      <span className={`text-sm font-mono ${period.gainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(period.gainLoss)} ({formatPercent(period.roiPercent)})
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                      <div>
                        <span className="text-muted-foreground">Start Balance:</span>
                        <span className="ml-2 font-mono">{formatCurrency(period.startBalance)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">End Balance:</span>
                        <span className="ml-2 font-mono">{formatCurrency(period.endBalance)}</span>
                      </div>
                    </div>
                    <div className="border-t pt-3">
                      <p className="text-sm font-semibold mb-2">Allocations:</p>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.entries(period.allocations).map(([investor, amount]) => (
                          <div key={investor} className="text-sm">
                            <span className="font-medium">{investor}:</span>
                            <span className={`ml-2 font-mono ${(amount as number) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {formatCurrency(amount as number)}
                            </span>
                            <span className="text-xs text-muted-foreground ml-1">
                              ({period.ownership[investor]?.toFixed(1)}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Methodology Note */}
          <Card>
            <CardHeader>
              <CardTitle>Methodology</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This report uses a <strong>compounding period-based allocation system</strong>:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>Gains and losses compound into investor balances after each period</li>
                  <li>Ownership percentages recalculate when new capital is added</li>
                  <li>Future gains/losses split proportionally by updated percentages</li>
                  <li>Returns reflect the actual timing of capital deployment</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        <style dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page {
                margin: 1cm;
                size: A4;
              }

              /* Hide everything except dialog content */
              body > *:not([role="dialog"]) {
                display: none !important;
              }

              /* Hide dialog overlay and chrome */
              [role="dialog"] > [data-radix-portal] {
                display: none !important;
              }

              /* Show only the content */
              body, html {
                background: white !important;
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
              }

              /* Hide buttons, nav, header */
              button, nav, header, .no-print {
                display: none !important;
              }

              /* Remove dialog padding and max width for print */
              [role="dialog"] {
                position: static !important;
                max-width: none !important;
                max-height: none !important;
                overflow: visible !important;
                padding: 0 !important;
                margin: 0 !important;
              }

              /* Remove card shadows for cleaner print */
              .card {
                box-shadow: none !important;
                border: 1px solid #e5e7eb !important;
              }
            }
          `
        }} />
      </DialogContent>
    </Dialog>
  );
}
