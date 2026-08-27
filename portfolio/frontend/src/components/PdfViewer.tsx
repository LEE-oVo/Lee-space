import { useEffect, useRef, useState } from 'react';
import { Spin, Alert } from 'antd';
import * as pdfjsLib from 'pdfjs-dist';
// Vite 资产方式引入 worker，避免跨域与路径问题
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * PDF 页面内嵌渲染组件（pdfjs-dist）：
 * 逐页绘制到 canvas，容器内滚动浏览，绝不触发下载
 */
export default function PdfViewer({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let doc: pdfjsLib.PDFDocumentProxy | null = null;

    const render = async () => {
      setLoading(true);
      setError('');
      try {
        doc = await pdfjsLib.getDocument({ url, cMapUrl: '', isEvalSupported: false }).promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const scale = Math.min(1.5, (container.clientWidth - 24) / page.getViewport({ scale: 1 }).width);
          const viewport = page.getViewport({ scale: Math.max(scale, 0.6) });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto 12px';
          canvas.style.boxShadow = '0 1px 6px rgba(0,0,0,.15)';
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('PDF 加载失败，请稍后重试');
          setLoading(false);
        }
      }
    };

    render();
    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [url]);

  if (error) return <Alert type="error" message={error} showIcon />;

  return (
    <div style={{ position: 'relative' }}>
      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin tip="正在渲染 PDF..." />
        </div>
      )}
      <div ref={containerRef} style={{ maxHeight: '70vh', overflowY: 'auto', padding: 8, background: '#f5f5f5' }} />
    </div>
  );
}
