"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithEmail, signInWithGoogle } from "@/lib/auth";

export function SignInDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState<string | null>(null);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    const res = await signInWithEmail(email);
    setStatus(res.message);
  }

  async function handleGoogle() {
    const res = await signInWithGoogle();
    setStatus(res.message);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create an account</DialogTitle>
          <DialogDescription>
            Save this search and reload it later. Sign up with email or Google.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleEmail} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full">
            Continue with email
          </Button>
        </form>
        <div className="relative py-1 text-center text-xs text-muted-foreground">
          <span className="bg-background px-2">or</span>
        </div>
        <Button variant="outline" className="w-full" onClick={handleGoogle}>
          Continue with Google
        </Button>
        {status && (
          <p className="text-xs text-muted-foreground" role="status">
            {status}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
