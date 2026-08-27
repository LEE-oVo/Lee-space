import { useEffect, useState } from 'react';
import { Card, Col, Empty, Modal, Pagination, Row, Spin, Typography } from 'antd';
import { PlayCircleFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import { fetchVideos, type VideoItem } from '../../api/client';

const PAGE_SIZE = 9;

/** 视频展示：网格卡片 + 弹窗播放（原生 video，支持进度/音量控制） */
export default function Videos() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<VideoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [playing, setPlaying] = useState<VideoItem | null>(null);

  const load = async (p: number) => {
    setLoading(true);
    try {
      const res = await fetchVideos(p, PAGE_SIZE);
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
      <Typography.Title level={3}>视频展示</Typography.Title>
      <Typography.Paragraph type="secondary">点击卡片播放视频</Typography.Paragraph>

      <Spin spinning={loading}>
        {data.length === 0 && !loading ? (
          <Empty description="暂无视频" />
        ) : (
          <Row gutter={[20, 20]}>
            {data.map((v) => (
              <Col xs={24} sm={12} md={8} key={v.id}>
                <Card hoverable onClick={() => setPlaying(v)} bodyStyle={{ padding: 12 }}>
                  <div style={{ position: 'relative', background: '#000', borderRadius: 4, overflow: 'hidden' }}>
                    {v.thumbUrl ? (
                      <img
                        src={v.thumbUrl}
                        alt={v.title}
                        style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: 160,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: '#1f1f1f',
                        }}
                      >
                        <PlayCircleFilled style={{ fontSize: 40, color: '#666' }} />
                      </div>
                    )}
                    <PlayCircleFilled
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%,-50%)',
                        fontSize: 44,
                        color: 'rgba(255,255,255,.85)',
                      }}
                    />
                  </div>
                  <Typography.Title level={5} ellipsis style={{ marginTop: 10, marginBottom: 4 }}>
                    {v.title}
                  </Typography.Title>
                  <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 4, minHeight: 44 }}>
                    {v.intro || '暂无简介'}
                  </Typography.Paragraph>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(v.createTime).format('YYYY-MM-DD HH:mm')}
                  </Typography.Text>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Spin>

      <div style={{ textAlign: 'right', marginTop: 16 }}>
        <Pagination
          current={page}
          total={total}
          pageSize={PAGE_SIZE}
          showTotal={(t) => `共 ${t} 个视频`}
          onChange={setPage}
        />
      </div>

      {/* 播放弹窗：controls 自带进度条与音量控制 */}
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
        {playing?.intro && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            {playing.intro}
          </Typography.Paragraph>
        )}
      </Modal>
    </div>
  );
}
