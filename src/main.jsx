import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as pdfjsLib from 'pdfjs-dist';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Toaster, toast } from 'sonner';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

const MIN_SCALE = 0.65;
const MAX_SCALE = 5;
const TRANSLATION_IMAGE_MAX_SIDE = 1600;

function buildDocumentId(file) {
  return [file.name, file.size, file.lastModified].join(':');
}

function cacheKey(documentId, pageNumber) {
  return `vv-pdf-translation:${documentId}:${pageNumber}`;
}

function readCachedTranslation(documentId, pageNumber) {
  if (!documentId) return null;
  try {
    return localStorage.getItem(cacheKey(documentId, pageNumber));
  } catch {
    return null;
  }
}

function writeCachedTranslation(documentId, pageNumber, text) {
  try {
    localStorage.setItem(cacheKey(documentId, pageNumber), text);
  } catch {
    // Translation still works if browser storage is full or disabled.
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildTranslationImageDataUrl(sourceCanvas) {
  const longestSide = Math.max(sourceCanvas.width, sourceCanvas.height);
  const ratio = longestSide > TRANSLATION_IMAGE_MAX_SIDE ? TRANSLATION_IMAGE_MAX_SIDE / longestSide : 1;

  if (ratio >= 1) {
    return sourceCanvas.toDataURL('image/jpeg', 0.82);
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sourceCanvas.width * ratio);
  canvas.height = Math.round(sourceCanvas.height * ratio);
  const context = canvas.getContext('2d');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', 0.82);
}

function App() {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const translationScrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const renderTaskRef = useRef(null);
  const latestRequestRef = useRef(0);
  const translationRequestRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [totalPages, setTotalPages] = useState(0);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [fitMode, setFitMode] = useState('page');
  const [viewerStatus, setViewerStatus] = useState('컴퓨터에서 PDF를 열어주세요.');
  const [translation, setTranslation] = useState('');
  const [translationStatus, setTranslationStatus] = useState('idle');
  const [translationError, setTranslationError] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [consentError, setConsentError] = useState('');

  const canNavigate = Boolean(pdf && totalPages);
  const hasDocument = Boolean(pdf);
  const currentMeta = useMemo(() => {
    if (!fileName) return '';
    return `${fileName} · ${totalPages || '-'} pages`;
  }, [fileName, totalPages]);
  const scale = useMemo(() => clamp(fitScale + zoomOffset, MIN_SCALE, MAX_SCALE), [fitScale, zoomOffset]);

  const loadPdfBytes = useCallback(async (bytes, nextFileName, nextDocumentId) => {
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }

    setViewerStatus('PDF를 여는 중입니다.');
    setTranslation('');
    setTranslationError('');
    setTranslationStatus('idle');

    try {
      const loadedPdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
      setPdf(loadedPdf);
      setFileName(nextFileName);
      setDocumentId(nextDocumentId);
      setTotalPages(loadedPdf.numPages);
      setPageNumber(1);
      setPageInput('1');
      setViewerStatus('');
    } catch (error) {
      setPdf(null);
      setTotalPages(0);
      setViewerStatus(error?.message || 'PDF를 열 수 없습니다.');
    }
  }, []);

  useEffect(() => {
    if (!stageRef.current) return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const nextSize = { width: Math.round(width), height: Math.round(height) };
      setStageSize((currentSize) => (
        currentSize.width === nextSize.width && currentSize.height === nextSize.height
          ? currentSize
          : nextSize
      ));
    });

    observer.observe(stageRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canNavigate) return undefined;

    function handleKeyDown(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      const isRightToLeft = document.documentElement.dir === 'rtl';
      const previousKey = isRightToLeft ? 'ArrowRight' : 'ArrowLeft';
      const nextKey = isRightToLeft ? 'ArrowLeft' : 'ArrowRight';

      if (event.key === previousKey && pageNumber > 1) {
        event.preventDefault();
        setPageNumber((current) => {
          const next = current - 1;
          setPageInput(String(next));
          return next;
        });
      }

      if (event.key === nextKey && pageNumber < totalPages) {
        event.preventDefault();
        setPageNumber((current) => {
          const next = current + 1;
          setPageInput(String(next));
          return next;
        });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canNavigate, pageNumber, totalPages]);

  const translateCurrentCanvas = useCallback(
    async ({ force = false } = {}) => {
      if (!canvasRef.current || !documentId || !pageNumber) return;

      const requestKey = cacheKey(documentId, pageNumber);
      const cached = !force ? readCachedTranslation(documentId, pageNumber) : null;
      if (cached) {
        setTranslation(cached);
        setTranslationStatus('done');
        setTranslationError('');
        setIsCached(true);
        return;
      }

      if (!force && translationRequestRef.current?.key === requestKey) return;

      const requestId = latestRequestRef.current + 1;
      const requestToken = Symbol(requestKey);
      latestRequestRef.current = requestId;
      translationRequestRef.current = { key: requestKey, token: requestToken };
      setTranslationStatus('loading');
      setTranslationError('');
      setIsCached(false);
      setTranslation('');

      try {
        const imageDataUrl = buildTranslationImageDataUrl(canvasRef.current);
        const response = await fetch('/api/translate-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId, pageNumber, imageDataUrl }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '번역 요청에 실패했습니다.');
        }
        if (latestRequestRef.current !== requestId) return;
        const text = payload.koreanText || '번역할 본문이 없습니다.';
        writeCachedTranslation(documentId, pageNumber, text);
        setTranslation(text);
        setTranslationStatus('done');
      } catch (error) {
        if (latestRequestRef.current !== requestId) return;
        const message = error?.message || '번역 중 문제가 생겼습니다.';
        setTranslationError(message);
        setTranslationStatus('error');
        toast.error('번역을 완료하지 못했습니다.', {
          id: `translation-error:${requestKey}`,
          description: message,
        });
      } finally {
        if (translationRequestRef.current?.token === requestToken) {
          translationRequestRef.current = null;
        }
      }
    },
    [documentId, pageNumber],
  );

  useEffect(() => {
    if (!documentId || !pageNumber) return;

    // New page, new text: start the reader at the top instead of wherever the
    // previous page was left scrolled to.
    translationScrollRef.current?.scrollTo({ top: 0 });
    latestRequestRef.current += 1;
    translationRequestRef.current = null;
    setTranslationStatus('idle');
    setTranslationError('');
    setTranslation('');
    setIsCached(false);
  }, [documentId, pageNumber]);

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      if (!pdf || !canvasRef.current) return;

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      // Most pages paint in a few frames. Showing the status immediately makes
      // it strobe on every arrow press, so only surface it if the render waits.
      const statusTimer = setTimeout(() => {
        if (!cancelled) setViewerStatus('페이지를 그리는 중입니다.');
      }, 220);

      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        if (stageSize.width && stageSize.height) {
          const horizontalPadding = 48;
          const verticalPadding = 48;
          const widthScale = (stageSize.width - horizontalPadding) / baseViewport.width;
          const heightScale = (stageSize.height - verticalPadding) / baseViewport.height;
          const nextFitScale =
            fitMode === 'width'
              ? widthScale
              : fitMode === 'height'
                ? heightScale
                : Math.min(widthScale, heightScale);
          setFitScale(Number(clamp(nextFitScale, MIN_SCALE, MAX_SCALE).toFixed(2)));
        }

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        const pixelRatio = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, viewport.width, viewport.height);

        const task = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
        clearTimeout(statusTimer);
        if (cancelled) return;
        renderTaskRef.current = null;
        setViewerStatus('');
        await translateCurrentCanvas();
      } catch (error) {
        if (cancelled || error?.name === 'RenderingCancelledException') return;
        setViewerStatus(error?.message || '페이지를 그릴 수 없습니다.');
      } finally {
        clearTimeout(statusTimer);
      }
    }

    renderPage();

    return () => {
      cancelled = true;
    };
  }, [fitMode, pageNumber, pdf, scale, stageSize.height, stageSize.width, translateCurrentCanvas]);

  async function loadLocalFile(file) {
    if (!file) return;

    if (!aiConsent) {
      setConsentError('PDF를 열기 전에 번역 전송 동의를 확인해 주세요.');
      return;
    }

    const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!looksLikePdf) {
      setViewerStatus('PDF 파일만 열 수 있습니다.');
      return;
    }

    try {
      setViewerStatus('컴퓨터의 PDF를 불러오는 중입니다.');
      const bytes = await file.arrayBuffer();
      await loadPdfBytes(bytes, file.name, buildDocumentId(file));
    } catch (error) {
      setViewerStatus(error?.message || '컴퓨터의 PDF를 불러오지 못했습니다.');
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    try {
      await loadLocalFile(file);
    } finally {
      event.target.value = '';
    }
  }

  function openFilePicker() {
    if (!aiConsent) {
      setConsentError('PDF를 열기 전에 번역 전송 동의를 확인해 주세요.');
      return;
    }
    fileInputRef.current?.click();
  }

  function movePage(delta) {
    if (!canNavigate) return;
    const next = clamp(pageNumber + delta, 1, totalPages);
    setPageNumber(next);
    setPageInput(String(next));
  }

  function submitPage(event) {
    event.preventDefault();
    if (!canNavigate) return;
    const parsed = Number(pageInput);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(pageNumber));
      return;
    }
    const next = clamp(Math.round(parsed), 1, totalPages);
    setPageNumber(next);
    setPageInput(String(next));
  }

  function changeScale(delta) {
    setZoomOffset((current) => Number(clamp(current + delta, -0.7, 1.2).toFixed(2)));
  }

  function changeFitMode(event) {
    setFitMode(event.target.value);
    setZoomOffset(0);
  }

  async function copyTranslation() {
    if (!translation) return;

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('이 브라우저에서는 클립보드를 사용할 수 없습니다.');
      }
      await navigator.clipboard.writeText(translation);
      toast.success('번역문을 복사했습니다.');
    } catch {
      toast.error('번역문을 복사하지 못했습니다.');
    }
  }

  function handleStageDragOver(event) {
    event.preventDefault();
    setIsDraggingFile(true);
  }

  function handleStageDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsDraggingFile(false);
    }
  }

  async function handleStageDrop(event) {
    event.preventDefault();
    setIsDraggingFile(false);
    await loadLocalFile(event.dataTransfer.files?.[0]);
  }

  function renderTranslationBody() {
    if (translationStatus === 'loading') {
      return (
        <div className="translation-empty" role="status">
          <span className="loading-indicator" aria-hidden="true" />
          <strong>번역을 준비하고 있습니다</strong>
          <span>이 페이지의 문자를 읽고 한국어로 옮기는 중입니다.</span>
        </div>
      );
    }

    if (translationStatus === 'error') {
      return (
        <div className="translation-error" role="alert">
          <strong>번역을 완료하지 못했습니다.</strong>
          <span>{translationError}</span>
          <button className="inline-action" type="button" onClick={() => translateCurrentCanvas({ force: true })}>
            다시 시도
          </button>
        </div>
      );
    }

    if (translation) {
      return (
        <div className="translation-text translation-reveal">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{translation}</ReactMarkdown>
        </div>
      );
    }

    return <div className="translation-empty">번역 결과가 여기에 표시됩니다.</div>;
  }

  return (
    <>
      <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">VV PDF Translator</p>
          <h1>PDF를 한국어로 읽어보세요</h1>
        </div>
        <div className="file-control">
          <button className="primary-button" type="button" onClick={openFilePicker} disabled={!aiConsent}>
            PDF 열기
          </button>
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept="application/pdf"
            disabled={!aiConsent}
            onChange={handleFileChange}
          />
        </div>
      </header>

      <section className="reader">
        <section className="pdf-pane" aria-label="PDF 원문">
          <div className="toolbar glass-toolbar">
            <button
              type="button"
              aria-label="이전 페이지"
              aria-keyshortcuts="ArrowLeft"
              onClick={() => movePage(-1)}
              disabled={!canNavigate || pageNumber <= 1}
            >
              이전
            </button>
            <form className="page-form" onSubmit={submitPage}>
              <input
                aria-label="페이지 번호"
                type="number"
                min="1"
                max={totalPages || undefined}
                step="1"
                inputMode="numeric"
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                disabled={!canNavigate}
              />
              <span>/ {totalPages || '-'}</span>
            </form>
            <button type="button" aria-label="다음 페이지" aria-keyshortcuts="ArrowRight" onClick={() => movePage(1)} disabled={!canNavigate || pageNumber >= totalPages}>
              다음
            </button>
            <div className="toolbar-spacer" />
            <select aria-label="페이지 맞춤 방식" value={fitMode} onChange={changeFitMode} disabled={!canNavigate}>
              <option value="page">전체 맞춤</option>
              <option value="height">세로 맞춤</option>
              <option value="width">가로 맞춤</option>
            </select>
            <button type="button" onClick={() => changeScale(-0.15)} disabled={!canNavigate || scale <= MIN_SCALE}>
              축소
            </button>
            <span className="scale-label">{Math.round(scale * 100)}%</span>
            <button type="button" onClick={() => changeScale(0.15)} disabled={!canNavigate || scale >= MAX_SCALE}>
              확대
            </button>
          </div>

          {hasDocument ? <div className="pdf-meta" aria-live="polite">{currentMeta}</div> : null}
          <div
            ref={stageRef}
            className={[
              'canvas-stage',
              hasDocument ? 'has-document' : '',
              isDraggingFile ? 'is-dragging-file' : '',
            ].join(' ')}
            onDragOver={handleStageDragOver}
            onDragLeave={handleStageDragLeave}
            onDrop={handleStageDrop}
            aria-busy={Boolean(viewerStatus)}
          >
            {!hasDocument ? (
              <div className="empty-state">
                <div className="document-mark" aria-hidden="true">
                  <svg viewBox="0 0 40 48" fill="none">
                    <path d="M8 2.5h16l8 8V43a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 6 43V5a2.5 2.5 0 0 1 2-2.5Z" />
                    <path d="M24 2.5V11h8M12 21h14M12 28h14M12 35h9" />
                  </svg>
                </div>
                <h2>PDF를 선택하세요</h2>
                <p>파일을 이곳에 놓거나 선택하세요.</p>
                <label className="consent-control">
                  <input
                    type="checkbox"
                    checked={aiConsent}
                    onChange={(event) => {
                      setAiConsent(event.target.checked);
                      setConsentError('');
                    }}
                  />
                  <span>현재 페이지 이미지를 Gemini에 보내 번역하는 데 동의합니다.</span>
                </label>
                {consentError ? <p className="inline-error" role="alert">{consentError}</p> : null}
                <button className="primary-button" type="button" onClick={openFilePicker} disabled={!aiConsent}>PDF 선택</button>
              </div>
            ) : isDraggingFile ? (
              <div className="viewer-status">PDF를 놓으면 이 파일로 열립니다.</div>
            ) : viewerStatus ? (
              <div className="viewer-status" role="status">{viewerStatus}</div>
            ) : null}
            {hasDocument ? (
              <>
                <canvas ref={canvasRef} role="img" aria-label={`${fileName} ${pageNumber}페이지 원문`} />
                <div className="stage-navigation" aria-label="페이지 이동">
                  <button
                    className="stage-nav-button"
                    type="button"
                    aria-keyshortcuts="ArrowLeft"
                    onClick={() => movePage(-1)}
                    disabled={pageNumber <= 1}
                  >
                    이전 페이지
                  </button>
                  <button
                    className="stage-nav-button"
                    type="button"
                    aria-keyshortcuts="ArrowRight"
                    onClick={() => movePage(1)}
                    disabled={pageNumber >= totalPages}
                  >
                    다음 페이지
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </section>

        <aside className="translation-pane" aria-label="한국어 번역" aria-busy={translationStatus === 'loading'}>
          <div className="translation-header">
            <div>
              <p className="eyebrow">AI Korean Translation</p>
              <h2>{canNavigate ? `${pageNumber}페이지` : '대기 중'}</h2>
            </div>
            <div className="translation-actions">
              <button type="button" onClick={copyTranslation} disabled={!translation}>
                복사
              </button>
              <button
                type="button"
                onClick={() => translateCurrentCanvas({ force: true })}
                disabled={!canNavigate || translationStatus === 'loading'}
              >
                재번역
              </button>
            </div>
          </div>

          {canNavigate ? (
            <div className="status-row" role="status" aria-live="polite">
              <span className={`status-dot ${translationStatus}`} aria-hidden="true" />
              <span>
                {translationStatus === 'loading'
                  ? '번역 중'
                  : translationStatus === 'error'
                    ? '확인 필요'
                    : translation
                      ? isCached
                        ? '캐시됨'
                        : '번역 완료'
                      : '준비됨'}
              </span>
            </div>
          ) : null}

          <div className="translation-card" dir="auto" ref={translationScrollRef}>{renderTranslationBody()}</div>
          {canNavigate ? <p className="ai-note">AI 번역은 초안일 수 있습니다. 중요한 내용은 원문과 함께 확인하세요.</p> : null}
        </aside>
      </section>
      </main>
      <Toaster position="bottom-center" theme="system" richColors />
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
