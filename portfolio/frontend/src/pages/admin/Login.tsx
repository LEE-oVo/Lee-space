import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { adminLogin, getToken, setToken } from '../../api/client';

/** 管理员登录页（单管理员账号，无注册入口） */
export default function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // 已登录则直接进入后台
  useEffect(() => {
    if (getToken()) navigate('/admin', { replace: true });
  }, [navigate]);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await adminLogin(values.username, values.password);
      setToken(res.token);
      message.success('登录成功');
      navigate('/admin', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1f1f2e 0%, #2d3a5e 100%)',
      }}
    >
      <Card style={{ width: 380, borderRadius: 8 }}>
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 4 }}>
          管理后台
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          个人作品管理系统
        </Typography.Paragraph>
        <Form name="login" onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
              autoComplete="current-password"
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登 录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
