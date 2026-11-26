import { memo, useState } from 'react';
import type { RecordingInfo, TranscriptSegment, VoiceDocument } from '../../types/speech';
import { SPEECH_LANGUAGES } from '../../types/speech';
import { AutoTextarea } from '../editor/TextBlockEditor';
import { Menu } from '../common/Menu';
import { IconButton } from '../common/IconButton';
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  PlusIcon,
  RedoIcon,
  RefreshIcon,
  TrashIcon,
  UndoIcon,
} from '../common/icons';
import { formatDuration } from './MicrophoneControls';
import { Spinner } from '../editor/RecognitionStatus';
import { MedicineSuggestions } from '../clinical/MedicineSuggestions';
import { SentenceSuggestion } from './SentenceSuggestion';
import type { SentenceCheckStatus } from '../../hooks/useSentenceCheck';

export interface TranscriptionPanelProps {
  doc: VoiceDocument;
  interim: string;
  recording: boolean;
  canUndo: boolean;
  canRedo: boolean;
  playingId: string | null;
  onUndo(): void;
  onRedo(): void;
  onEdit(segmentId: string, text: string): void;
  onDelete(segmentId: string): void;
  onToggleParagraph(segmentId: string): void;
  onRetry(segmentId: string): Promise<void>;
  onAddText(): void;
  onNewParagraph(): void;
  onCopy(): Promise<boolean>;
  onExport(kind: 'txt' | 'pdf'): Promise<void>;
  onClear(): void;
  onPlay(segment: TranscriptSegment): void;
  onPlayRecording(recording: RecordingInfo): void;
  onDownloadRecording(recording: RecordingInfo): void;
  onDeleteAudio(recording: RecordingInfo): void;
  sentenceCheck: { status: SentenceCheckStatus; message: string | null };
  onCheckSentences(): void;
  onApplySuggestion(segmentId: string, text: string): void;
  onDismissSuggestion(segmentId: string): void;
  /** Opens the consultation report for this dictation. */
  onOpenReport?(): void;
  hasReport?: boolean;
  reportBusy?: boolean;
}

const ParagraphIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <path d="M13 4v16" />
    <path d="M17 4v16" />
    <path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />
  </svg>
);
const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 4.5v15l12-7.5Z" />
  </svg>
);

function SegmentImpl({
  seg,
  hasAudio,
  playing,
  props,
}: {
  seg: TranscriptSegment;
  hasAudio: boolean;
  playing: boolean;
  props: TranscriptionPanelProps;
}) {
  const [retrying, setRetrying] = useState(false);
  const time = seg.startMs !== null ? formatDuration(seg.startMs) : null;
  if (seg.status === 'failed') {
    return (
      <div className={`${seg.paragraphStart ? 'mt-4' : 'mt-1'} rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-900 ring-1 ring-red-200 ring-inset`}>
        <div className="flex items-start gap-2">
          <AlertIcon size={15} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            Couldn't transcribe this part{time ? ` (at ${time})` : ''}. {seg.error}
          </div>
        </div>
        <div className="mt-2 flex gap-2 pl-6">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[12.5px] font-medium ring-1 ring-red-200 hover:bg-red-100"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              await props.onRetry(seg.id);
              setRetrying(false);
            }}
          >
            {retrying ? <Spinner /> : <RefreshIcon size={13} />} Retry transcription
          </button>
          <button type="button" className="rounded-md px-2 py-1 text-[12.5px] hover:bg-red-100" onClick={() => props.onDelete(seg.id)}>
            Remove
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={seg.paragraphStart ? 'mt-4 first:mt-0' : ''} data-segment-id={seg.id}>
      <div
        className={`group relative flex gap-2 rounded-md border-l-2 pr-1 transition-colors focus-within:bg-blue-50/40 hover:bg-slate-50 ${
          seg.edited || seg.source === 'typed' ? 'border-amber-400' : 'border-transparent'
        }`}
      >
        <span className="w-10 shrink-0 pt-[7px] text-right font-mono text-[10.5px] text-slate-400 tabular-nums select-none">
          {seg.source === 'typed' ? 'typed' : time}
        </span>
        <AutoTextarea
          value={seg.text}
          onChange={(v) => props.onEdit(seg.id, v)}
          aria-label={seg.source === 'typed' ? 'Typed text' : 'Transcribed text'}
          placeholder={seg.source === 'typed' ? 'Type here…' : ''}
          className="speech-text min-w-0 flex-1 py-[3px] text-[15.5px] leading-[1.65] text-slate-800 placeholder:text-slate-300"
        />
        <div className="flex shrink-0 items-start gap-0.5 pt-0.5 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          {hasAudio && (
            <button
              type="button"
              onClick={() => props.onPlay(seg)}
              title="Play this part of the recording"
              aria-label="Play audio"
              className={`rounded p-1.5 hover:bg-slate-200/70 ${playing ? 'text-blue-600' : 'text-slate-400'}`}
            >
              <PlayIcon />
            </button>
          )}
          <button
            type="button"
            onClick={() => props.onToggleParagraph(seg.id)}
            title={seg.paragraphStart ? 'Join with previous paragraph' : 'Start a new paragraph here'}
            aria-label="Toggle paragraph break"
            className={`rounded p-1.5 hover:bg-slate-200/70 ${seg.paragraphStart ? 'text-slate-600' : 'text-slate-400'}`}
          >
            <ParagraphIcon />
          </button>
          <button
            type="button"
            onClick={() => props.onDelete(seg.id)}
            title="Delete this part"
            aria-label="Delete"
            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>
      {seg.review?.suggestion && seg.review.forText === seg.text && !seg.review.dismissed && (
        <SentenceSuggestion
          text={seg.text}
          suggestion={seg.review.suggestion}
          reason={seg.review.reason}
          onApply={(t) => props.onApplySuggestion(seg.id, t)}
          onDismiss={() => props.onDismissSuggestion(seg.id)}
        />
      )}
      <MedicineSuggestions text={seg.text} onReplace={(t) => props.onEdit(seg.id, t)} className="mt-1 mb-1.5 ml-12" />
    </div>
  );
}
const Segment = memo(SegmentImpl);

export function TranscriptionPanel(props: TranscriptionPanelProps) {
  const { doc } = props;
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [busy, setBusy] = useState(false);
  const [showRecordings, setShowRecordings] = useState(false);
  const audioIds = new Set(doc.recordings.filter((r) => r.audioStored).map((r) => r.id));
  const empty = doc.segments.length === 0 && !props.interim;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 px-2 py-1">
        <h2 className="mr-1 px-1 text-[13.5px] font-semibold text-slate-800">Transcript</h2>
        <IconButton label="Undo" disabled={!props.canUndo} onClick={props.onUndo}>
          <UndoIcon />
        </IconButton>
        <IconButton label="Redo" disabled={!props.canRedo} onClick={props.onRedo}>
          <RedoIcon />
        </IconButton>
        <IconButton label="New paragraph for the next sentence" onClick={props.onNewParagraph}>
          <ParagraphIcon />
        </IconButton>
        <IconButton label="Add typed text" onClick={props.onAddText}>
          <PlusIcon />
        </IconButton>
        <div className="flex-1" />
        {props.onOpenReport && (
          <button
            type="button"
            onClick={props.onOpenReport}
            title="Turn this dictation into a clinical note and prescription"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-blue-700 hover:bg-blue-50"
            data-testid="open-report"
          >
            {props.reportBusy ? (
              <Spinner />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                <path d="M14 3v5h5M9 13h6M9 17h4" />
              </svg>
            )}
            <span className="hidden sm:inline">{props.reportBusy ? 'Writing report…' : props.hasReport ? 'Report' : 'Create report'}</span>
          </button>
        )}
        <button
          type="button"
          onClick={props.onCheckSentences}
          disabled={props.sentenceCheck.status === 'off' || props.sentenceCheck.status === 'checking' || !doc.segments.length}
          title={props.sentenceCheck.message ?? 'Look for sentences that may have been misheard'}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          data-testid="check-sentences"
        >
          {props.sentenceCheck.status === 'checking' ? (
            <Spinner />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m3 17 2 2 4-4" />
              <path d="M3 7h18M3 12h18M13 17h8" />
            </svg>
          )}
          <span className="hidden lg:inline">{props.sentenceCheck.status === 'checking' ? 'Checking…' : 'Check sentences'}</span>
        </button>
        <button
          type="button"
          onClick={async () => {
            const ok = await props.onCopy();
            setCopied(ok ? 'ok' : 'fail');
            setTimeout(() => setCopied('idle'), 1800);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-100"
        >
          {copied === 'ok' ? <CheckIcon size={15} className="text-emerald-600" /> : <CopyIcon size={15} />}
          <span className="hidden lg:inline">{copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy'}</span>
        </button>
        <Menu
          trigger={() => (
            <button type="button" className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-900 px-2.5 text-[12.5px] font-medium text-white hover:bg-slate-800">
              {busy ? <Spinner /> : <DownloadIcon size={15} />} Export <ChevronDownIcon size={14} />
            </button>
          )}
          items={(['txt', 'pdf'] as const).map((k) => ({
            label: k === 'txt' ? 'Text file (.txt)' : 'PDF',
            onSelect: async () => {
              setBusy(true);
              try {
                await props.onExport(k);
              } finally {
                setBusy(false);
              }
            },
          }))}
        />
        <IconButton label="Clear transcript" tone="danger" onClick={props.onClear} disabled={!doc.segments.length}>
          <TrashIcon size={16} />
        </IconButton>
      </div>

      {(props.sentenceCheck.status === 'unavailable' || props.sentenceCheck.status === 'error') && props.sentenceCheck.message && (
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-[12px] text-slate-500" role="status">
          Sentence check unavailable: {props.sentenceCheck.message}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5" data-testid="transcript">
        {empty ? (
          <div className="mx-auto mt-10 max-w-sm text-center text-[14px] leading-relaxed text-slate-400">
            Press the microphone and speak. Text appears here as you talk: provisional words in grey, confirmed text in black.
            You can edit everything afterwards.
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {doc.segments.map((s) => (
              <Segment
                key={s.id}
                seg={s}
                hasAudio={!!s.recordingId && audioIds.has(s.recordingId) && s.startMs !== null}
                playing={props.playingId === s.id}
                props={props}
              />
            ))}
            {props.interim && (
              <div className="mt-1 flex gap-2" aria-live="polite">
                <span className="w-10 shrink-0 pt-[7px] text-right text-[10.5px] text-blue-500">…</span>
                <p className="speech-text flex-1 py-[3px] text-[15.5px] leading-[1.65] text-slate-400 italic" data-testid="interim">
                  {props.interim}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {doc.recordings.length > 0 && (
        <div className="shrink-0 border-t border-slate-200 bg-slate-50/60 px-3 py-2 sm:px-5">
          <button
            type="button"
            onClick={() => setShowRecordings((v) => !v)}
            className="flex w-full items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-800"
            aria-expanded={showRecordings}
          >
            <ChevronDownIcon size={14} className={showRecordings ? '' : '-rotate-90'} />
            Recordings ({doc.recordings.length}) · {doc.recordings.filter((r) => r.audioStored).length} with audio kept
          </button>
          {showRecordings && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {[...doc.recordings].reverse().map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-white px-2.5 py-1.5 text-[12.5px] ring-1 ring-slate-200">
                  <span className="text-slate-700">{new Date(r.startedAt).toLocaleString()}</span>
                  <span className="text-slate-500 tabular-nums">{formatDuration(r.durationMs)}</span>
                  <span className="text-slate-500">{SPEECH_LANGUAGES.find((l) => l.id === r.language)?.short}</span>
                  <span className="text-slate-400">{r.engine}</span>
                  <div className="flex-1" />
                  {r.audioStored ? (
                    <>
                      <button className="text-blue-700 hover:underline" onClick={() => props.onPlayRecording(r)}>
                        Play
                      </button>
                      <button className="text-blue-700 hover:underline" onClick={() => props.onDownloadRecording(r)}>
                        Download WAV
                      </button>
                      <button className="text-red-600 hover:underline" onClick={() => props.onDeleteAudio(r)}>
                        Delete audio
                      </button>
                    </>
                  ) : (
                    <span className="text-slate-400">audio not kept</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
