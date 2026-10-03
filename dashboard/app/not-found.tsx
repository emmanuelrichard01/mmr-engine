import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="t-caption num">404</p>
      <h1 className="t-display">Nothing at this address</h1>
      <p className="t-body">The page may have moved. The discrepancy list is now the Inbox.</p>
      <div className="mt-4 flex gap-2">
        <Link href="/" className="btn btn-primary">
          Overview
        </Link>
        <Link href="/inbox" className="btn btn-secondary">
          Inbox
        </Link>
      </div>
    </main>
  );
}
