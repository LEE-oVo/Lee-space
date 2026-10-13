import type { FileCategory, FileItem } from '../types';

export const CATEGORY_LABEL: Record<FileCategory, string> = {
  resume: '简历',
  certificate: '证书',
  award: '奖状',
  other: '其他',
};

export const CATEGORY_ORDER: FileCategory[] = ['resume', 'certificate', 'award', 'other'];

/** 有缩略图用缩略图，没有就退回原图（PDF 与非图片走占位图） */
export function fileThumbUrl(file: FileItem): string {
  if (file.hasThumb) return `/wb-api/files/${file.id}/thumb`;
  if (file.mime.startsWith('image/')) return `/wb-api/files/${file.id}/raw`;
  return '';
}

export function fileRawUrl(file: FileItem): string {
  return `/wb-api/files/${file.id}/raw`;
}

export function fileDownloadUrl(file: FileItem): string {
  return `/wb-api/files/${file.id}/raw?dl=1`;
}
