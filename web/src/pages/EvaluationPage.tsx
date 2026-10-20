/**
 * 事后评估页（独立页面）。
 *
 * 从基金页里分出来的原因不只是「内容多」：它和基金页要回答的问题完全相反——
 * 基金页是「今天该怎么做」，这里是「过去那些建议到底准不准」。
 * 混在一页里会把「实时判断」和「事后复盘」两种心态挤在一起，
 * 而且它是全量重算，挂在基金页上会白白多占一次请求。
 *
 * 权限：要求 fund:detail 且非游客。②模拟组合、③挑选增值含跨来源横向比较
 * 与用户本人的取舍，这些数一旦被模型看到，评分本身就会失真。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { FundEvaluationPanel } from '../components/FundEvaluationPanel';
import { FundEvaluationGlossary } from '../components/FundEvaluationGlossary';
import type { FundEvaluation } from '../types';

export function EvaluationPage() {
  const { can } = useAuth();
  const canDetail = can('fund:detail');
  const [data, setData] = useState<FundEvaluation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastLoadAt = useRef(0);

  const load = useCallback(async () => {
    lastLoadAt.current = Date.now();
    setRefreshing(true);
    try {
      setData(await api.fundEvaluation());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (canDetail) void load();
  }, [canDetail, load]);

  // 切回这个标签页时刷新：结算与建议都在后台跑完（13:00 / 14:30），
  // 一直开着页面反而看不到新数据。节流 30 秒
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadAt.current < 30000) return;
      void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (!canDetail) {
    return (
      <div className="page">
        <div className="card">
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <Icon name="shield" size={16} />
            <div style={{ fontWeight: 500 }}>没有事后评估的访问权限</div>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
            这里要对照三条组合曲线与你的采纳取舍，包含持仓金额和跨来源横向排名，
            需要 <span className="mono">fund:detail</span> 权限，游客不开放。
          </p>
          <Link className="btn" to="/funds">返回基金行情</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <div className="card eval-card">
          <div className="skeleton" style={{ width: 180, height: 20 }} />
          <div className="skeleton" style={{ width: '100%', height: 120, marginTop: 14 }} />
          <div className="skeleton" style={{ width: '100%', height: 220, marginTop: 12 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="eval-page-head">
        <div>
          <div className="eval-page-title">事后评估</div>
          <div className="faint">
            每条建议都按自己的未来净值单独打分，采纳与否不进公式
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn ghost sm" to="/funds">
            <Icon name="chart" size={14} />
            回到基金行情
          </Link>
          <button className="btn ghost sm" onClick={() => void load()} disabled={refreshing}>
            <Icon name="refresh" size={14} />
            {refreshing ? '计算中…' : '重新计算'}
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {data ? (
        <>
          <FundEvaluationPanel data={data} />
          <FundEvaluationGlossary data={data} />
        </>
      ) : null}
    </div>
  );
}
