import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Wallet, Plus, Trash2, Edit, CalendarIcon, TrendingUp, DollarSign, PercentIcon, Download } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { formatPST, formatDatePST, formatTimePST, formatDateTimePST } from "@/lib/utils";

interface AccountLedgerEntry {
  id: string;
  userId: string;
  type: "deposit" | "withdrawal" | "manual_add" | "manual_subtract";
  amount: string;
  asset: string;
  timestamp: string;
  investor?: string | null;
  reason?: string | null;
  notes?: string | null;
  tranId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PNLData {
  totalCapital: string;
  currentBalance: string;
  pnl: string;
  roiPercent: string;
  ledgerEntries: number;
}

interface ContributorReturn {
  investor: string; // Keep DB field name for compatibility
  capital: string;
  currentBalance: string;
  pnl: string;
  roiPercent: string;
  capitalShare: string;
  entryCount: number;
}

interface EntryReturn {
  id: string;
  investor: string;
  timestamp: string;
  type: string;
  amount: string;
  baseline: string;
  pnl: string;
  currentBalance: string;
  roiPercent: string;
  reason: string;
  notes: string;
}

interface PendingTransfer {
  tranId: string;
  asset: string;
  income: string;
  amount: number;
  type: "deposit" | "withdrawal";
  time: number;
  timestamp: string;
  incomeType?: string; // Added to show transaction type
}

export default function AccountLedger() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);
  const [transferDetailsDialogOpen, setTransferDetailsDialogOpen] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<PendingTransfer | null>(null);
  const [editingEntry, setEditingEntry] = useState<AccountLedgerEntry | null>(null);
  const [selectedInvestor, setSelectedInvestor] = useState<string>("all");

  // Transfer details form state
  const [transferDetails, setTransferDetails] = useState({
    investor: "",
    reason: "",
    notes: "",
  });

  // Form state
  const [formData, setFormData] = useState({
    type: "manual_add" as "manual_add" | "manual_subtract",
    amount: "",
    asset: "USDT",
    timestamp: new Date(),
    investor: "",
    reason: "",
    notes: "",
  });

  // Fetch ledger entries
  const { data: entries = [], isLoading } = useQuery<AccountLedgerEntry[]>({
    queryKey: ["/api/account/ledger", selectedInvestor],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedInvestor && selectedInvestor !== "all") {
        params.append("investor", selectedInvestor);
      }
      const res = await fetch(`/api/account/ledger?${params}`);
      if (!res.ok) throw new Error("Failed to fetch ledger");
      return res.json();
    },
  });

  // Fetch PNL data
  const { data: pnlData } = useQuery<PNLData>({
    queryKey: ["/api/account/ledger/pnl", selectedInvestor],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedInvestor && selectedInvestor !== "all") {
        params.append("investor", selectedInvestor);
      }
      const res = await fetch(`/api/account/ledger/pnl?${params}`);
      if (!res.ok) throw new Error("Failed to fetch PNL");
      return res.json();
    },
  });

  // Fetch contributor returns
  const { data: contributorReturns = [] } = useQuery<ContributorReturn[]>({
    queryKey: ["/api/account/ledger/investors-returns"],
    queryFn: async () => {
      const res = await fetch("/api/account/ledger/investors-returns");
      if (!res.ok) throw new Error("Failed to fetch contributor returns");
      const data = await res.json();
      return data.investors || []; // Extract investors array from response
    },
  });

  // Fetch individual entry returns (time-weighted ROI per entry)
  const { data: entryReturns = [] } = useQuery<EntryReturn[]>({
    queryKey: ["/api/account/ledger/entries-returns"],
    queryFn: async () => {
      const res = await fetch("/api/account/ledger/entries-returns");
      if (!res.ok) throw new Error("Failed to fetch entry returns");
      const data = await res.json();
      return data.entries || [];
    },
  });

  // Fetch pending transfers
  const { data: pendingTransfers = [], refetch: refetchPending } = useQuery<PendingTransfer[]>({
    queryKey: ["/api/account/ledger/pending-transfers"],
    queryFn: async () => {
      const res = await fetch("/api/account/ledger/pending-transfers");
      if (!res.ok) throw new Error("Failed to fetch pending transfers");
      const data = await res.json();
      return data.transfers || [];
    },
    enabled: pendingDialogOpen, // Only fetch when dialog is open
  });

  // Add transfer to ledger with details
  const addTransferMutation = useMutation({
    mutationFn: async (data: { transfer: PendingTransfer; details: typeof transferDetails }) => {
      const res = await fetch("/api/account/ledger/from-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tranId: data.transfer.tranId,
          asset: data.transfer.asset,
          amount: data.transfer.amount,
          type: data.transfer.type,
          timestamp: data.transfer.timestamp,
          investor: data.details.investor || null,
          reason: data.details.reason || null,
          notes: data.details.notes || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to add transfer");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Transfer Added",
        description: "Successfully added transfer to ledger",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/pnl"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/investors-returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/entries-returns"] });
      refetchPending(); // Refresh pending list
      setTransferDetailsDialogOpen(false);
      setSelectedTransfer(null);
      setTransferDetails({ investor: "", reason: "", notes: "" });
    },
    onError: () => {
      toast({
        title: "Add Failed",
        description: "Failed to add transfer to ledger",
        variant: "destructive",
      });
    },
  });

  const handleAddTransfer = (transfer: PendingTransfer) => {
    setSelectedTransfer(transfer);
    setTransferDetails({ investor: "", reason: "", notes: "" });
    setTransferDetailsDialogOpen(true);
  };

  const handleSubmitTransfer = () => {
    if (editingEntry) {
      // Updating existing transfer entry
      updateTransferMutation.mutate({
        id: editingEntry.id,
        investor: transferDetails.investor,
        reason: transferDetails.reason,
        notes: transferDetails.notes,
      });
    } else if (selectedTransfer) {
      // Adding new transfer
      addTransferMutation.mutate({ transfer: selectedTransfer, details: transferDetails });
    }
  };

  // Add/Edit manual entry
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const url = editingEntry
        ? `/api/account/ledger/manual/${editingEntry.id}`
        : "/api/account/ledger/manual";
      const method = editingEntry ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          timestamp: data.timestamp.toISOString(),
        }),
      });
      if (!res.ok) throw new Error("Failed to save entry");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: editingEntry ? "Entry Updated" : "Entry Added",
        description: `Successfully ${editingEntry ? "updated" : "added"} ledger entry`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/pnl"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/investors-returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/entries-returns"] });
      setDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({
        title: "Save Failed",
        description: "Failed to save ledger entry",
        variant: "destructive",
      });
    },
  });

  // Delete any entry (manual or transfer)
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/account/ledger/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete entry");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Entry Deleted",
        description: "Successfully deleted ledger entry",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/pnl"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/investors-returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/entries-returns"] });
    },
    onError: () => {
      toast({
        title: "Delete Failed",
        description: "Failed to delete ledger entry",
        variant: "destructive",
      });
    },
  });

  // Update transfer entry details (investor, reason, notes only)
  const updateTransferMutation = useMutation({
    mutationFn: async (data: { id: string; investor: string; reason: string; notes: string }) => {
      const res = await fetch(`/api/account/ledger/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          investor: data.investor || null,
          reason: data.reason || null,
          notes: data.notes || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update entry");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Entry Updated",
        description: "Successfully updated ledger entry details",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/pnl"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/investors-returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/ledger/entries-returns"] });
      setTransferDetailsDialogOpen(false);
      setSelectedTransfer(null);
      setTransferDetails({ investor: "", reason: "", notes: "" });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update ledger entry",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      type: "manual_add",
      amount: "",
      asset: "USDT",
      timestamp: new Date(),
      investor: "",
      reason: "",
      notes: "",
    });
    setEditingEntry(null);
  };

  const handleEdit = (entry: AccountLedgerEntry) => {
    // Check if it's a transfer entry (has tranId)
    if (entry.tranId) {
      // For transfers, only allow editing investor/reason/notes
      setEditingEntry(entry);
      setTransferDetails({
        investor: entry.investor || "",
        reason: entry.reason || "",
        notes: entry.notes || "",
      });
      setTransferDetailsDialogOpen(true);
    } else {
      // For manual entries, allow editing everything
      setEditingEntry(entry);
      setFormData({
        type: entry.type as "manual_add" | "manual_subtract",
        amount: entry.amount,
        asset: entry.asset,
        timestamp: new Date(entry.timestamp),
        investor: entry.investor || "",
        reason: entry.reason || "",
        notes: entry.notes || "",
      });
      setDialogOpen(true);
    }
  };

  const handleSave = () => {
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount greater than 0",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate(formData);
  };

  // Get unique investors for filter
  const investors = Array.from(
    new Set(entries.map((e) => e.investor).filter(Boolean))
  ).sort();

  return (
    <div className="border-2 border-white rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm text-muted-foreground uppercase tracking-wider font-semibold">
            Account Ledger
          </div>
          <Badge variant="outline" className="ml-2">
            {entries.length} entries
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPendingDialogOpen(true)}
          >
            <Download className="h-4 w-4 mr-2" />
            View Transfers
          </Button>
          <Button
            size="sm"
            onClick={() => {
              resetForm();
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Manual Entry
          </Button>
        </div>
      </div>

      {/* Capital Distribution Summary */}
      {contributorReturns.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Capital Distribution (Go-Forward Share)
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Current capital allocation and future gain/loss distribution percentages.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-xs text-muted-foreground uppercase">
                    <th className="text-left py-2 px-3">Contributor</th>
                    <th className="text-right py-2 px-3">Total Capital</th>
                    <th className="text-right py-2 px-3">Current Balance</th>
                    <th className="text-right py-2 px-3">P&L</th>
                    <th className="text-right py-2 px-3">Avg ROI %</th>
                    <th className="text-right py-2 px-3">Distribution %</th>
                    <th className="text-right py-2 px-3">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {contributorReturns.map((contributor) => (
                    <tr key={contributor.investor} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-3 px-3 font-semibold">
                        {contributor.investor}
                      </td>
                      <td className="py-3 px-3 text-right font-mono">
                        ${parseFloat(contributor.capital).toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono">
                        ${parseFloat(contributor.currentBalance).toFixed(2)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono font-semibold ${
                          parseFloat(contributor.pnl) >= 0
                            ? "text-[rgb(190,242,100)]"
                            : "text-[rgb(251,146,60)]"
                        }`}
                      >
                        {parseFloat(contributor.pnl) >= 0 ? "+" : ""}$
                        {parseFloat(contributor.pnl).toFixed(2)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono font-semibold ${
                          parseFloat(contributor.roiPercent) >= 0
                            ? "text-[rgb(190,242,100)]"
                            : "text-[rgb(251,146,60)]"
                        }`}
                      >
                        {parseFloat(contributor.roiPercent) >= 0 ? "+" : ""}
                        {parseFloat(contributor.roiPercent).toFixed(2)}%
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-muted-foreground font-semibold">
                        {parseFloat(contributor.capitalShare).toFixed(2)}%
                      </td>
                      <td className="py-3 px-3 text-right text-muted-foreground">
                        {contributor.entryCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ROI Per Entry (Individual Deposits) */}
      {entryReturns.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Individual Deposit Performance
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Each deposit entry tracked separately. ROI calculated from deposit date forward (time-weighted).
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-xs text-muted-foreground uppercase">
                    <th className="text-left py-2 px-3">Contributor</th>
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-right py-2 px-3">Amount</th>
                    <th className="text-right py-2 px-3">Current Balance</th>
                    <th className="text-right py-2 px-3">P&L</th>
                    <th className="text-right py-2 px-3">ROI %</th>
                    <th className="text-left py-2 px-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {entryReturns.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-3 px-3 font-semibold">
                        {entry.investor}
                      </td>
                      <td className="py-3 px-3 text-xs text-muted-foreground">
                        {formatDateTimePST(entry.timestamp)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono">
                        ${parseFloat(entry.amount).toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono">
                        ${parseFloat(entry.currentBalance).toFixed(2)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono font-semibold ${
                          parseFloat(entry.pnl) >= 0
                            ? "text-[rgb(190,242,100)]"
                            : "text-[rgb(251,146,60)]"
                        }`}
                      >
                        {parseFloat(entry.pnl) >= 0 ? "+" : ""}$
                        {parseFloat(entry.pnl).toFixed(2)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono font-semibold ${
                          parseFloat(entry.roiPercent) >= 0
                            ? "text-[rgb(190,242,100)]"
                            : "text-[rgb(251,146,60)]"
                        }`}
                      >
                        {parseFloat(entry.roiPercent) >= 0 ? "+" : ""}
                        {parseFloat(entry.roiPercent).toFixed(2)}%
                      </td>
                      <td className="py-3 px-3 text-xs text-muted-foreground">
                        {entry.reason || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PNL Summary */}
      {pnlData && (
        <div className="grid grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
          <div>
            <div className="text-xs text-muted-foreground uppercase mb-1">
              Total Capital
            </div>
            <div className="text-2xl font-mono font-bold">
              ${pnlData.totalCapital}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase mb-1">
              Current Balance
            </div>
            <div className="text-2xl font-mono font-bold">
              ${pnlData.currentBalance}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase mb-1">
              P&L
            </div>
            <div
              className={`text-2xl font-mono font-bold ${
                parseFloat(pnlData.pnl) >= 0
                  ? "text-[rgb(190,242,100)]"
                  : "text-[rgb(251,146,60)]"
              }`}
            >
              {parseFloat(pnlData.pnl) >= 0 ? "+" : ""}${pnlData.pnl}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase mb-1">
              ROI
            </div>
            <div
              className={`text-2xl font-mono font-bold ${
                parseFloat(pnlData.roiPercent) >= 0
                  ? "text-[rgb(190,242,100)]"
                  : "text-[rgb(251,146,60)]"
              }`}
            >
              {parseFloat(pnlData.roiPercent) >= 0 ? "+" : ""}
              {pnlData.roiPercent}%
            </div>
          </div>
        </div>
      )}

      {/* Filter */}
      {investors.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <Label className="text-sm font-semibold text-blue-600 dark:text-blue-400">
            Filter by Contributor:
          </Label>
          <Select value={selectedInvestor} onValueChange={setSelectedInvestor}>
            <SelectTrigger className="w-[220px] h-9 border-blue-500/40 bg-background hover:border-blue-500 transition-colors">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Contributors</SelectItem>
              {investors.map((inv) => (
                <SelectItem key={inv} value={inv!}>
                  {inv}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Ledger Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs text-muted-foreground uppercase">
              <th className="text-left py-2 px-3">Date & Time</th>
              <th className="text-left py-2 px-3">Type</th>
              <th className="text-right py-2 px-3">Amount</th>
              <th className="text-left py-2 px-3">Contributor</th>
              <th className="text-left py-2 px-3">Reason</th>
              <th className="text-right py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted-foreground">
                  No entries yet. Sync exchange transfers or add manual entries.
                </td>
              </tr>
            )}
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/50">
                <td className="py-3 px-3 text-xs">
                  <div>{formatDatePST(entry.timestamp)}</div>
                  <div className="text-muted-foreground">
                    {formatTimePST(entry.timestamp)}
                  </div>
                </td>
                <td className="py-3 px-3">
                  <Badge
                    variant={
                      entry.type === "deposit" || entry.type === "manual_add"
                        ? "default"
                        : "destructive"
                    }
                  >
                    {entry.type.replace("_", " ")}
                  </Badge>
                </td>
                <td
                  className={`py-3 px-3 text-right font-mono font-semibold ${
                    entry.type === "deposit" || entry.type === "manual_add"
                      ? "text-[rgb(190,242,100)]"
                      : "text-[rgb(251,146,60)]"
                  }`}
                >
                  {entry.type === "deposit" || entry.type === "manual_add" ? "+" : "-"}
                  ${parseFloat(entry.amount).toFixed(2)} {entry.asset}
                </td>
                <td className="py-3 px-3 font-medium">
                  {entry.investor || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-3 px-3 text-xs">
                  {entry.reason || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-3 px-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(entry)}
                      title={entry.tranId ? "Edit details (contributor, reason, notes)" : "Edit entry"}
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this entry?")) {
                          deleteMutation.mutate(entry.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingEntry ? "Edit Manual Entry" : "Add Manual Entry"}
            </DialogTitle>
            <DialogDescription>
              Record capital additions or subtractions with contributor details
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value) =>
                  setFormData({ ...formData, type: value as any })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual_add">Add Capital</SelectItem>
                  <SelectItem value="manual_subtract">Subtract Capital</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.amount}
                onChange={(e) =>
                  setFormData({ ...formData, amount: e.target.value })
                }
              />
            </div>

            <div>
              <Label>Asset</Label>
              <Select
                value={formData.asset}
                onValueChange={(value) =>
                  setFormData({ ...formData, asset: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USDT">USDT</SelectItem>
                  <SelectItem value="USDF">USDF</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Date & Time</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formatPST(formData.timestamp, "MMMM d, yyyy h:mm a")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={formData.timestamp}
                    onSelect={(date) =>
                      date && setFormData({ ...formData, timestamp: date })
                    }
                  />
                  <div className="p-3 border-t space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Label className="text-xs">Hour</Label>
                        <Input
                          type="number"
                          min="0"
                          max="23"
                          value={formData.timestamp.getHours()}
                          onChange={(e) => {
                            const newDate = new Date(formData.timestamp);
                            newDate.setHours(parseInt(e.target.value) || 0);
                            setFormData({ ...formData, timestamp: newDate });
                          }}
                        />
                      </div>
                      <div className="flex-1">
                        <Label className="text-xs">Minute</Label>
                        <Input
                          type="number"
                          min="0"
                          max="59"
                          value={formData.timestamp.getMinutes()}
                          onChange={(e) => {
                            const newDate = new Date(formData.timestamp);
                            newDate.setMinutes(parseInt(e.target.value) || 0);
                            setFormData({ ...formData, timestamp: newDate });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>Contributor (Optional)</Label>
              <Input
                placeholder="Who does this capital belong to?"
                value={formData.investor}
                onChange={(e) =>
                  setFormData({ ...formData, investor: e.target.value })
                }
              />
            </div>

            <div>
              <Label>Reason (Optional)</Label>
              <Input
                placeholder="Why was capital added/removed?"
                value={formData.reason}
                onChange={(e) =>
                  setFormData({ ...formData, reason: e.target.value })
                }
              />
            </div>

            <div>
              <Label>Notes (Optional)</Label>
              <Input
                placeholder="Additional notes..."
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {editingEntry ? "Update" : "Add"} Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending Transfers Dialog */}
      <Dialog open={pendingDialogOpen} onOpenChange={setPendingDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Exchange Transfers (All Assets)</DialogTitle>
            <DialogDescription>
              Select which transfers to add to your account ledger. Showing all TRANSFER and TRANSFER_*_* transactions across all assets.
            </DialogDescription>
          </DialogHeader>

          {pendingTransfers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No pending transfers found. All transfers have been added to ledger.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground mb-4">
                Found {pendingTransfers.length} pending transfer{pendingTransfers.length !== 1 ? 's' : ''}
              </div>

              <div className="border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr className="text-xs text-muted-foreground uppercase">
                      <th className="text-left py-2 px-3">Date</th>
                      <th className="text-left py-2 px-3">Transaction Type</th>
                      <th className="text-left py-2 px-3">Type</th>
                      <th className="text-right py-2 px-3">Amount</th>
                      <th className="text-left py-2 px-3">Asset</th>
                      <th className="text-left py-2 px-3">Tran ID</th>
                      <th className="text-center py-2 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingTransfers.map((transfer) => (
                      <tr key={transfer.tranId} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-3 px-3 text-xs">
                          {formatPST(transfer.timestamp, "MMM d, yyyy h:mm a")}
                        </td>
                        <td className="py-3 px-3 text-xs">
                          <Badge variant="outline" className="text-xs">
                            {transfer.incomeType || 'UNKNOWN'}
                          </Badge>
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            variant={transfer.type === "deposit" ? "default" : "outline"}
                            className={
                              transfer.type === "deposit"
                                ? "bg-[rgb(190,242,100)] text-black"
                                : "border-[rgb(251,146,60)] text-[rgb(251,146,60)]"
                            }
                          >
                            {transfer.type}
                          </Badge>
                        </td>
                        <td className={`py-3 px-3 text-right font-mono font-semibold ${
                          transfer.type === "deposit"
                            ? "text-[rgb(190,242,100)]"
                            : "text-[rgb(251,146,60)]"
                        }`}>
                          {transfer.type === "deposit" ? "+" : "-"}${transfer.amount.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 font-mono">{transfer.asset}</td>
                        <td className="py-3 px-3 text-xs font-mono text-muted-foreground">
                          {transfer.tranId}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAddTransfer(transfer)}
                          >
                            Add to Ledger
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Details Dialog */}
      <Dialog open={transferDetailsDialogOpen} onOpenChange={setTransferDetailsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingEntry ? "Edit Transfer Details" : "Add Transfer to Ledger"}</DialogTitle>
            <DialogDescription>
              {editingEntry
                ? "Update contributor, reason, and notes for this transfer entry."
                : "Add details for this transfer before adding it to your ledger."}
            </DialogDescription>
          </DialogHeader>

          {(selectedTransfer || editingEntry) && (
            <div className="space-y-4">
              {/* Transfer Summary */}
              <div className="border rounded-lg p-3 bg-muted/50">
                <div className="text-sm font-semibold mb-2">Transfer Details</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Type:</div>
                  <div>
                    <Badge
                      variant={(selectedTransfer?.type || editingEntry?.type) === "deposit" ? "default" : "outline"}
                      className={
                        (selectedTransfer?.type || editingEntry?.type) === "deposit"
                          ? "bg-[rgb(190,242,100)] text-black"
                          : "border-[rgb(251,146,60)] text-[rgb(251,146,60)]"
                      }
                    >
                      {selectedTransfer?.incomeType || editingEntry?.type.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground">Amount:</div>
                  <div className={`font-mono font-semibold ${
                    (selectedTransfer?.type || editingEntry?.type) === "deposit"
                      ? "text-[rgb(190,242,100)]"
                      : "text-[rgb(251,146,60)]"
                  }`}>
                    {(selectedTransfer?.type || editingEntry?.type) === "deposit" ? "+" : "-"}$
                    {selectedTransfer ? selectedTransfer.amount.toFixed(2) : parseFloat(editingEntry?.amount || "0").toFixed(2)} {selectedTransfer?.asset || editingEntry?.asset}
                  </div>
                  <div className="text-muted-foreground">Date:</div>
                  <div className="font-mono text-xs">
                    {formatPST(selectedTransfer?.timestamp || editingEntry?.timestamp || new Date(), "MMM d, yyyy h:mm a")}
                  </div>
                </div>
              </div>

              {/* Details Form */}
              <div>
                <Label>Contributor (Optional)</Label>
                <Input
                  placeholder="Who does this capital belong to?"
                  value={transferDetails.investor}
                  onChange={(e) =>
                    setTransferDetails({ ...transferDetails, investor: e.target.value })
                  }
                />
              </div>

              <div>
                <Label>Reason (Optional)</Label>
                <Input
                  placeholder="Why was this transfer made?"
                  value={transferDetails.reason}
                  onChange={(e) =>
                    setTransferDetails({ ...transferDetails, reason: e.target.value })
                  }
                />
              </div>

              <div>
                <Label>Notes (Optional)</Label>
                <Input
                  placeholder="Additional notes..."
                  value={transferDetails.notes}
                  onChange={(e) =>
                    setTransferDetails({ ...transferDetails, notes: e.target.value })
                  }
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setTransferDetailsDialogOpen(false);
                setSelectedTransfer(null);
                setEditingEntry(null);
                setTransferDetails({ investor: "", reason: "", notes: "" });
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitTransfer}
              disabled={addTransferMutation.isPending || updateTransferMutation.isPending}
            >
              {editingEntry ? "Update" : "Add to Ledger"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
