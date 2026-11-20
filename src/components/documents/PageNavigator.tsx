import { ChevronLeftIcon, ChevronRightIcon, TrashIcon } from '../common/icons';
import { IconButton } from '../common/IconButton';

interface Props {
  current: number;
  total: number;
  onGoTo(index: number): void;
  onDeletePage(): void;
}

export function PageNavigator({ current, total, onGoTo, onDeletePage }: Props) {
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Pages">
      <IconButton label="Previous page" disabled={current <= 0} onClick={() => onGoTo(current - 1)}>
        <ChevronLeftIcon />
      </IconButton>
      <span className="min-w-[52px] text-center text-[12.5px] font-medium tabular-nums text-slate-600" aria-live="polite">
        {current + 1} / {total}
      </span>
      <IconButton label="Next page" disabled={current >= total - 1} onClick={() => onGoTo(current + 1)}>
        <ChevronRightIcon />
      </IconButton>
      <IconButton label="Delete this page" tone="danger" onClick={onDeletePage}>
        <TrashIcon size={16} />
      </IconButton>
    </div>
  );
}
