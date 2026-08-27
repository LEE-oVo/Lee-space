import { useEffect, useState } from 'react';
import { Empty, List, Modal, Pagination, Spin, Tag, Typography } from 'antd';
import { FilePdfOutlined, Html5Outlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { fetchFiles, type PortfolioFile } from '../../api/client';
import PdfViewer from '../../components/PdfViewer';

const PAGE_SIZE = 10;

/** 文件展示：列表分页 + 页面内嵌预览（PDF 用 pdfjs，HTML 直接渲染） */
export default function Files() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PortfolioFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<PortfolioFile | null>(null);

  const load = async (p: number) => {
    setLoading(true);
    try {
      const res = await fetchFiles(p, PAGE_SIZE);
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

  return (
    <div>
      <Typography.Title level={3}>文件展示</Typography.Title>
      <Typography.Paragraph type="secondary">
        PDF 与 HTML 汇报文档，点击条目即可在页面内直接预览
      </Typography.Paragraph>

      <Spin spinning={loading}>
        <List
          dataSource={data}
          locale={{ emptyText: <Empty description="暂无文件" /> }}
          renderItem={(item) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => setPreview(item)}
              actions={[<Tag key="t" color={item.fileType === 'pdf' ? 'red' : 'orange'}>{item.fileType.toUpperCase()}</Tag>]}
            >
              <List.Item.Meta
                avatar={
                  item.fileType === 'pdf' ? (
                    <FilePdfOutlined style={{ fontSize: 32, color: '#f5222d' }} />
                  ) : (
                    <Html5Outlined style={{ fontSize: 32, color: '#fa8c16' }} />
                  )
                }
                title={item.title}
                description={
                  <span>
                    {item.intro || '暂无简介'}
                    <span style={{ marginLeft: 12, color: '#999' }}>
                      上传于 {dayjs(item.createTime).format('YYYY-MM-DD HH:mm')}
                    </span>
                  </span>
                }
              />
            </List.Item>
          )}
        />
      </Spin>

      <div style={{ textAlign: 'right', marginTop: 16 }}>
        <Pagination
          current={page}
          total={total}
          pageSize={PAGE_SIZE}
          showTotal={(t) => `共 ${t} 个文件`}
          onChange={setPage}
        />
      </div>

      {/* 页面内嵌预览弹窗：禁止下载弹窗 */}
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
          // HTML 文档：iframe 渲染展示；sandbox 禁用脚本执行，仅保留样式与结构
          <iframe
            src={preview?.url}
            title="html-preview"
            sandbox="allow-same-origin"
            style={{ width: '100%', height: '70vh', border: '1px solid #f0f0f0' }}
          />
        )}
      </Modal>
    </div>
  );
}
