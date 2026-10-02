import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-overline">404</p>
      <h1 className="text-display">Page not found</h1>
      <p className="text-body">There is nothing at this address.</p>
      <Link href="/" className="btn btn-primary mt-3">
        Back to overview
      </Link>
    </main>
  );
}
