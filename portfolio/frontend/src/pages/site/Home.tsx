import { Button, Card, Col, Row, Typography } from 'antd';
import { FileTextOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Title, Paragraph } = Typography;

/** 首页：简约个人作品风格入口 */
export default function Home() {
  const navigate = useNavigate();

  return (
    <div style={{ paddingTop: 40 }}>
      <Typography style={{ textAlign: 'center', marginBottom: 48 }}>
        <Title level={2}>你好，这里是 Lee'space</Title>
        <Paragraph type="secondary" style={{ fontSize: 16 }}>
          一个存放我工作文档与视频作品的个人空间
        </Paragraph>
      </Typography>

      <Row gutter={[24, 24]} justify="center">
        <Col xs={24} sm={12} md={10}>
          <Card hoverable onClick={() => navigate('/files')} style={{ textAlign: 'center', height: '100%' }}>
            <FileTextOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: 16 }} />
            <Title level={4}>文件展示</Title>
            <Paragraph type="secondary">PDF 与 HTML 汇报文档，支持页面内直接预览</Paragraph>
            <Button type="primary">查看文档</Button>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={10}>
          <Card hoverable onClick={() => navigate('/videos')} style={{ textAlign: 'center', height: '100%' }}>
            <PlayCircleOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
            <Title level={4}>视频展示</Title>
            <Paragraph type="secondary">视频作品合集，点击卡片即可播放</Paragraph>
            <Button type="primary" style={{ background: '#52c41a', borderColor: '#52c41a' }}>
              观看视频
            </Button>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
