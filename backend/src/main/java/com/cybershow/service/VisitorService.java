package com.cybershow.service;

import com.cybershow.dto.SiteStatsVO;
import com.cybershow.mapper.VisitorLogMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class VisitorService {

    private final VisitorLogMapper visitorLogMapper;

    public VisitorService(VisitorLogMapper visitorLogMapper) {
        this.visitorLogMapper = visitorLogMapper;
    }

    public void track(String ip, String page, String userAgent) {
        String safeUa = userAgent != null && userAgent.length() > 512
                ? userAgent.substring(0, 512) : userAgent;
        visitorLogMapper.insert(ip, page, safeUa);
    }

    public SiteStatsVO stats() {
        SiteStatsVO vo = new SiteStatsVO();
        vo.setTotalVisits(visitorLogMapper.totalVisits());
        vo.setTodayVisits(visitorLogMapper.todayVisits());
        vo.setTotalVisitors(visitorLogMapper.totalVisitors());

        List<SiteStatsVO.DayCount> days = new ArrayList<>();
        for (Map<String, Object> row : visitorLogMapper.last7Days()) {
            String day = String.valueOf(row.get("day"));
            long cnt = ((Number) row.get("cnt")).longValue();
            days.add(new SiteStatsVO.DayCount(day, cnt));
        }
        vo.setLast7Days(days);
        return vo;
    }
}
