'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Copies text to the clipboard and confirms briefly.
 *
 * @param props.text - Text to copy
 * @param props.label - Accessible label
 */
export function CopyButton({
  text,
  label = 'Copy',
}: {
  text: string;
  label?: string;
}): React.ReactNode {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      toast.error('Copy failed. Select the text and copy it manually.');
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void copy()}
      aria-label={label}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

/**
 * A command in a monospace box with a copy button.
 *
 * @param props.command - Shell command
 */
export function CommandBox({ command }: { command: string }): React.ReactNode {
  return (
    <div className="bg-muted flex items-start gap-2 rounded-lg border p-3">
      <code className="flex-1 font-mono text-xs leading-relaxed break-all">{command}</code>
      <CopyButton text={command} label="Copy" />
    </div>
  );
}
