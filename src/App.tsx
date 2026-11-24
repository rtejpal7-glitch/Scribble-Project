import { useCallback, useEffect, useState } from 'react';
import { ConfirmProvider } from './components/common/ConfirmDialog';
import { WorkspaceTabs, type WorkspaceId } from './components/navigation/WorkspaceTabs';
import { HandwritingWorkspace } from './components/handwriting/HandwritingWorkspace';
import { VoiceWorkspace } from './components/voice/VoiceWorkspace';
import { requestPersistentStorage } from './storage/IndexedDBStorage';

const TAB_KEY = 'inkflow:workspace';

function initialTab(): WorkspaceId {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t === 'voice' || t === 'handwriting') return t;
  } catch {
    /* ignore */
  }
  return 'voice';
}

/**
 * Input workspace with two independent tools. Both stay mounted, so switching
 * tabs never loses unsaved content; the hidden one is simply not displayed.
 * Only one input runs at a time: leaving the Voice tab pauses a recording.
 */
export default function App() {
  const [tab, setTab] = useState<WorkspaceId>(initialTab);
  const [focus, setFocus] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    void requestPersistentStorage();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  const onRecordingChange = useCallback((r: boolean) => setRecording(r), []);

  return (
    <ConfirmProvider>
      <div className="app-shell flex h-full flex-col bg-white">
        {!focus && (
          <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-[#fbfbfc] px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
            <span className="hidden text-[13px] font-semibold tracking-tight text-slate-400 md:inline">InkFlow</span>
            <div className="flex flex-1 justify-center">
              <WorkspaceTabs
                active={tab}
                onChange={setTab}
                badges={{
                  voice: recording ? <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-label="recording" /> : undefined,
                }}
              />
            </div>
            <span className="hidden w-[52px] md:inline" aria-hidden="true" />
          </header>
        )}
        <main className="relative min-h-0 flex-1">
          <section id="panel-voice" role="tabpanel" aria-labelledby="tab-voice" hidden={tab !== 'voice'} className="h-full">
            <VoiceWorkspace active={tab === 'voice'} onRecordingChange={onRecordingChange} />
          </section>
          <section id="panel-handwriting" role="tabpanel" aria-labelledby="tab-handwriting" hidden={tab !== 'handwriting'} className="h-full">
            <HandwritingWorkspace onFocusModeChange={setFocus} />
          </section>
        </main>
      </div>
    </ConfirmProvider>
  );
}
