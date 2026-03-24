import { useState } from 'react';
import {
  ArrowLeft,
  Download,
  Smartphone,
  Monitor,
  Square,
  CheckCircle2,
  Loader,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { api } from '../hooks/useApi';
import Toggle from './Toggle';

const PLATFORMS = [
  { id: 'bilibili', name: 'Bilibili', aspect: '16:9', maxDuration: 600, desc: 'Landscape video' },
  { id: 'tiktok', name: 'Douyin/TikTok', aspect: '9:16', maxDuration: 60, desc: 'Vertical short' },
  { id: 'youtube_shorts', name: 'YouTube Shorts', aspect: '9:16', maxDuration: 60, desc: 'Vertical, max 60s' },
  { id: 'custom', name: 'Custom', aspect: '16:9', maxDuration: null, desc: 'Original aspect ratio' },
];

const ASPECT_OPTIONS = [
  { id: '16:9', label: '16:9', icon: Monitor },
  { id: '9:16', label: '9:16', icon: Smartphone },
  { id: '1:1', label: '1:1', icon: Square },
];

export default function ExportPanel() {
  const { state, dispatch } = useAppStore();
  const [selectedPlatform, setSelectedPlatform] = useState(state.exportPlatform || 'bilibili');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [aspect, setAspect] = useState('16:9');
  const [exportError, setExportError] = useState('');
  const [cleanupInfo, setCleanupInfo] = useState('');
  const [autoCleanupSource, setAutoCleanupSource] = useState(() => localStorage.getItem('auto_cleanup_source') !== '0');
  const [keepOnlySelected, setKeepOnlySelected] = useState(() => localStorage.getItem('keep_only_selected_clips') !== '0');

  const selectedClips = state.highlights.filter((h) => h.selected);
  const platform = PLATFORMS.find((p) => p.id === selectedPlatform);
  const totalDuration = Math.round(selectedClips.reduce((sum, c) => sum + (c.clipEnd - c.clipStart), 0));

  const downloadSingleClip = async (clip, idx) => {
    if (!clip.downloadUrl) return;
    const resp = await fetch(clip.downloadUrl, { credentials: 'include' });
    if (!resp.ok) {
      throw new Error(`Download failed (HTTP ${resp.status})`);
    }
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = clip.fileName || `clip_${String(idx + 1).padStart(2, '0')}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const triggerDownloads = async () => {
    const failed = [];
    for (let i = 0; i < selectedClips.length; i += 1) {
      const clip = selectedClips[i];
      try {
        // Sequential download keeps browser/WebView behavior stable.
        // eslint-disable-next-line no-await-in-loop
        await downloadSingleClip(clip, i);
      } catch (err) {
        failed.push({ clip, err });
      }
    }
    return failed;
  };

  const handleExport = async () => {
    setExportError('');
    setCleanupInfo('');
    const downloadable = selectedClips.filter((c) => !!c.downloadUrl);
    if (downloadable.length === 0) {
      setExportError('No downloadable clips for this task.');
      return;
    }
    setExporting(true);
    const failed = await triggerDownloads();
    if (failed.length > 0) {
      setExportError(`${failed.length} clip(s) failed to download. Please retry.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cleanupMessages = [];

    if (autoCleanupSource && state.jobId) {
      try {
        const res = await api.cleanupJobSource(state.jobId);
        const freed = Number.isFinite(res?.freed_mb) ? res.freed_mb : 0;
        cleanupMessages.push(`Source files cleaned up (freed ${freed} MB).`);
      } catch (err) {
        cleanupMessages.push(`Source cleanup skipped: ${err?.message || 'Cleanup request failed'}`);
      }
    }

    if (keepOnlySelected && state.jobId && selectedClips.length > 0) {
      try {
        const res = await api.cleanupUnselectedClips(
          state.jobId,
          selectedClips.map((c) => c.id),
        );
        const removedCount = Number.isFinite(res?.removed_count) ? res.removed_count : 0;
        const freed = Number.isFinite(res?.freed_mb) ? res.freed_mb : 0;
        cleanupMessages.push(`Unselected clips removed (${removedCount} deleted, freed ${freed} MB).`);
        dispatch({ type: 'KEEP_ONLY_SELECTED_CLIPS' });
      } catch (err) {
        cleanupMessages.push(`Unselected clip cleanup skipped: ${err?.message || 'Cleanup request failed'}`);
      }
    }

    if (cleanupMessages.length > 0) {
      setCleanupInfo(cleanupMessages.join(' '));
    }
    setExporting(false);
    setExported(true);
  };

  return (
    <div className="min-h-full w-full overflow-y-auto p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-5">
        <section className="surface-panel overflow-hidden px-5 py-5 md:px-8 md:py-7">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_320px] xl:items-center">
            <div>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Export
              </div>
              <h1 className="max-w-2xl text-4xl font-extrabold tracking-[-0.05em] text-text-primary md:text-5xl">
                Package and export your selected clips.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary">
                Confirm format, download clips, clean up.
              </p>
            </div>
            <div className="rounded-[26px] border border-white/8 bg-[#12263c] p-5">
              <ExportIllustration />
            </div>
          </div>
        </section>

        <div className="grid gap-5">
          <section className="surface-panel p-5 md:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <StatChip label="Selected Clips" value={`${selectedClips.length}`} />
                <StatChip label="Total Duration" value={`${totalDuration}sec`} />
                <StatChip label="Format" value={`${aspect} MP4`} />
              </div>
              <button
                onClick={() => dispatch({ type: 'SET_PHASE', payload: 'review' })}
                className="btn-secondary rounded-full px-4 py-2.5 text-xs uppercase tracking-[0.12em]"
              >
                <ArrowLeft size={14} />
                Back to Review
              </button>
            </div>

            <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
              <div className="space-y-5">
                <div className="rounded-[24px] border border-white/8 bg-[#12283e] p-5">
                  <div className="section-eyebrow mb-5">Platform</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {PLATFORMS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedPlatform(p.id);
                          setAspect(p.aspect);
                        }}
                        className={`rounded-[20px] border px-4 py-4 text-left transition-colors ${
                          selectedPlatform === p.id
                            ? 'border-accent/45 bg-[#1b3047]'
                            : 'border-white/8 bg-[#152b42] hover:bg-[#1a324d]'
                        }`}
                      >
                        <div className="text-sm font-semibold text-text-primary">{p.name}</div>
                        <div className="mt-1 text-sm text-text-secondary">{p.desc}</div>
                        <div className="mt-3 text-xs font-mono text-text-muted">
                          {p.maxDuration ? `Max ${p.maxDuration}sec` : 'No limit'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-[#12283e] p-5">
                  <div className="section-eyebrow mb-5">Aspect Ratio</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {ASPECT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setAspect(opt.id)}
                        className={`inline-flex items-center justify-center gap-2 rounded-[18px] border px-4 py-3 text-sm font-semibold transition-colors ${
                          aspect === opt.id
                            ? 'border-accent/45 bg-[#1b3047] text-text-primary'
                            : 'border-white/8 bg-[#152b42] text-text-secondary hover:bg-[#1a324d]'
                        }`}
                      >
                        <opt.icon size={16} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <aside className="flex flex-col gap-5">
                <div className="rounded-[24px] border border-white/8 bg-[#12263c] p-5">
                  <div className="mb-3 text-sm font-semibold text-text-primary">Selected Clips</div>
                  {selectedClips.length === 0 ? (
                    <div className="text-sm leading-6 text-text-muted">No clips selected. Go back to Review to keep clips for export.</div>
                  ) : (
                    <div className="space-y-2">
                      {selectedClips.map((clip, idx) => {
                        const scorePercent = Math.round((clip.score || 0) * 100);
                        return (
                          <div key={clip.id} className="rounded-[18px] border border-white/8 bg-[#152b42] px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-text-primary">
                                Clip {String(idx + 1).padStart(2, '0')}
                              </div>
                              <div className="text-xs font-mono text-text-muted">{scorePercent}</div>
                            </div>
                            <div className="mt-1 text-xs font-mono text-text-secondary">
                              {formatTime(clip.clipStart)} - {formatTime(clip.clipEnd)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-[24px] border border-white/8 bg-[#152b42] p-5">
                  <div className="text-sm font-semibold text-text-primary">Checklist</div>
                  <div className="mt-3 space-y-2">
                    <ChecklistItem done={selectedClips.length > 0} text="At least one clip selected" />
                    <ChecklistItem done={Boolean(platform)} text="Platform selected" />
                    <ChecklistItem done={Boolean(aspect)} text="Aspect ratio set" />
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-[#152b42] p-5">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-warm/10 text-warm">
                          <Trash2 size={16} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-text-primary">Auto-clean source files</div>
                          <div className="mt-1 max-w-xl text-sm leading-6 text-text-secondary">
                            Delete cached source files after export. Generated clips are kept.
                          </div>
                        </div>
                      </div>
                      <Toggle
                        checked={autoCleanupSource}
                        onChange={(checked) => {
                          setAutoCleanupSource(checked);
                          localStorage.setItem('auto_cleanup_source', checked ? '1' : '0');
                        }}
                      />
                    </div>

                    <div className="h-px w-full bg-white/8" />

                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-warm/10 text-warm">
                          <Trash2 size={16} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-text-primary">Keep only exported clips</div>
                          <div className="mt-1 max-w-xl text-sm leading-6 text-text-secondary">
                            Automatically remove unselected clip files after export.
                          </div>
                        </div>
                      </div>
                      <Toggle
                        checked={keepOnlySelected}
                        onChange={(checked) => {
                          setKeepOnlySelected(checked);
                          localStorage.setItem('keep_only_selected_clips', checked ? '1' : '0');
                        }}
                      />
                    </div>
                  </div>
                </div>

                {exportError && (
                  <div className="rounded-[18px] border border-danger/25 bg-danger/6 px-4 py-3 text-sm text-danger">
                    {exportError}
                  </div>
                )}

                {exported && (
                  <div className="rounded-[24px] border border-success/25 bg-[#f5fbf8] px-5 py-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-success/10 text-success">
                        <CheckCircle2 size={20} />
                      </div>
                      <div>
                        <div className="text-base font-semibold text-text-primary">Export Complete</div>
                        <div className="text-sm text-text-secondary">Your selected clips are ready for download.</div>
                      </div>
                    </div>
                    {cleanupInfo && <div className="mt-3 text-sm text-text-muted">{cleanupInfo}</div>}
                  </div>
                )}

                <button
                  onClick={handleExport}
                  disabled={exporting || selectedClips.length === 0}
                  className="btn-warm w-full rounded-full px-6 py-3.5 text-sm xl:mt-auto"
                >
                  {exporting ? (
                    <>
                      <Loader size={16} className="animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      Export {selectedClips.length} Clip(s)
                    </>
                  )}
                </button>
              </aside>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, value }) {
  return (
    <div className="rounded-full border border-white/8 bg-[#1a2c41] px-3 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-text-muted">{label}</span>
      <span className="ml-2 text-xs font-mono text-text-primary">{value}</span>
    </div>
  );
}

function ChecklistItem({ done, text }) {
  return (
    <div className="flex items-center gap-2 rounded-[16px] border border-white/8 bg-[#1a2c41] px-3 py-2 text-sm text-text-secondary">
      <span className={`h-2.5 w-2.5 rounded-full ${done ? 'bg-success' : 'bg-[#c9d7e6]'}`} />
      {text}
    </div>
  );
}

function ExportIllustration() {
  return (
    <svg viewBox="0 0 320 200" className="h-auto w-full" fill="none" aria-hidden>
      <rect x="26" y="28" width="268" height="144" rx="26" fill="#10253a" stroke="#28425e" />
      <rect x="54" y="52" width="212" height="96" rx="20" fill="#163049" stroke="#28425e" />
      <rect x="82" y="80" width="156" height="40" rx="20" fill="#7faed2" opacity="0.18" />
      <path d="M160 70v44" stroke="#7faed2" strokeWidth="8" strokeLinecap="round" />
      <path d="M142 96l18 18 18-18" stroke="#7faed2" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="260" cy="54" r="16" fill="#f5eadb" />
      <circle cx="68" cy="154" r="10" fill="#e6f0f8" />
    </svg>
  );
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
