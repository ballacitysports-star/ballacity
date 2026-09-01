import { ReportDialog } from "@/components/ReportDialog";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  displayName: string;
};

/** Thin wrapper kept for existing call sites; delegates to ReportDialog. */
export function ReportUserDialog({ open, onOpenChange, userId, displayName }: Props) {
  return (
    <ReportDialog
      open={open}
      onOpenChange={onOpenChange}
      subjectType="user"
      reportedId={userId}
      subjectLabel={displayName}
    />
  );
}
