import { cn, pspDisplayName } from '@/lib/utils';

// Icon marks for the two PSPs the engine has connectors for. Decorative only:
// the PSP name is always rendered as text next to the mark.

function PaystackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 25 28" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M22.32 2.663H1.306C.594 2.663 0 3.263 0 3.985v2.37c0 .74.594 1.324 1.307 1.324h21.012c.73 0 1.307-.602 1.324-1.323V4.002c0-.738-.594-1.34-1.323-1.34zm0 13.192H1.306a1.3 1.3 0 00-.924.388 1.33 1.33 0 00-.383.935v2.37c0 .74.594 1.323 1.307 1.323h21.012c.73 0 1.307-.584 1.324-1.322v-2.371c0-.739-.594-1.323-1.323-1.323zm-9.183 6.58H1.307c-.347 0-.68.139-.924.387a1.33 1.33 0 00-.383.935v2.37c0 .74.594 1.323 1.307 1.323H13.12c.73 0 1.307-.6 1.307-1.322v-2.371a1.29 1.29 0 00-1.29-1.323zM23.643 9.258H1.307c-.347 0-.68.14-.924.387a1.33 1.33 0 00-.383.936v2.37c0 .739.594 1.323 1.307 1.323h22.32c.73 0 1.306-.601 1.306-1.323v-2.37a1.301 1.301 0 00-1.29-1.323z"
        fill="#00C3F7"
      />
    </svg>
  );
}

function FlutterwaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="45 45 175 155" fill="none" aria-hidden="true" focusable="false">
      <path
        fill="#009a46"
        d="M48.23,79.89c0-9.37,2.74-17.37,8.49-23.12l10,10C55.59,77.86,65.31,112.34,97,144.06s66.19,41.43,77.31,30.32l10,10c-18.76,18.76-61.49,5.45-97.26-30.33C62.24,129.23,48.23,101.07,48.23,79.89Z"
      />
      <path
        fill="#ff5805"
        d="M111.29,193c-9.37,0-17.37-2.74-23.13-8.49l10-10c11.11,11.11,45.59,1.39,77.31-30.32S216.89,78,205.78,66.89l10-10c18.77,18.76,5.45,61.49-30.33,97.26C160.63,179,132.47,193,111.29,193Z"
      />
      <path
        fill="#f5afcb"
        d="M188.76,139.84c-6.07-17.48-18.47-36.16-34.92-52.6-35.77-35.78-78.5-49.1-97.26-30.33h0c-1.33,1.34-.18,4.65,2.58,7.41s6.07,3.9,7.4,2.57c11.12-11.11,45.6-1.39,77.31,30.33,15,15,26.18,31.75,31.57,47.25,4.72,13.59,4.26,24.55-1.24,30.05h0c-1.34,1.33-.18,4.65,2.57,7.4s6.07,3.91,7.41,2.57C193.79,174.88,195.42,159,188.76,139.84Z"
      />
      <path
        fill="#ff9b00"
        d="M215.76,56.91c-9.63-9.63-25.49-11.26-44.67-4.59-17.47,6.06-36.16,18.47-52.6,34.91C82.72,123,69.4,165.73,88.16,184.5h0c1.34,1.33,4.65.18,7.41-2.57s3.91-6.07,2.57-7.41C87,163.41,96.75,128.93,128.47,97.21c15-15,31.75-26.18,47.25-31.57,13.59-4.71,24.55-4.26,30.06,1.24h0c1.33,1.33,4.65.18,7.4-2.58S217.09,58.24,215.76,56.91Z"
      />
    </svg>
  );
}

export function PspIcon({ name, className }: { name: string; className?: string }) {
  const n = name.toLowerCase();
  if (n === 'paystack') return <PaystackIcon className={className} />;
  if (n === 'flutterwave') return <FlutterwaveIcon className={className} />;
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block rounded-sm bg-[var(--color-surface-300)]', className)}
    />
  );
}

/** PSP mark + name. */
export function PspName({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <PspIcon name={name} className="h-3.5 w-3.5 shrink-0" />
      <span>{pspDisplayName(name)}</span>
    </span>
  );
}
