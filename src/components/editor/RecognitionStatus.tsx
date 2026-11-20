import type { ProviderAvailability, RecognitionStatus as Status } from '../../types/recognition';
import { AlertIcon, CheckIcon, CloudIcon, WifiOffIcon } from '../common/icons';

interface Props {
  status: Status;
  availability: ProviderAvailability | null;
  online: boolean;
  error?: string | null;
  compact?: boolean;
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

export function describeStatus(status: Status, online: boolean, availability: ProviderAvailability | null) {
  if (availability && !availability.available && status !== 'recognized' && status !== 'idle') {
    return { tone: 'amber', label: 'Recognition not configured', icon: 'alert' as const };
  }
  switch (status) {
    case 'recognizing':
      return { tone: 'blue', label: 'Converting…', icon: 'spin' as const };
    case 'scheduled':
      return { tone: 'slate', label: 'Waiting for pause…', icon: 'dot' as const };
    case 'pending-offline':
      return { tone: 'amber', label: online ? 'Retrying soon' : 'Offline — text pending', icon: 'offline' as const };
    case 'error':
      return { tone: 'red', label: 'Recognition failed', icon: 'alert' as const };
    case 'unavailable':
      return { tone: 'amber', label: 'Recognition unavailable', icon: 'alert' as const };
    case 'recognized':
      return { tone: 'green', label: 'Up to date', icon: 'check' as const };
    default:
      return { tone: 'slate', label: 'Ready', icon: 'cloud' as const };
  }
}

const TONES: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

export function RecognitionStatus({ status, availability, online, error, compact }: Props) {
  const d = describeStatus(status, online, availability);
  const title = error || availability?.reason || d.label;
  return (
    <span
      role="status"
      title={title}
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap ring-1 ring-inset ${TONES[d.tone]}`}
    >
      {d.icon === 'spin' && <Spinner />}
      {d.icon === 'check' && <CheckIcon size={13} />}
      {d.icon === 'alert' && <AlertIcon size={13} />}
      {d.icon === 'offline' && <WifiOffIcon size={13} />}
      {d.icon === 'cloud' && <CloudIcon size={13} />}
      {d.icon === 'dot' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {!compact && d.label}
    </span>
  );
}
