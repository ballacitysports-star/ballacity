import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { ChildSafetyPanel } from "@/components/child/ChildSafetyPanel";

export const Route = createFileRoute("/admin/child-safety")({
  head: () =>
    pageHead({
      path: "/admin/child-safety",
      title: "Child safety — ballaCity Admin",
      description: "Review parental consent, age-change reviews and guardian requests.",
      noindex: true,
    }),
  ssr: false,
  component: AdminChildSafetyPage,
});

function AdminChildSafetyPage() {
  return (
    <main className="page-shell py-6 pb-24">
      <Link to="/admin" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Admin
      </Link>
      <div className="mt-2 flex items-center gap-2 text-primary">
        <ShieldAlert className="h-5 w-5" aria-hidden />
        <span className="section-eyebrow">Child safety</span>
      </div>
      <h1 className="mt-1 page-title">Consent, age reviews &amp; guardian requests</h1>
      <ChildSafetyPanel />
    </main>
  );
}
