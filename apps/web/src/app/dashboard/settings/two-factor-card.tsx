'use client';

import { Download, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import QRCode from 'qrcode';
import { useState } from 'react';
import { toast } from 'sonner';
import { TotpCodeSchema, type TwoFactorSetupResponse } from '@selfship/shared';
import { CopyButton } from '@/components/servers/copy-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiRequestError } from '@/lib/api-client';
import { authApi } from '@/lib/auth/auth-api';
import { useAuth } from '@/lib/auth/auth-context';

type Mode = 'idle' | 'setup' | 'codes' | 'disable' | 'regenerate';

/** Shows an API error as a toast. */
function toastError(error: unknown, fallback: string): void {
  toast.error(error instanceof ApiRequestError ? error.message : fallback);
}

/**
 * Two-factor authentication settings: setup with a QR code, recovery codes
 * (shown once), turning it off, and new recovery codes.
 */
export function TwoFactorCard(): React.ReactNode {
  const { user, refresh } = useAuth();
  const [mode, setMode] = useState<Mode>('idle');
  const [setup, setSetup] = useState<(TwoFactorSetupResponse & { qr: string }) | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await authApi.setupTwoFactor();
      // Rendered in the browser: the secret never goes to a QR code service.
      const qr = await QRCode.toDataURL(response.otpauthUri, { margin: 1, width: 200 });
      setSetup({ ...response, qr });
      setCode('');
      setMode('setup');
    } catch (error) {
      toastError(error, 'Could not start the setup.');
    } finally {
      setBusy(false);
    }
  };

  /** Runs an action that needs the current code. */
  const withCode = async (action: (valid: string) => Promise<void>): Promise<void> => {
    const parsed = TotpCodeSchema.safeParse(code);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    try {
      await action(parsed.data);
      setCode('');
    } catch (error) {
      toastError(error, 'That code did not work.');
    } finally {
      setBusy(false);
    }
  };

  const codeInput = (
    <Input
      value={code}
      autoFocus
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      aria-label="6-digit code"
      className="w-36 font-mono tracking-widest"
      onChange={(event) => {
        setCode(event.target.value);
      }}
    />
  );

  const download = (): void => {
    const blob = new Blob([`Selfship recovery codes for ${user.email}\n\n${codes.join('\n')}\n`], {
      type: 'text/plain',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'selfship-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {user.twoFactorEnabled ? (
            <ShieldCheck className="size-4 text-emerald-600" />
          ) : (
            <ShieldOff className="text-muted-foreground size-4" />
          )}
          Two-factor authentication
        </CardTitle>
        <CardDescription>
          {user.twoFactorEnabled
            ? 'On. Signing in needs a code from your authenticator app.'
            : 'Protect your servers: after your password, sign-in also asks for a code from an authenticator app (1Password, Google Authenticator, Authy…).'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {mode === 'codes' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">
              Save these recovery codes somewhere safe. Each works once if you lose your phone. They
              won&apos;t be shown again.
            </p>
            <div className="bg-muted grid grid-cols-2 gap-2 rounded-lg p-3 font-mono text-sm">
              {codes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <div className="flex gap-2">
              <CopyButton text={codes.join('\n')} label="Copy" />
              <Button size="sm" variant="outline" onClick={download}>
                <Download />
                Download
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => {
                  setCodes([]);
                  setMode('idle');
                }}
              >
                I&apos;ve saved them
              </Button>
            </div>
          </div>
        ) : mode === 'setup' && setup ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">1. Scan this QR code with your authenticator app:</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL generated in the browser */}
            <img
              src={setup.qr}
              alt="QR code for your authenticator app"
              width={200}
              height={200}
              className="rounded-md border"
            />
            <p className="text-muted-foreground text-xs">
              Can&apos;t scan? Enter this key instead:{' '}
              <span className="font-mono break-all">{setup.secret}</span>
            </p>
            <p className="text-sm">2. Enter the 6-digit code it shows:</p>
            <div className="flex flex-wrap gap-2">
              {codeInput}
              <Button
                disabled={busy}
                onClick={() =>
                  void withCode(async (valid) => {
                    const result = await authApi.enableTwoFactor(valid);
                    setCodes(result.recoveryCodes);
                    setMode('codes');
                    await refresh();
                    toast.success('Two-factor authentication is on');
                  })
                }
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                Turn on
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMode('idle');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : mode === 'disable' || mode === 'regenerate' ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Enter a code from your app:</span>
            {codeInput}
            <Button
              variant={mode === 'disable' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() =>
                void withCode(async (valid) => {
                  if (mode === 'disable') {
                    await authApi.disableTwoFactor(valid);
                    setMode('idle');
                    await refresh();
                    toast.success('Two-factor authentication is off');
                  } else {
                    const result = await authApi.regenerateRecoveryCodes(valid);
                    setCodes(result.recoveryCodes);
                    setMode('codes');
                  }
                })
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {mode === 'disable' ? 'Turn off' : 'Create new codes'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setMode('idle');
              }}
            >
              Cancel
            </Button>
          </div>
        ) : user.twoFactorEnabled ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCode('');
                setMode('regenerate');
              }}
            >
              New recovery codes
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setCode('');
                setMode('disable');
              }}
            >
              Turn off
            </Button>
          </div>
        ) : (
          <Button className="self-start" disabled={busy} onClick={() => void start()}>
            {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            Set up two-factor
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
