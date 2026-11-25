import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandwritingDocument, PageData } from '../../types/document';
import type { ProviderAvailability } from '../../types/recognition';
import { RecognitionStatus, Spinner } from './RecognitionStatus';
import { AutoTextarea, TextBlockEditor } from './TextBlockEditor';
import { Menu } from '../common/Menu';
import { AlertIcon, ChevronDownIcon, CopyIcon, DownloadIcon, RefreshIcon, TrashIcon, TypeIcon, WifiOffIcon, CheckIcon } from '../common/icons';
import { overallStatus } from '../../state/snapshot';

export type ExportKind = 'txt' | 'text-pdf' | 'ink-pdf';

interface Props {
  doc: HandwritingDocument;
  currentPage: number;
  availability: ProviderAvailability | null;
  online: boolean;
  onEditBlock(pageId: string, blockId: string, value: string): void;
  onRevertBlock(pageId: string, blockId: string): void;
  onResolveConflict(pageId: string, blockId: string, choice: 'keep-mine' | 'use-new'): void;
  onTypedText(pageId: string, value: string): void;
  onRetry(pageId?: string): void;
  onClearText(pageId: string): void;
  onRestoreHidden(pageId: string): void;
  onCopyAll(): Promise<boolean>;
  onExport(kind: ExportKind): Promise<void>;
  onGoToPage(index: number): void;
}

function PageSection({ page, index, isCurrent, props }: { page: PageData; index: number; isCurrent: boolean; props: Props }) {
  const t = page.text;
  const pageId = page.id;
  const onChange = useCallback((blockId: string, v: string) => props.onEditBlock(pageId, blockId, v), [props, pageId]);
  const onRevert = useCallback((blockId: string) => props.onRevertBlock(pageId, blockId), [props, pageId]);
  const onResolve = useCallback(
    (blockId: string, c: 'keep-mine' | 'use-new') => props.onResolveConflict(pageId, blockId, c),
    [props, pageId],
  );
  const hasInk = page.strokes.length > 0;
  const [showTyped, setShowTyped] = useState(t.typedText.length > 0);
  const hiddenLines = t.hiddenStrokeIds.length > 0 && t.lines.length > t.blocks.length;

  return (
    <section
      data-page-section={index}
      className={`rounded-xl border bg-white px-4 pt-3 pb-4 transition-colors ${isCurrent ? 'border-slate-300 shadow-sm' : 'border-slate-200'}`}
    >
      <header className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => props.onGoToPage(index)}
          className="text-[12px] font-semibold tracking-wide text-slate-500 uppercase hover:text-slate-800"
          title="Show this page"
        >
          Page {index + 1}
        </button>
        {hasInk && <RecognitionStatus status={t.status} availability={props.availability} online={props.online} error={t.error} compact />}
        <div className="flex-1" />
        {hasInk && (
          <button
            type="button"
            onClick={() => props.onRetry(pageId)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            title="Run recognition again for this page"
          >
            <RefreshIcon size={13} /> Retry
          </button>
        )}
        <button
          type="button"
          onClick={() => props.onClearText(pageId)}
          disabled={!t.blocks.length && !t.typedText}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent"
          title="Clear the converted text for this page (handwriting is kept)"
        >
          <TrashIcon size={13} /> Clear
        </button>
      </header>

      {t.status === 'error' && t.error && (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-red-50 px-2.5 py-2 text-[12.5px] text-red-800 ring-1 ring-red-200 ring-inset">
          <AlertIcon size={15} className="mt-px shrink-0" />
          <div className="flex-1">{t.error}</div>
          <button className="font-semibold underline" onClick={() => props.onRetry(pageId)}>
            Retry
          </button>
        </div>
      )}
      {(t.status === 'unavailable' || (props.availability && !props.availability.available && hasInk && t.status !== 'recognized')) && (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-[12.5px] text-amber-900 ring-1 ring-amber-200 ring-inset">
          <AlertIcon size={15} className="mt-px shrink-0" />
          <div>
            {t.error || props.availability?.reason || 'Recognition is unavailable.'} Your handwriting is saved and will be
            converted once recognition is available.
          </div>
        </div>
      )}
      {t.status === 'pending-offline' && (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-[12.5px] text-amber-900 ring-1 ring-amber-200 ring-inset">
          <WifiOffIcon size={15} className="mt-px shrink-0" />
          <div>
            {props.online
              ? 'The recognition service could not be reached. Retrying automatically.'
              : 'You are offline. Handwriting is saved on this device; text will be converted when you reconnect.'}
          </div>
        </div>
      )}

      {t.blocks.length > 0 ? (
        <div className="-ml-2.5">
          {t.blocks.map((b) => (
            <TextBlockEditor key={b.id} block={b} onChange={onChange} onRevert={onRevert} onResolveConflict={onResolve} />
          ))}
        </div>
      ) : (
        !t.typedText &&
        !showTyped && (
          <p className="py-1 text-[13.5px] text-slate-400">
            {hasInk
              ? t.status === 'recognizing' || t.status === 'scheduled'
                ? 'Converting your handwriting…'
                : t.status === 'recognized'
                  ? 'No text recognised on this page.'
                  : 'Text will appear here once recognised.'
              : 'Write on the page — text appears here after a short pause.'}
          </p>
        )
      )}

      {hiddenLines && (
        <button className="mt-2 text-[12px] text-slate-500 underline hover:text-slate-800" onClick={() => props.onRestoreHidden(pageId)}>
          Some handwritten lines are excluded from the text. Show them again
        </button>
      )}

      {showTyped || t.typedText ? (
        <div className="mt-3 border-t border-dashed border-slate-200 pt-2">
          <div className="mb-0.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Typed notes</div>
          <AutoTextarea
            value={t.typedText}
            onChange={(v) => props.onTypedText(pageId, v)}
            placeholder="Type additional notes for this page…"
            aria-label={`Typed notes for page ${index + 1}`}
            className="min-h-[28px] text-[15px] leading-[1.6] text-slate-800 placeholder:text-slate-300"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowTyped(true)}
          className="mt-2 inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-700"
        >
          <TypeIcon size={13} /> Add typed notes
        </button>
      )}
    </section>
  );
}

export function TextOutputPanel(props: Props) {
  const { doc, currentPage } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [exporting, setExporting] = useState(false);
  const status = overallStatus(doc.pages.filter((p) => p.strokes.length).map((p) => p.text.status));
  const working = doc.pages.some((p) => p.text.status === 'recognizing');

  useEffect(() => {
    const root = scroller.current;
    if (!root || root.contains(document.activeElement)) return;
    root.querySelector(`[data-page-section="${currentPage}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentPage]);

  const copy = async () => {
    const ok = await props.onCopyAll();
    setCopied(ok ? 'ok' : 'fail');
    setTimeout(() => setCopied('idle'), 1800);
  };
  const doExport = async (k: ExportKind) => {
    setExporting(true);
    try {
      await props.onExport(k);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <h2 className="text-[13.5px] font-semibold text-slate-800">Converted text</h2>
        <RecognitionStatus status={status} availability={props.availability} online={props.online} />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => props.onRetry()}
          disabled={working}
          title="Retry recognition for all pages"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          <RefreshIcon size={15} /> <span className="hidden lg:inline">Retry</span>
        </button>
        <button
          type="button"
          onClick={copy}
          title="Copy all text"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-100"
        >
          {copied === 'ok' ? <CheckIcon size={15} className="text-emerald-600" /> : <CopyIcon size={15} />}
          <span className="hidden lg:inline">{copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy'}</span>
        </button>
        <Menu
          trigger={() => (
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-900 px-2.5 text-[12.5px] font-medium text-white hover:bg-slate-800"
            >
              {exporting ? <Spinner /> : <DownloadIcon size={15} />} Export <ChevronDownIcon size={14} />
            </button>
          )}
          items={[
            { label: 'Text as TXT', onSelect: () => void doExport('txt') },
            { label: 'Text as PDF', onSelect: () => void doExport('text-pdf') },
            { label: 'Handwriting as PDF', onSelect: () => void doExport('ink-pdf') },
          ]}
        />
      </div>
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3" data-testid="text-panel">
        {doc.pages.map((p, i) => (
          <PageSection key={p.id} page={p} index={i} isCurrent={i === currentPage} props={props} />
        ))}
        <p className="px-1 pb-4 text-[11.5px] leading-relaxed text-slate-400">
          Edits are kept with the handwriting they belong to. Lines you edited are marked in amber. If you change that
          handwriting later, you can choose whether to keep your edit.
        </p>
      </div>
    </div>
  );
}
