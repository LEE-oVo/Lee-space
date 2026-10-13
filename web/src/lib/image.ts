// 浏览器端生成缩略图：服务器只有 1.6G 内存，不在服务端做图片转码
const MAX_EDGE = 480;
const JPEG_QUALITY = 0.82;

export interface ImageMeta {
  width: number;
  height: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

export async function readImageMeta(file: File): Promise<ImageMeta | null> {
  try {
    const img = await loadImage(file);
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  }
}

/** 把图片压到最长边 480px 的 JPEG，用于列表展示；非图片返回 null */
export async function makeThumb(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY);
    });
  } catch {
    return null;
  }
}
