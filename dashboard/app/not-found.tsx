import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[var(--color-surface-0)] text-center px-4">
      <h2 className="text-display mb-4 text-[var(--color-surface-900)]">404 - Not Found</h2>
      <p className="text-body mb-8 text-[var(--color-surface-600)]">Could not find requested resource.</p>
      <Link href="/" className="btn bg-[var(--color-surface-900)] text-[var(--color-surface-0)] hover:opacity-90 px-6 py-3 rounded-md font-semibold transition-opacity">
        Return to Dashboard
      </Link>
    </div>
  );
}
