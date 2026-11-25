import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { SpeechLanguage, TranscriptSegment, VoiceDocument, VoiceSnapshot, RecordingInfo } from '../types/speech';
import type { VoiceStorageAdapter } from '../storage/VoiceStorage';
import { IndexedDBVoiceStorage } from '../storage/VoiceStorage';
import type { SpeechRecognitionProvider } from '../recognition/speech/SpeechRecognitionProvider';
import {
  createSpeechProvider,
  loadSpeechSettings,
  saveSpeechSettings,
  type SpeechSettings,
} from '../recognition/speech/speechSettings';
import { useVoiceDocument } from '../hooks/useVoiceDocument';
import { useSpeechRecognition, type RecorderPhase } from '../hooks/useSpeechRecognition';
import { useSentenceCheck } from '../hooks/useSentenceCheck';
import { useAutosave, type SaveStatus } from '../hooks/useAutosave';
import { useMediaQuery, useOnlineStatus } from '../hooks/useOnlineStatus';
import { buildVoiceSnapshot, transcriptText } from '../state/voiceText';
import { ConfirmProvider, useConfirm } from '../components/common/ConfirmDialog';
import { LanguageSelector } from '../components/voice/LanguageSelector';
import { MicrophoneControls } from '../components/voice/MicrophoneControls';
import { RecordingStatus } from '../components/voice/RecordingStatus';
import { TranscriptionPanel } from '../components/voice/TranscriptionPanel';
import { VoiceSettingsDialog } from '../components/voice/VoiceSettingsDialog';
import { EvaluationPanel } from '../components/voice/EvaluationPanel';
import { Spinner } from '../components/editor/RecognitionStatus';
import { AlertIcon, XIcon } from '../components/common/icons';
import { copyToClipboard, downloadBlob, safeFileName } from '../utils/exportUtils';
import { exportVoicePdf, exportVoiceText } from '../utils/voiceExport';

export interface VoiceEditorStatus {
  phase: RecorderPhase;
  save: SaveStatus;
  online: boolean;
  title: string;
  recording: boolean;
}

export interface VoiceToTextEditorHandle {
  getSnapshot(): VoiceSnapshot | null;
  setTitle(title: string): void;
  /** Stops an active recording (finishing pending transcription) and saves. */
  stopAndSave(): Promise<void>;
  flush(): Promise<void>;
}

export interface VoiceToTextEditorProps {
  documentId: string;
  /** Initial language for new documents (existing documents keep theirs). */
  language?: SpeechLanguage;
  initialTitle?: string;
  storage?: VoiceStorageAdapter;
  /** Supply an engine directly (e.g. ClinicFlow's own server). Default: from user settings. */
  provider?: SpeechRecognitionProvider;
  /** When false (e.g. another tab is shown), an active recording is paused. */
  active?: boolean;
  onTranscriptChange?(snapshot: VoiceSnapshot): void;
  onSave?(snapshot: VoiceSnapshot): void;
  onStatusChange?(status: VoiceEditorStatus): void;
  className?: string;
  ref?: Ref<VoiceToTextEditorHandle>;
}

let sharedStorage: VoiceStorageAdapter | null = null;
const defaultStorage = () => (sharedStorage ??= new IndexedDBVoiceStorage());

/**
 * Self-contained voice dictation editor: language selection, recording
 * controls, live (interim + final) transcription, editing with undo/redo,
 * autosave, export and accuracy testing. Independent of the handwriting module
 * and of any clinic data.
 */
export function VoiceToTextEditor(props: VoiceToTextEditorProps) {
  return (
    <ConfirmProvider>
      <VoiceInner {...props} />
    </ConfirmProvider>
  );
}

function VoiceInner(props: VoiceToTextEditorProps) {
  const storage = useMemo(() => props.storage ?? defaultStorage(), [props.storage]);
  const confirm = useConfirm();
  const online = useOnlineStatus();
  const wide = useMediaQuery('(min-width: 900px)');
  const [settings, setSettings] = useState<SpeechSettings>(loadSpeechSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0);
  const setupRef = useRef<HTMLDivElement>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);

  const { provider, reason } = useMemo(() => {
    if (props.provider) return { provider: props.provider, reason: undefined };
    return createSpeechProvider(settings);
  }, [props.provider, settings]);

  const { state, dispatch, stateRef, loadState, loadError } = useVoiceDocument(props.documentId, storage, props.initialTitle);
  const doc = state.doc;

  // New documents take the host's preferred language.
  const appliedInitialLanguage = useRef(false);
  useEffect(() => {
    if (!doc || appliedInitialLanguage.current) return;
    appliedInitialLanguage.current = true;
    if (props.language && doc.segments.length === 0 && doc.language !== props.language) dispatch({ type: 'setLanguage', language: props.language });
  }, [doc, props.language, dispatch]);

  const speech = useSpeechRecognition({ provider, providerReason: reason, settings, storage, stateRef, dispatch });
  const live = speech.phase !== 'idle';
  const sentenceCheck = useSentenceCheck(doc, dispatch, settings, speech.pending > 0);

  const cbs = useRef(props);
  cbs.current = props;
  const onSaved = useCallback((d: VoiceDocument) => cbs.current.onSave?.(buildVoiceSnapshot(d)), []);
  const save = useAutosave(doc, state.dirtyVersion, storage, onSaved, 600);

  // Persist immediately when a recording finishes (don't wait for the autosave delay).
  const prevPhase = useRef(speech.phase);
  useEffect(() => {
    if (prevPhase.current !== 'idle' && speech.phase === 'idle') void save.flush();
    prevPhase.current = speech.phase;
  }, [speech.phase, save]);

  /* ------------------------- pause when hidden / left ------------------------- */
  const active = props.active ?? true;
  useEffect(() => {
    if (!active && speech.phase === 'recording') {
      speech.pause();
      setNotice('Recording paused because you switched to another tab. Press Resume to continue.');
    }
  }, [active, speech]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && speech.phase === 'recording') {
        speech.pause();
        setNotice('Recording paused because the app went to the background.');
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [speech]);

  /* --------------------------------- callbacks -------------------------------- */
  const prevText = useRef<string | null>(null);
  useEffect(() => {
    if (!doc || !cbs.current.onTranscriptChange) return;
    const text = transcriptText(doc.segments);
    if (prevText.current !== null && text !== prevText.current) cbs.current.onTranscriptChange(buildVoiceSnapshot(doc));
    prevText.current = text;
  }, [doc]);

  useEffect(() => {
    cbs.current.onStatusChange?.({ phase: speech.phase, save: save.status, online, title: doc?.title ?? '', recording: live });
  }, [speech.phase, save.status, online, doc?.title, live]);

  useImperativeHandle(
    props.ref,
    () => ({
      getSnapshot: () => (stateRef.current.doc ? buildVoiceSnapshot(stateRef.current.doc) : null),
      setTitle: (title) => dispatch({ type: 'setTitle', title }),
      stopAndSave: async () => {
        await speech.stop();
        await new Promise((r) => setTimeout(r, 0));
        await save.flush();
      },
      flush: () => save.flush(),
    }),
    [dispatch, save, speech, stateRef],
  );

  /* -------------------------------- shortcuts -------------------------------- */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dispatch]);

  /* ---------------------------------- audio ---------------------------------- */
  const stopPlayback = () => {
    audioEl.current?.pause();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
    setPlayingId(null);
  };
  useEffect(() => stopPlayback, []);

  const play = async (recording: RecordingInfo, from?: number, to?: number, id?: string) => {
    stopPlayback();
    const wav = await storage.loadAudio(recording.id).catch(() => null);
    if (!wav) {
      setNotice('This recording is no longer stored on this device.');
      return;
    }
    const url = URL.createObjectURL(wav);
    audioUrl.current = url;
    const el = audioEl.current ?? (audioEl.current = new Audio());
    el.src = url;
    el.currentTime = from ? from / 1000 : 0;
    el.ontimeupdate = () => {
      if (to !== undefined && el.currentTime * 1000 >= to) stopPlayback();
    };
    el.onended = stopPlayback;
    setPlayingId(id ?? recording.id);
    await el.play().catch(() => stopPlayback());
  };

  /* --------------------------------- render ---------------------------------- */
  if (loadState !== 'ready' || !doc) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
        {loadState === 'error' ? `Could not open this document: ${loadError}` : (<><Spinner /> Opening…</>)}
      </div>
    );
  }

  const caps = provider?.capabilities;
  const available = speech.availability?.available ?? false;
  // Why recording can't start right now (shown next to the mic, not hidden further down).
  const blockedReason = live
    ? null
    : !provider
      ? reason ?? 'No speech engine is selected.'
      : speech.checking && !speech.availability
        ? null
        : !available
          ? speech.availability?.reason ?? 'The speech engine is not available.'
          : null;
  const httpsBlocked =
    typeof location !== 'undefined' && location.protocol === 'https:' && settings.engine === 'server' && settings.serverUrl.startsWith('http:');
  const hasFinal = doc.segments.some((s) => s.source === 'speech' && s.status === 'final');

  const controls = (
    <div className={`space-y-4 ${wide ? 'p-5' : 'p-4'}`}>
      <LanguageSelector
        value={doc.language}
        onChange={(language) => dispatch({ type: 'setLanguage', language })}
        disabled={live}
        support={caps?.languages}
      />

      <MicrophoneControls
        phase={speech.phase}
        elapsedMs={speech.elapsedMs}
        level={speech.level}
        voiceActive={speech.voiceActive}
        canPause={caps?.pauseResume ?? false}
        showLevel={caps?.levelMeter ?? false}
        disabled={false}
        onStart={() => {
          setNotice(null);
          if (blockedReason) {
            // Explain instead of doing nothing.
            setNudge((n) => n + 1);
            setTimeout(() => setupRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
            return;
          }
          void speech.start();
        }}
        onPause={speech.pause}
        onResume={() => {
          setNotice(null);
          speech.resume();
        }}
        onStop={() => {
          setNotice(null);
          void speech.stop();
        }}
      />

      {blockedReason && (
        <div
          ref={setupRef}
          key={nudge}
          role="alert"
          className={`rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] text-amber-950 ring-1 ring-amber-300 ring-inset ${nudge ? 'animate-[pulse_0.6s_ease-in-out_2]' : ''}`}
        >
          <div className="font-semibold">Voice recognition isn't set up yet</div>
          <p className="mt-0.5 leading-snug">{blockedReason}</p>
          {httpsBlocked && (
            <p className="mt-1 leading-snug">
              This page is https, so a phone or iPad can only use a speech server with an <b>https</b> address. See README §10.4.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-primary h-8 px-3 text-[12.5px]" onClick={() => setSettingsOpen(true)}>
              Open voice settings
            </button>
            <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" onClick={() => void speech.refreshAvailability()}>
              Check again
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-[12.5px] text-blue-900 ring-1 ring-blue-200 ring-inset">
          <span className="flex-1">{notice}</span>
          <button aria-label="Dismiss" onClick={() => setNotice(null)}>
            <XIcon size={14} />
          </button>
        </div>
      )}
      {speech.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-800 ring-1 ring-red-200 ring-inset">
          <AlertIcon size={15} className="mt-px shrink-0" />
          <span className="flex-1">{speech.error}</span>
          <button aria-label="Dismiss" onClick={() => speech.setError(null)}>
            <XIcon size={14} />
          </button>
        </div>
      )}

      <RecordingStatus
        phase={speech.phase}
        voiceActive={speech.voiceActive}
        pending={speech.pending}
        interim={speech.interim}
        hasFinal={hasFinal}
        permission={speech.permission}
      />

      <div className="rounded-xl border border-slate-200 bg-white p-3 text-[12.5px]">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${available ? (caps?.thirdParty ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-300'}`}
            aria-hidden="true"
          />
          <span className="flex-1 font-medium text-slate-800">{provider?.displayName ?? 'No engine'}</span>
          <button className="font-medium text-blue-700 hover:underline" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
        <p className="mt-1 leading-snug text-slate-500">
          {speech.checking
            ? 'Checking engine…'
            : !available
              ? speech.availability?.reason ?? reason ?? 'Not available.'
              : speech.availability?.reason ?? caps?.dataLocation}
        </p>
        {available && caps && (
          <p className="mt-1 leading-snug text-slate-400">
            {caps.streaming === 'native' ? 'Live word-by-word results.' : 'Live preview while you speak; each sentence is finalised when you pause.'}
            {!online && !caps.worksOffline && ' Needs internet — you are offline.'}
          </p>
        )}
        {!available && !speech.checking && (
          <button className="mt-1.5 text-[12px] font-medium text-blue-700 hover:underline" onClick={() => void speech.refreshAvailability()}>
            Check again
          </button>
        )}
      </div>

      <EvaluationPanel
        doc={doc}
        engine={provider?.id ?? 'none'}
        onSave={(result) => dispatch({ type: 'addEvaluation', result })}
        onDelete={(id) => dispatch({ type: 'deleteEvaluation', id })}
      />

      <p className="text-[11.5px] text-slate-400">
        {save.status === 'saving' || save.status === 'pending' ? 'Saving…' : save.status === 'error' ? `Save failed: ${save.error}` : 'Saved on this device'}
        {settings.retainAudio && caps?.canRetainAudio ? ' · audio is kept' : ' · audio is discarded after transcription'}
      </p>
    </div>
  );

  const panel = (
    <TranscriptionPanel
      doc={doc}
      interim={speech.interim}
      recording={live}
      canUndo={state.undo.length > 0}
      canRedo={state.redo.length > 0}
      playingId={playingId}
      onUndo={() => dispatch({ type: 'undo' })}
      onRedo={() => dispatch({ type: 'redo' })}
      onEdit={(segmentId, text) => dispatch({ type: 'editSegment', segmentId, text })}
      onDelete={(segmentId) => dispatch({ type: 'deleteSegment', segmentId })}
      onToggleParagraph={(segmentId) => dispatch({ type: 'toggleParagraph', segmentId })}
      onRetry={speech.retrySegment}
      onAddText={() => {
        dispatch({ type: 'addTypedSegment', text: '' });
        setTimeout(() => {
          const areas = document.querySelectorAll<HTMLTextAreaElement>('[data-testid=transcript] textarea');
          areas[areas.length - 1]?.focus();
        }, 30);
      }}
      onNewParagraph={() => {
        speech.newParagraph();
        setNotice('The next sentence will start a new paragraph.');
        setTimeout(() => setNotice((n) => (n?.startsWith('The next sentence') ? null : n)), 2500);
      }}
      onCopy={() => copyToClipboard(transcriptText(doc.segments))}
      onExport={async (kind) => {
        try {
          if (kind === 'txt') exportVoiceText(doc);
          else await exportVoicePdf(doc);
        } catch (e) {
          setNotice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }}
      onClear={async () => {
        const ok = await confirm({
          title: 'Clear the transcript?',
          message: 'All text in this document will be removed. You can undo this. Stored recordings are not deleted.',
          confirmLabel: 'Clear transcript',
          destructive: true,
        });
        if (ok) dispatch({ type: 'clearTranscript' });
      }}
      onPlay={(seg: TranscriptSegment) => {
        const rec = doc.recordings.find((r) => r.id === seg.recordingId);
        if (rec && seg.startMs !== null) void play(rec, seg.startMs, seg.endMs ?? undefined, seg.id);
      }}
      onPlayRecording={(r) => void play(r)}
      onDownloadRecording={async (r) => {
        const wav = await storage.loadAudio(r.id);
        if (wav) downloadBlob(wav, `${safeFileName(doc.title)} - ${new Date(r.startedAt).toISOString().slice(0, 16).replace(':', '-')}.wav`);
      }}
      sentenceCheck={sentenceCheck}
      onCheckSentences={sentenceCheck.checkNow}
      onApplySuggestion={(segmentId, text) => {
        dispatch({ type: 'editSegment', segmentId, text });
        dispatch({ type: 'setReviews', reviews: [{ segmentId, forText: text, suggestion: null }] });
      }}
      onDismissSuggestion={(segmentId) => dispatch({ type: 'dismissReview', segmentId })}
      onDeleteAudio={async (r) => {
        const ok = await confirm({
          title: 'Delete this recording?',
          message: 'The audio will be permanently deleted from this device. The transcript is kept.',
          confirmLabel: 'Delete audio',
          destructive: true,
        });
        if (!ok) return;
        stopPlayback();
        await storage.deleteAudio(r.id);
        dispatch({ type: 'audioDeleted', recordingId: r.id });
      }}
    />
  );

  return (
    <div className={`voice-editor flex h-full min-h-0 w-full bg-panel ${wide ? 'flex-row' : 'flex-col'} ${props.className ?? ''}`}>
      <aside
        className={`shrink-0 overflow-y-auto overscroll-contain ${wide ? 'w-[340px] border-r border-slate-200' : 'max-h-[48%] border-b border-slate-200'}`}
        aria-label="Recording controls"
      >
        {controls}
      </aside>
      <section className="min-h-0 min-w-0 flex-1">{panel}</section>
      <VoiceSettingsDialog
        open={settingsOpen}
        settings={settings}
        recording={live}
        onClose={() => setSettingsOpen(false)}
        onSave={(s) => {
          saveSpeechSettings(s);
          setSettings(s);
        }}
      />
    </div>
  );
}
