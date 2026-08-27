import axios from 'axios';
import { message } from 'antd';

export const TOKEN_KEY = 'portfolio_admin_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** Axios 实例：统一 baseURL、请求带 token、响应统一解包 */
const http = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

// 请求拦截：后台接口自动带上 JWT
http.interceptors.request.use((config) => {
  const token = getToken();
  if (token && config.url?.startsWith('/admin')) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截：统一解包 Result；401 登录过期跳转登录页
http.interceptors.response.use(
  (resp) => {
    const body = resp.data;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data;
      message.error(body.message || '请求失败');
      return Promise.reject(new Error(body.message));
    }
    return body;
  },
  (error) => {
    const status = error.response?.status;
    if (status === 401) {
      clearToken();
      message.warning('登录已过期，请重新登录');
      if (!window.location.pathname.startsWith('/admin/login')) {
        window.location.href = '/admin/login';
      }
    } else {
      message.error(error.response?.data?.message || error.message || '网络错误');
    }
    return Promise.reject(error);
  },
);

// ---------- 类型定义 ----------

/** 后端 MyBatis-Plus Page 结构 */
export interface PageData<T> {
  records: T[];
  total: number;
  current: number;
  size: number;
}

export interface PortfolioFile {
  id: number;
  title: string;
  intro: string;
  fileType: 'pdf' | 'html';
  filePath: string;
  originalName: string;
  fileSize: number;
  createTime: string;
  url: string;
}

export interface VideoItem {
  id: number;
  title: string;
  intro: string;
  videoPath: string;
  thumbPath: string | null;
  videoSize: number;
  createTime: string;
  videoUrl: string;
  thumbUrl: string | null;
}

// ---------- 前台公开接口 ----------

export const fetchFiles = (page: number, size: number) =>
  http.get<unknown, PageData<PortfolioFile>>('/public/files', { params: { page, size } });

export const fetchFileDetail = (id: number) =>
  http.get<unknown, PortfolioFile>(`/public/files/${id}`);

export const fetchVideos = (page: number, size: number) =>
  http.get<unknown, PageData<VideoItem>>('/public/videos', { params: { page, size } });

// ---------- 后台接口（需 token） ----------

export const adminLogin = (username: string, password: string) =>
  http.post<unknown, { token: string; username: string }>('/admin/auth/login', { username, password });

export const changePassword = (oldPassword: string, newPassword: string) =>
  http.post<unknown, void>('/admin/auth/password', { oldPassword, newPassword });

export const adminListFiles = (page: number, size: number) =>
  http.get<unknown, PageData<PortfolioFile>>('/admin/files', { params: { page, size } });

export const adminUpdateFile = (id: number, title: string, intro: string) =>
  http.put<unknown, void>(`/admin/files/${id}`, { title, intro });

export const adminDeleteFile = (id: number) =>
  http.delete<unknown, void>(`/admin/files/${id}`);

export const adminListVideos = (page: number, size: number) =>
  http.get<unknown, PageData<VideoItem>>('/admin/videos', { params: { page, size } });

export const adminUpdateVideo = (id: number, title: string, intro: string) =>
  http.put<unknown, void>(`/admin/videos/${id}`, { title, intro });

export const adminDeleteVideo = (id: number) =>
  http.delete<unknown, void>(`/admin/videos/${id}`);

/** 文件上传（multipart，Axios 自动带 token） */
export const uploadFile = (file: File, title: string, intro: string) => {
  const form = new FormData();
  form.append('file', file);
  form.append('title', title);
  form.append('intro', intro);
  return http.post<unknown, PortfolioFile>('/admin/files/upload', form);
};

/** 视频上传（视频必填，缩略图可选） */
export const uploadVideo = (video: File, thumb: File | null, title: string, intro: string) => {
  const form = new FormData();
  form.append('video', video);
  if (thumb) form.append('thumb', thumb);
  form.append('title', title);
  form.append('intro', intro);
  return http.post<unknown, VideoItem>('/admin/videos/upload', form);
};

export default http;
