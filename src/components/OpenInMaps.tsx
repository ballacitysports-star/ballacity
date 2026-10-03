import type { ReactNode } from "react";
import { Copy, Navigation } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Lets the viewer open an address in the map app they prefer. */
export function OpenInMaps({ address, children }: { address: string; children: ReactNode }) {
  const q = encodeURIComponent(address);
  const apps = [
    { label: "Apple Maps", url: `https://maps.apple.com/?daddr=${q}` },
    { label: "Google Maps", url: `https://www.google.com/maps/dir/?api=1&destination=${q}` },
    { label: "Waze", url: `https://waze.com/ul?q=${q}&navigate=yes` },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Get directions to ${address}`}
          className="block w-full text-left transition-colors hover:bg-surface-2/40"
        >
          {children}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Open directions in</DropdownMenuLabel>
        {apps.map((a) => (
          <DropdownMenuItem key={a.label} asChild>
            <a href={a.url} target="_blank" rel="noopener noreferrer">
              <Navigation className="mr-2 h-4 w-4" /> {a.label}
            </a>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard?.writeText(address).then(
              () => toast.success("Address copied"),
              () => toast.error("Couldn't copy address"),
            );
          }}
        >
          <Copy className="mr-2 h-4 w-4" /> Copy address
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
