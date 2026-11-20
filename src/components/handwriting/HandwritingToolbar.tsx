import type { ToolState } from '../../types/handwriting';
import { IconButton, ToolbarDivider } from '../common/IconButton';
import {
  EraserIcon,
  ExpandIcon,
  FilePlusIcon,
  HandIcon,
  PanelRightIcon,
  PenIcon,
  RedoIcon,
  ScissorsIcon,
  ShrinkIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../common/icons';
import { PenSettings } from './PenSettings';
import { EraserTool } from './EraserTool';
import { PageNavigator } from '../documents/PageNavigator';

interface Props {
  tool: ToolState;
  onToolChange(patch: Partial<ToolState>): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onClearPage(): void;
  onAddPage(): void;
  zoom: number;
  onZoomIn(): void;
  onZoomOut(): void;
  onFitWidth(): void;
  focusMode: boolean;
  onToggleFocus(): void;
  textPanelVisible: boolean;
  onToggleTextPanel?: () => void;
  currentPage: number;
  pageCount: number;
  onGoToPage(index: number): void;
  onDeletePage(): void;
}

export function HandwritingToolbar(p: Props) {
  const { tool } = p;
  return (
    <div
      className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-slate-200 bg-white/95 px-2 py-1 backdrop-blur"
      role="toolbar"
      aria-label="Handwriting tools"
    >
      <IconButton label="Pen (P)" active={tool.tool === 'pen'} onClick={() => p.onToolChange({ tool: 'pen' })}>
        <PenIcon />
      </IconButton>
      <IconButton label="Eraser (E)" active={tool.tool === 'eraser'} onClick={() => p.onToolChange({ tool: 'eraser' })}>
        <EraserIcon />
      </IconButton>
      <ToolbarDivider />
      {tool.tool === 'pen' ? <PenSettings tool={tool} onChange={p.onToolChange} /> : <EraserTool tool={tool} onChange={p.onToolChange} />}
      <ToolbarDivider />
      <IconButton label="Undo (Ctrl/⌘+Z)" disabled={!p.canUndo} onClick={p.onUndo}>
        <UndoIcon />
      </IconButton>
      <IconButton label="Redo (Ctrl/⌘+Shift+Z)" disabled={!p.canRedo} onClick={p.onRedo}>
        <RedoIcon />
      </IconButton>
      <IconButton label="Clear page" tone="danger" onClick={p.onClearPage}>
        <ScissorsIcon />
      </IconButton>
      <IconButton label="Add page" onClick={p.onAddPage}>
        <FilePlusIcon />
      </IconButton>
      <ToolbarDivider />
      <IconButton
        label={tool.fingerDrawing ? 'Finger drawing on (fingers draw, two fingers scroll)' : 'Finger drawing off (fingers scroll)'}
        active={tool.fingerDrawing}
        onClick={() => p.onToolChange({ fingerDrawing: !tool.fingerDrawing })}
      >
        <HandIcon />
      </IconButton>

      <div className="min-w-2 flex-1" />

      <IconButton label="Zoom out" onClick={p.onZoomOut}>
        <ZoomOutIcon />
      </IconButton>
      <button
        type="button"
        onClick={p.onFitWidth}
        title="Fit page width"
        className="h-9 min-w-[52px] shrink-0 rounded-lg px-1 text-[12.5px] font-medium tabular-nums text-slate-600 hover:bg-slate-100"
      >
        {Math.round(p.zoom * 100)}%
      </button>
      <IconButton label="Zoom in" onClick={p.onZoomIn}>
        <ZoomInIcon />
      </IconButton>
      <ToolbarDivider />
      <PageNavigator current={p.currentPage} total={p.pageCount} onGoTo={p.onGoToPage} onDeletePage={p.onDeletePage} />
      <ToolbarDivider />
      {p.onToggleTextPanel && (
        <IconButton
          label={p.textPanelVisible ? 'Hide text panel' : 'Show text panel'}
          active={p.textPanelVisible}
          onClick={p.onToggleTextPanel}
          className="hidden md:inline-flex"
        >
          <PanelRightIcon />
        </IconButton>
      )}
      <IconButton label={p.focusMode ? 'Exit full-screen writing' : 'Full-screen writing'} onClick={p.onToggleFocus}>
        {p.focusMode ? <ShrinkIcon /> : <ExpandIcon />}
      </IconButton>
    </div>
  );
}
