import { useEffect, useState } from 'react';
import {
  Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag, Upload, message,
} from 'antd';
import { InboxOutlined, PlusOutlined } from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';
import dayjs from 'dayjs';
import {
  adminListFiles, adminUpdateFile, adminDeleteFile, uploadFile, type PortfolioFile,
} from '../../api/client';
import PdfViewer from '../../components/PdfViewer';

const PAGE_SIZE = 10;

/** 文件管理：上传（PDF/HTML）+ 编辑标题简介 + 删除 + 内嵌预览 */
export default function FileManage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PortfolioFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // 上传弹窗
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 编辑弹窗
  const [editing, setEditing] = useState<PortfolioFile | null>(null);
  const [editForm] = Form.useForm();

  // 预览弹窗
  const [preview, setPreview] = useState<PortfolioFile | null>(null);

  const load = async (p: number) => {
    setLoading(true);
    try {
      const res = await adminListFiles(p, PAGE_SIZE);
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

  // 上传提交：手动上传（customRequest 留空，真正请求在 onOk 中发起）
  const handleUpload = async () => {
    const values = await uploadForm.validateFields();
    const raw = fileList[0]?.originFileObj as File | undefined;
    if (!raw) {
      message.warning('请选择要上传的文件');
      return;
    }
    setSubmitting(true);
    try {
      await uploadFile(raw, values.title, values.intro || '');
      message.success('上传成功');
      setUploadOpen(false);
      uploadForm.resetFields();
      setFileList([]);
      load(page);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!editing) return;
    const values = await editForm.validateFields();
    await adminUpdateFile(editing.id, values.title, values.intro || '');
    message.success('保存成功');
    setEditing(null);
    load(page);
  };

  const uploadProps: UploadProps = {
    accept: '.pdf,.html,.htm',
    maxCount: 1,
    fileList,
    beforeUpload: (file) => {
      const ok = /\.(pdf|html?)$/i.test(file.name);
      if (!ok) message.error('仅支持 PDF 或 HTML 文件');
      return ok ? false : Upload.LIST_IGNORE; // false = 阻止自动上传，手动提交
    },
    onChange: ({ fileList: fl }) => setFileList(fl),
  };

  return (
    <Card
      title="文件管理"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>
          上传文件
        </Button>
      }
    >
      <Table<PortfolioFile>
        rowKey="id"
        loading={loading}
        dataSource={data}
        pagination={{
          current: page,
          total,
          pageSize: PAGE_SIZE,
          showTotal: (t) => `共 ${t} 个文件`,
          onChange: setPage,
        }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          { title: '标题', dataIndex: 'title' },
          { title: '简介', dataIndex: 'intro', ellipsis: true },
          {
            title: '类型',
            dataIndex: 'fileType',
            width: 90,
            render: (t: string) => <Tag color={t === 'pdf' ? 'red' : 'orange'}>{t.toUpperCase()}</Tag>,
          },
          {
            title: '大小',
            dataIndex: 'fileSize',
            width: 100,
            render: (s: number) => `${(s / 1024).toFixed(1)} KB`,
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
                <Button size="small" onClick={() => setPreview(record)}>预览</Button>
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
                  title="删除后文件与记录均不可恢复，确认删除？"
                  onConfirm={async () => {
                    await adminDeleteFile(record.id);
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
        title="上传文件"
        open={uploadOpen}
        onOk={handleUpload}
        confirmLoading={submitting}
        okText="上传"
        destroyOnClose
        onCancel={() => {
          setUploadOpen(false);
          uploadForm.resetFields();
          setFileList([]);
        }}
      >
        <Form form={uploadForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input maxLength={100} placeholder="文件展示标题" />
          </Form.Item>
          <Form.Item name="intro" label="简介">
            <Input.TextArea rows={3} maxLength={500} placeholder="文件简介（可选）" />
          </Form.Item>
          <Form.Item label="文件（PDF / HTML）" required>
            <Upload.Dragger {...uploadProps}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽文件到此处</p>
              <p className="ant-upload-hint">仅支持 .pdf / .html 文件</p>
            </Upload.Dragger>
          </Form.Item>
        </Form>
      </Modal>

      {/* ---------- 编辑弹窗 ---------- */}
      <Modal
        title="编辑文件信息"
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

      {/* ---------- 内嵌预览弹窗 ---------- */}
      <Modal
        title={preview?.title}
        open={!!preview}
        footer={null}
        width={900}
        destroyOnClose
        onCancel={() => setPreview(null)}
      >
        {preview?.fileType === 'pdf' ? (
          <PdfViewer url={preview.url} />
        ) : (
          <iframe
            src={preview?.url}
            title="admin-html-preview"
            sandbox="allow-same-origin"
            style={{ width: '100%', height: '70vh', border: '1px solid #f0f0f0' }}
          />
        )}
      </Modal>
    </Card>
  );
}
