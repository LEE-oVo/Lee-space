import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { FundHoldings } from '../components/FundHoldings';
import { FundInvestmentConfig } from '../components/FundInvestmentConfig';
import type { FundConfig, FundHolding, FundInvestment } from '../types';

export function FundSettingsPage() {
  const { can } = useAuth();
  const canManage = can('fund:manage');
  const [holdings, setHoldings] = useState<FundHolding[] | null>(null);
  const [invest, setInvest] = useState<{ config: FundConfig; investment: FundInvestment } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.funds();
      setHoldings(d.holdings);
      if (d.config && d.investment) setInvest({ config: d.config, investment: d.investment });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  if (!canManage) {
    return (
      <div className="page">
        <div className="card">
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <Icon name="shield" size={16} />
            <div style={{ fontWeight: 500 }}>没有持仓配置的访问权限</div>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
            持仓信息包含成本价与投入金额，仅管理员可查看与修改。
            需要调整时请联系管理员，或直接返回行情页面查看公开信息。
          </p>
          <Link className="btn" to="/funds">返回基金行情</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {error && <div className="alert error">{error}</div>}

      <FundInvestmentConfig initial={invest} onChanged={load} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>关于这个页面</div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.75 }}>
          这里维护的持仓清单会被定时任务读取：每个工作日 14:30，
          任务会按这里的代码逐个抓取行情、由大模型给出建议，再写回工作台。
          因此<b>新增基金只需在这里加一行</b>，不用改动定时任务。
          <br />
          成本价、份额与投入金额属于敏感信息，只有拥有
          <span className="mono"> fund:detail </span>
          权限的角色才能在行情页看到，游客看到的是不含金额的版本。
        </div>
      </div>

      {holdings === null ? (
        <div className="card">
          <div className="skeleton" style={{ width: 160 }} />
          <div className="skeleton" style={{ width: '100%', height: 120, marginTop: 12 }} />
        </div>
      ) : (
        <FundHoldings holdings={holdings} onChanged={load} />
      )}
    </div>
  );
}
