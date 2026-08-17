import { useState } from "react";
import { useGetMembers, useAddMember, useRemoveMember } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMembersQueryKey } from "@workspace/api-client-react";
import { Trash2, UserPlus, Shield, Copy, Check, GitCompare } from "lucide-react";
import { Link } from "wouter";

export default function Settings() {
  const { user } = useAuth();
  const { data: members, isLoading } = useGetMembers();
  const addMember = useAddMember();
  const removeMember = useRemoveMember();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newUserId, setNewUserId] = useState("");
  const [copied, setCopied] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserId.trim()) return;
    try {
      await addMember.mutateAsync({ data: { userId: newUserId.trim() } });
      toast({ title: "Partner added", description: "They can now sign in to the app." });
      setNewUserId("");
      queryClient.invalidateQueries({ queryKey: getGetMembersQueryKey() });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not add partner. Check the user ID and try again." });
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm("Remove this person? They will lose access to the app.")) return;
    try {
      await removeMember.mutateAsync({ userId });
      toast({ title: "Partner removed" });
      queryClient.invalidateQueries({ queryKey: getGetMembersQueryKey() });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not remove partner." });
    }
  };

  const handleCopyId = () => {
    if (!user?.id) return;
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8 pb-12 max-w-2xl">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your couple's access and your account.</p>
      </div>

      {/* Platform Parity */}
      <Link href="/parity">
        <Card className="border-none shadow-md cursor-pointer hover:shadow-lg transition-shadow group">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <GitCompare className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Platform Parity</p>
                  <p className="text-sm text-muted-foreground">See which features exist on web vs mobile</p>
                </div>
              </div>
              <span className="text-muted-foreground group-hover:text-foreground transition-colors text-lg">→</span>
            </div>
          </CardContent>
        </Card>
      </Link>

      {/* Your account */}
      <Card className="border-none shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <CardTitle>Your Account</CardTitle>
          </div>
          <CardDescription>Share your User ID with your partner so they can add you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-muted rounded-lg px-4 py-3 font-mono text-sm text-foreground overflow-hidden text-ellipsis whitespace-nowrap">
              {user?.id ?? "—"}
            </div>
            <Button variant="outline" size="icon" onClick={handleCopyId} className="shrink-0 h-11 w-11">
              {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Signed in as <strong>{[user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email}</strong>
          </p>
        </CardContent>
      </Card>

      {/* Members */}
      <Card className="border-none shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            <CardTitle>Couple Access</CardTitle>
          </div>
          <CardDescription>
            Only these two accounts can access the app. The first two people to sign in are automatically registered.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-12 bg-muted rounded-lg" />
              <div className="h-12 bg-muted rounded-lg" />
            </div>
          ) : (
            <div className="space-y-2">
              {members?.map((m) => (
                <div key={m.userId} className="flex items-center justify-between bg-muted/50 rounded-xl px-4 py-3">
                  <div>
                    <p className="font-semibold text-foreground">{m.userName ?? "Unknown"}</p>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">{m.userId}</p>
                  </div>
                  {m.userId !== user?.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-9 w-9"
                      onClick={() => handleRemove(m.userId)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                  {m.userId === user?.id && (
                    <span className="text-xs bg-primary/10 text-primary font-medium px-2 py-1 rounded-full">You</span>
                  )}
                </div>
              ))}
              {members?.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-4">No one registered yet.</p>
              )}
            </div>
          )}

          {/* Add member form */}
          {(members?.length ?? 0) < 2 && (
            <form onSubmit={handleAdd} className="space-y-3 pt-2 border-t border-border/50">
              <p className="text-sm font-medium text-foreground">Add your partner by their User ID</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Paste Replit user ID..."
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  className="font-mono text-sm h-11 bg-card"
                />
                <Button type="submit" disabled={!newUserId.trim() || addMember.isPending} className="h-11 px-5 shrink-0">
                  {addMember.isPending ? "Adding…" : "Add"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Ask your partner to find their User ID on this Settings page, then paste it here.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
