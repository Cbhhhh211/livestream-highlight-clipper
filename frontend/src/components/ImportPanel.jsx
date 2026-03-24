import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Upload,
  Link,
  Radio,
  ArrowRight,
  Film,
  CircleHelp,
  FolderOpen,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { api } from '../hooks/useApi';
import Toggle from './Toggle';

const TABS = [
  { id: 'upload', icon: Upload, label: 'Local Upload' },
  { id: 'url', icon: Link, label: 'Online Video' },
  { id: 'live', icon: Radio, label: 'Live Recording' },
];

const PARAM_HINT = 'In most cases, 30–60 seconds is a more practical default clip length for review and export.';

export default function ImportPanel() {
  const { dispatch } = useAppStore();

  const [activeTab, setActiveTab] = useState('upload');
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');

  const [topN, setTopN] = useState(() => localStorage.getItem('top_n') || '10');
  const [clipDuration, setClipDuration] = useState(() => localStorage.getItem('clip_duration') || '45');
  const [liveDuration, setLiveDuration] = useState(() => localStorage.getItem('live_duration') || '1800');
  const [outputDir, setOutputDir] = useState(() => localStorage.getItem('output_dir') || '');
  const [speedBoost, setSpeedBoost] = useState(() => localStorage.getItem('speed_boost') !== '0');
  const [selectingDir, setSelectingDir] = useState(false);

  const [urlFocused, setUrlFocused] = useState(false);
  const [urlStatus, setUrlStatus] = useState('idle');
  const [urlPreview, setUrlPreview] = useState(null);

  const fileInputRef = useRef(null);

  const handleFile = useCallback((nextFile) => {
    if (nextFile && nextFile.type.startsWith('video/')) {
      setFile(nextFile);
      setError('');
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  useEffect(() => {
    if (activeTab === 'upload') {
      setUrlStatus('idle');
      setUrlPreview(null);
      return undefined;
    }

    const trimmed = url.trim();
    if (!trimmed) {
      setUrlStatus('idle');
      setUrlPreview(null);
      return undefined;
    }

    const isValid = activeTab === 'live' ? isLikelyLiveInput(trimmed) : isLikelyVodInput(trimmed);
    if (!isValid) {
      setUrlStatus('invalid');
      setUrlPreview(null);
      return undefined;
    }

    const controller = new AbortController();
    setUrlStatus('loading');

    const timer = setTimeout(async () => {
      try {
        if (activeTab === 'url') {
          const preview = isBilibiliVodInput(trimmed)
            ? await fetchVodPreview(trimmed, controller.signal)
            : buildGenericPreview(trimmed, 'vod');
          setUrlPreview(preview);
          setUrlStatus('valid');
        } else {
          const preview = isBilibiliLiveInput(trimmed)
            ? await fetchLivePreview(trimmed, controller.signal)
            : buildGenericPreview(trimmed, 'live');
          setUrlPreview(preview);
          setUrlStatus('valid');
        }
      } catch {
        if (activeTab === 'url') {
          setUrlPreview(buildGenericPreview(trimmed, 'vod'));
          setUrlStatus('valid');
        } else {
          setUrlPreview(buildGenericPreview(trimmed, 'live'));
          setUrlStatus('valid');
        }
      }
    }, 360);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, url]);

  const handleStart = async () => {
    setError('');

    const parsedTopN = Number.parseInt(topN, 10);
    const parsedClipDuration = Number.parseFloat(clipDuration);
    const parsedLiveDuration = Number.parseInt(liveDuration, 10);

    if (!Number.isFinite(parsedTopN) || parsedTopN < 1 || parsedTopN > 50) {
      setError('Clip count must be between 1 and 50.');
      return;
    }

    if (!Number.isFinite(parsedClipDuration) || parsedClipDuration < 5 || parsedClipDuration > 3600) {
      setError('Clip duration must be between 5 and 3600 seconds.');
      return;
    }

    if (
      activeTab === 'live'
      && (!Number.isFinite(parsedLiveDuration) || parsedLiveDuration < 30 || parsedLiveDuration > 43200)
    ) {
      setError('Live recording duration must be between 30 and 43200 seconds.');
      return;
    }

    if (activeTab !== 'upload' && urlStatus === 'invalid') {
      setError('Invalid URL format. Please check and try again.');
      return;
    }

    const options = {
      topN: parsedTopN,
      clipDuration: parsedClipDuration,
      modelSize: 'tiny',
    };

    if (speedBoost) {
      options.candidateMultiplier = 1;
      options.feedbackRank = false;
      options.boundaryAdaptation = false;
      options.adaptivePadding = false;
      options.llmRerank = false;
    } else {
      options.candidateMultiplier = 2;
      options.feedbackRank = true;
      options.boundaryAdaptation = true;
      options.adaptivePadding = true;
      options.llmRerank = false;
    }

    if (activeTab === 'live') {
      options.duration = parsedLiveDuration;
    }
    if (outputDir.trim()) {
      options.outputDir = outputDir.trim();
    }

    if (activeTab === 'upload' && file) {
      setUploading(true);
      try {
        const job = await api.createLocalJob(file, options, setUploadProgress);
        dispatch({ type: 'START_JOB', payload: { jobId: job.job_id } });
      } catch (err) {
        setError(err?.message || 'Upload failed');
      } finally {
        setUploading(false);
      }
      return;
    }

    if (!url.trim()) return;

    setSubmitting(true);
    try {
      const sourceType = resolveSourceType(activeTab, url.trim());
      const job = await api.createJob(sourceType, url.trim(), options);
      if (!job?.job_id) throw new Error('No job_id returned');
      dispatch({ type: 'START_JOB', payload: { jobId: job.job_id } });
    } catch (err) {
      const detail = String(err?.detail || err?.message || '');
      if (
        detail.includes('source_type')
        && detail.includes('bili_vod')
        && detail.includes('bili_live')
        && !detail.includes('web_vod')
        && (detail.includes('400') || detail.startsWith('source_type'))
      ) {
        setError('Backend is still running the old API. Please restart the backend to enable web video/web live sources (web_vod / web_live).');
      } else {
        setError(err?.message || 'Failed to create job');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const canStart = (activeTab === 'upload' && file) || (activeTab !== 'upload' && url.trim() && urlStatus !== 'invalid');

  const handlePickOutputDir = async () => {
    setError('');
    setSelectingDir(true);
    try {
      const res = await api.pickOutputDirectory(outputDir.trim());
      const selected = typeof res?.selected === 'string' ? res.selected : '';
      if (selected) {
        setOutputDir(selected);
        localStorage.setItem('output_dir', selected);
      }
    } catch (err) {
      setError(err?.message || 'Unable to open folder picker');
    } finally {
      setSelectingDir(false);
    }
  };

  return (
    <div className="min-h-full w-full overflow-y-auto p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-5">
        <section className="surface-panel overflow-hidden px-5 py-5 md:px-8 md:py-7">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_320px] xl:items-center">
            <div>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                New Project
              </div>
              <h1 className="max-w-2xl text-4xl font-extrabold tracking-[-0.05em] text-text-primary md:text-5xl">
                Start from files, videos or livestreams.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary">
                Choose source, set params, generate highlights.
              </p>
            </div>
            <div className="rounded-[26px] border border-white/8 bg-[#12263c] p-5">
              <ImportIllustration />
            </div>
          </div>
        </section>

        <section className="surface-panel p-5 md:p-6">
            <div className="mb-5 flex flex-wrap gap-2 rounded-full bg-[#0d1d2f] p-1">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setError('');
                    }}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
                      active
                        ? 'bg-[#2b3949] text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    <Icon size={14} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
              <div className="flex flex-col gap-5 xl:min-h-[520px]">
                {activeTab === 'upload' ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative min-h-[520px] cursor-pointer rounded-[24px] border border-dashed p-8 transition-colors ${
                      dragOver
                        ? 'border-accent bg-accent/8'
                        : file
                          ? 'border-success/40 bg-[#eef8f3]'
                          : 'border-white/10 bg-[#0b1c2d] hover:border-accent/55 hover:bg-[#11253a]'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => handleFile(e.target.files[0])}
                    />
                    <div className="flex h-full flex-col items-center justify-center gap-4 py-10 text-center">
                      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[#1b2d43] shadow-sm">
                        {file ? <Film size={24} className="text-success" /> : <Upload size={24} className="text-accent" />}
                      </div>
                      <div>
                        <div className="text-lg font-semibold text-text-primary">
                          {file ? file.name : 'Drop video here'}
                        </div>
                        <div className="mt-2 text-sm text-text-secondary">
                          {file ? 'Ready — click to replace.' : 'Or click to select MP4 / MKV / AVI.'}
                        </div>
                      </div>

                      {uploading && (
                        <div className="w-full max-w-xs">
                          <div className="h-2 overflow-hidden rounded-full bg-[#20364f]">
                            <div
                              className="h-full rounded-full bg-accent transition-all duration-300"
                              style={{ width: `${uploadProgress * 100}%` }}
                            />
                          </div>
                          <div className="mt-2 text-xs font-mono text-text-muted">
                            Uploading {Math.round(uploadProgress * 100)}%
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="min-h-[520px] rounded-[24px] border border-white/8 bg-[#12263c] p-4">
                    <div className={`rounded-[18px] border px-4 py-5 transition-colors ${urlFocused ? 'border-accent bg-[#142b43]' : 'border-white/10 bg-[#102338]'}`}>
                      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                        {activeTab === 'live' ? 'Live Source' : 'Video Source'}
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          value={url}
                          onFocus={() => setUrlFocused(true)}
                          onBlur={() => setUrlFocused(false)}
                          onChange={(e) => {
                            setUrl(e.target.value);
                            setError('');
                          }}
                          placeholder={activeTab === 'live'
                            ? 'Paste livestream URL (Bilibili / Douyin / YouTube etc.)'
                            : 'Paste video URL (Bilibili / YouTube / Douyin / Xigua / Weibo / Xiaohongshu)'}
                          className="flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted"
                        />
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1a3047]">
                          {urlStatus === 'loading' && <Loader2 size={15} className="animate-spin text-text-muted" />}
                          {urlStatus === 'valid' && <CheckCircle2 size={15} className="text-success" />}
                          {urlStatus === 'invalid' && <AlertTriangle size={15} className="text-danger" />}
                        </div>
                      </div>
                    </div>

                    {urlPreview && (
                      <div className="mt-4 rounded-[18px] border border-white/8 bg-[#14293f] p-4">
                        <div className="text-sm font-semibold text-text-primary">{urlPreview.title}</div>
                        <div className="mt-1 text-sm text-text-secondary">{urlPreview.subtitle}</div>
                        {urlPreview.meta && <div className="mt-2 text-xs text-text-muted">{urlPreview.meta}</div>}
                      </div>
                    )}
                  </div>
                )}

                {error && (
                  <div className="rounded-[18px] border border-danger/25 bg-danger/6 px-4 py-3 text-sm text-danger">
                    {error}
                  </div>
                )}
              </div>

              <div className="space-y-5">
                <div className="rounded-[24px] border border-white/8 bg-[#12283e] p-5">
                  <div className="section-eyebrow mb-5">Parameters</div>
                  <div className={`grid gap-4 ${activeTab === 'live' ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                    <Field label="Clips" hint={PARAM_HINT}>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={topN}
                        onChange={(e) => {
                          setTopN(e.target.value);
                          localStorage.setItem('top_n', e.target.value);
                        }}
                        className="bento-input font-mono"
                      />
                    </Field>

                    <Field label="Clip Duration (sec)" hint={PARAM_HINT}>
                      <input
                        type="number"
                        min={5}
                        max={3600}
                        value={clipDuration}
                        onChange={(e) => {
                          setClipDuration(e.target.value);
                          localStorage.setItem('clip_duration', e.target.value);
                        }}
                        className="bento-input font-mono"
                      />
                    </Field>

                    {activeTab === 'live' && (
                      <Field label="Record Duration (sec)">
                        <input
                          type="number"
                          min={30}
                          max={43200}
                          value={liveDuration}
                          onChange={(e) => {
                            setLiveDuration(e.target.value);
                            localStorage.setItem('live_duration', e.target.value);
                          }}
                          className="bento-input font-mono"
                        />
                      </Field>
                    )}
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                    <Field label="Output Dir (optional)">
                      <input
                        type="text"
                        value={outputDir}
                        onChange={(e) => {
                          setOutputDir(e.target.value);
                          localStorage.setItem('output_dir', e.target.value);
                        }}
                        placeholder="D:\\clips\\project-a"
                        className="bento-input font-mono"
                      />
                    </Field>
                    <button
                      type="button"
                      onClick={handlePickOutputDir}
                      disabled={selectingDir}
                      className={`btn-secondary mt-[26px] rounded-2xl px-4 py-3 text-sm ${selectingDir ? 'opacity-60' : ''}`}
                    >
                      {selectingDir ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                      Browse
                    </button>
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-[#152b42] px-5 py-5">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-warm/10 text-warm">
                      <Zap size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-text-primary">Speed Mode</div>
                      <div className="mt-1 text-sm text-text-secondary leading-6">
                        Lighter ranking, fewer refinement steps.
                      </div>
                    </div>
                    <Toggle
                      checked={speedBoost}
                      onChange={(checked) => {
                        setSpeedBoost(checked);
                        localStorage.setItem('speed_boost', checked ? '1' : '0');
                      }}
                    />
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-[#102338] p-5 xl:mt-auto">
                  <div className="text-sm text-text-muted leading-6">
                    {activeTab === 'live'
                      ? 'Live mode: records first, then runs highlight pipeline.'
                      : 'Clips enter review when done.'}
                  </div>
                  <button
                    onClick={handleStart}
                    disabled={!canStart || uploading || submitting}
                    className="btn-warm mt-5 w-full rounded-full px-6 py-3 text-sm"
                  >
                    {uploading || submitting ? 'Processing...' : 'Generate Highlights'}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        {label}
        {hint ? <HintIcon text={hint} /> : null}
      </label>
      {children}
    </div>
  );
}

function HintIcon({ text }) {
  return (
    <span className="group relative inline-flex items-center">
      <CircleHelp size={12} className="text-text-muted" />
      <span className="pointer-events-none absolute bottom-[130%] left-1/2 z-20 w-48 -translate-x-1/2 rounded-xl border border-white/8 bg-[#1a314a] px-2.5 py-2 text-[10px] leading-4 text-text-secondary opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

function ImportIllustration() {
  return (
    <svg viewBox="0 0 320 200" className="h-auto w-full text-[#7faed2]" fill="none" aria-hidden>
      <rect x="18" y="22" width="284" height="156" rx="28" fill="#10253a" stroke="#28425e" />
      <rect x="42" y="46" width="236" height="108" rx="20" fill="#163049" stroke="#28425e" />
      <rect x="68" y="76" width="88" height="48" rx="18" fill="#7faed2" opacity="0.18" />
      <rect x="170" y="76" width="66" height="12" rx="6" fill="#c7d9ea" />
      <rect x="170" y="96" width="84" height="10" rx="5" fill="#d7e5f2" />
      <rect x="170" y="115" width="54" height="10" rx="5" fill="#edd8bc" />
      <path d="M110 62v44" stroke="#7faed2" strokeWidth="8" strokeLinecap="round" />
      <path d="M92 80l18-18 18 18" stroke="#7faed2" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="272" cy="46" r="18" fill="#f5eadb" />
      <circle cx="50" cy="158" r="10" fill="#e6f0f8" />
    </svg>
  );
}

function extractBvid(raw) {
  const match = String(raw).match(/BV[0-9A-Za-z]{10}/i);
  return match ? match[0].toUpperCase() : null;
}

function extractRoomId(raw) {
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) return text;
  const match = text.match(/live\.bilibili\.com\/(\d+)/i);
  return match ? match[1] : null;
}

function toHttpUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (/[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) return `https://${text.replace(/^\/+/, '')}`;
  return text;
}

function getHostname(raw) {
  try {
    const normalized = toHttpUrl(raw);
    const u = new URL(normalized);
    return u.hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isBilibiliVodInput(raw) {
  const text = String(raw).trim();
  if (!text) return false;
  return Boolean(extractBvid(text) || /bilibili\.com\/video\//i.test(text));
}

function isBilibiliLiveInput(raw) {
  const text = String(raw).trim();
  if (!text) return false;
  return Boolean(extractRoomId(text) || /live\.bilibili\.com/i.test(text));
}

function isLikelyVodInput(raw) {
  const text = String(raw).trim();
  if (!text) return false;
  if (isBilibiliVodInput(text)) return true;
  const host = getHostname(text);
  return Boolean(host);
}

function isLikelyLiveInput(raw) {
  const text = String(raw).trim();
  if (!text) return false;
  if (isBilibiliLiveInput(text)) return true;
  const host = getHostname(text);
  return Boolean(host && /live|douyin|youtube|youtu\.be|weibo|xigua|xiaohongshu|xhs|bilibili/.test(host));
}

function resolveSourceType(activeTab, raw) {
  if (activeTab === 'live') {
    return isBilibiliLiveInput(raw) ? 'bili_live' : 'web_live';
  }
  return isBilibiliVodInput(raw) ? 'bili_vod' : 'web_vod';
}

function buildGenericPreview(raw, mode) {
  const host = getHostname(raw);
  const site = host ? host.replace(/^www\./, '') : 'online source';
  return {
    title: mode === 'live' ? `Live Source (${site})` : `Video Source (${site})`,
    subtitle: raw,
    cover: null,
    meta: mode === 'live'
      ? 'Will record the livestream via yt-dlp for the configured duration.'
      : 'Will download the video via yt-dlp, then enter the clipping pipeline.',
  };
}

async function fetchVodPreview(raw, signal) {
  const bvid = extractBvid(raw);
  if (!bvid) {
    return {
      title: 'Bilibili Video',
      subtitle: raw,
      cover: null,
      meta: '',
    };
  }

  const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { signal });
  if (!res.ok) throw new Error('Failed to fetch preview');
  const json = await res.json();
  const d = json?.data;
  if (!d) throw new Error('Invalid preview data');

  return {
    title: d.title || `Bilibili Video ${bvid}`,
    subtitle: d.owner?.name ? `Uploader: ${d.owner.name}` : bvid,
    cover: d.pic || null,
    meta: d.duration ? `Duration ${formatDuration(d.duration)} - ${bvid}` : bvid,
  };
}

async function fetchLivePreview(raw, signal) {
  const roomId = extractRoomId(raw);
  if (!roomId) {
    return {
      title: 'Bilibili Live',
      subtitle: raw,
      cover: null,
      meta: '',
    };
  }

  const res = await fetch(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(roomId)}`, { signal });
  if (!res.ok) throw new Error('Failed to fetch preview');
  const json = await res.json();
  const d = json?.data;
  if (!d) throw new Error('Invalid preview data');

  return {
    title: d.title || `Live Room ${roomId}`,
    subtitle: d.uname ? `Streamer: ${d.uname}` : `Room ${roomId}`,
    cover: d.user_cover || d.keyframe || null,
    meta: d.live_status === 1 ? 'Currently live' : 'Currently offline',
  };
}

function formatDuration(seconds) {
  const s = Number(seconds) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
