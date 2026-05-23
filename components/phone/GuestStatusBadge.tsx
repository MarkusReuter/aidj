'use client';

export type GuestSlotStatus =
  | { kind: 'free' }
  | { kind: 'queued'; position: number };

type Props = {
  status: GuestSlotStatus;
};

export default function GuestStatusBadge({ status }: Props) {
  if (status.kind === 'free') {
    return (
      <span className="rounded-full bg-green-500/20 px-3 py-1 text-xs font-semibold text-green-300">
        Slot frei
      </span>
    );
  }
  return (
    <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-200">
      Position {status.position}
    </span>
  );
}
