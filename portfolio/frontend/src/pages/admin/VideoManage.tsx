import { useEffect, useState } from 'react';
import {
  Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Upload, message,
} from 'antd';
import { InboxOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';
import dayjs from 'dayjs';
import {
  adminListVideos, adminUpdateVideo, adminDeleteVideo, uploadVideo, type VideoItem,
} from '../../api/client';

const PAGE_SIZE = 10;

/** 视频管理：上传（MP4 + 可选缩略图）+ 编辑 + 删除 + 播放预览 */
export default function VideoManage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<VideoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // 上传弹窗
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm] = Form.useForm();
  const [videoList, setVideoList] = useState<UploadFile[]>([]);
  const [thumbList, setThumbList] = useState<UploadFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 编辑弹窗
  const [editing, setEditing] = useState<VideoItem | null>(null);
  const [editForm] = Form.useForm();

  // 播放弹窗
  const [playing, setPlaying] = useState<VideoItem | null>(null);

  const load = async (p: number) => {
    setLoading(true);
    try {
      const res = await adminListVideos(p, PAGE_SIZE);
      setData(res.records);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleUpload = async () => {
    const values = await uploadForm.validateFields();
    const video = videoList[0]?.originFileObj as File | undefined;
    if (!video) {
      message.warning('请选择要上传的视频');
      return;
    }
    const thumb = (thumbList[0]?.originFileObj as File | undefined) || null;
    setSubmitting(true);
    try {
      await uploadVideo(video, thumb, values.title, values.intro || '');
      message.success('上传成功');
      setUploadOpen(false);
      uploadForm.resetFields();
      setVideoList([]);
      setThumbList([]);
      load(page);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!editing) return;
    const values = await editForm.validateFields();
    await adminUpdateVideo(editing.id, values.title, values.intro || '');
    message.success('保存成功');
    setEditing(null);
    load(page);
  };

  const videoProps: UploadProps = {
    accept: '.mp4',
    maxCount: 1,
    fileList: videoList,
    beforeUpload: (file) =>
      /\.mp4$/i.test(file.name) ? false : (message.error('仅支持 MP4 视频'), Upload.LIST_IGNORE),
    onChange: ({ fileList: fl }) => setVideoList(fl),
  };

  const thumbProps: UploadProps = {
    accept: '.jpg,.jpeg,.png,.webp',
    maxCount: 1,
    listType: 'picture',
    fileList: thumbList,
    beforeUpload: (file) =>
      /\.(jpe?g|png|webp)$/i.test(file.name) ? false : (message.error('缩略图仅支持 jpg/png/webp'), Upload.LIST_IGNORE),
    onChange: ({ fileList: fl }) => setThumbList(fl),
  };

  return (
    <Card
      title="视频管理"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>
          上传视频
        </Button>
      }
    >
      <Table<VideoItem>
        rowKey="id"
        loading={loading}
        dataSource={data}
        pagination={{
          current: page,
          total,
          pageSize: PAGE_SIZE,
          showTotal: (t) => `共 ${t} 个视频`,
          onChange: setPage,
        }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          {
            title: '缩略图',
            dataIndex: 'thumbUrl',
            width: 110,
            render: (url: string | null) =>
              url ? (
                <img src={url} alt="thumb" style={{ width: 90, height: 50, objectFit: 'cover', borderRadius: 4 }} />
              ) : (
                <PlayCircleOutlined style={{ fontSize: 22, color: '#bbb' }} />
              ),
          },
          { title: '标题', dataIndex: 'title' },
          { title: '简介', dataIndex: 'intro', ellipsis: true },
          {
            title: '大小',
            dataIndex: 'videoSize',
            width: 100,
            render: (s: number) => `${(s / 1024 / 1024).toFixed(1)} MB`,
          },
          {
            title: '上传时间',
            dataIndex: 'createTime',
            width: 160,
            render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm'),
          },
          {
            title: '操作',
            width: 200,
            render: (_, record) => (
              <Space>
                <Button size="small" onClick={() => setPlaying(record)}>播放</Button>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(record);
                    editForm.setFieldsValue({ title: record.title, intro: record.intro });
                  }}
                >
                  编辑
                </Button>
                <Popconfirm
                  title="删除后视频与记录均不可恢复，确认删除？"
                  onConfirm={async () => {
                    await adminDeleteVideo(record.id);
                    message.success('已删除');
                    load(page);
                  }}
                >
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      {/* ---------- 上传弹窗 ---------- */}
      <Modal
        title="上传视频"
        open={uploadOpen}
        onOk={handleUpload}
        confirmLoading={submitting}
        okText="上传"
        width={640}
        destroyOnClose
        onCancel={() => {
          setUploadOpen(false);
          uploadForm.resetFields();
          setVideoList([]);
          setThumbList([]);
        }}
      >
        <Form form={uploadForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input maxLength={100} placeholder="视频展示标题" />
          </Form.Item>
          <Form.Item name="intro" label="简介">
            <Input.TextArea rows={3} maxLength={500} placeholder="视频简介（可选）" />
          </Form.Item>
          <Form.Item label="视频文件（MP4）" required>
            <Upload.Dragger {...videoProps}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽 MP4 视频到此处</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item label="缩略图（可选，jpg/png/webp）">
            <Upload {...thumbProps}>
              <Button>选择缩略图</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* ---------- 编辑弹窗 ---------- */}
      <Modal
        title="编辑视频信息"
        open={!!editing}
        onOk={handleEdit}
        okText="保存"
        destroyOnClose
        onCancel={() => setEditing(null)}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="intro" label="简介">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---------- 播放弹窗 ---------- */}
      <Modal
        title={playing?.title}
        open={!!playing}
        footer={null}
        width={800}
        destroyOnClose
        onCancel={() => setPlaying(null)}
      >
        <video
          src={playing?.videoUrl}
          controls
          autoPlay
          style={{ width: '100%', maxHeight: '70vh', background: '#000' }}
        />
      </Modal>
    </Card>
  );
}
