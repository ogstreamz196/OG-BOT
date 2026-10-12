import { UnlockConfirmDialog } from "./UnlockConfirmDialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songId: string;
  songTitle?: string | null;
  balance: number;
  singleCost: number;
  busy?: boolean;
  onConfirm: () => void;
};

/** Owners pay for the first track and receive its alternate take free. */
export function OwnerUnlockDialog({ singleCost, ...props }: Props) {
  return <UnlockConfirmDialog {...props} cost={singleCost} royalty={0} includesSecondTake />;
}
