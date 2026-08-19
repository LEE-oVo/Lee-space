package com.cybershow.dto;

import java.util.List;

/**
 * 站点访问统计汇总。
 */
public class SiteStatsVO {

    private long totalVisits;
    private long todayVisits;
    private long totalVisitors;
    private List<DayCount> last7Days;

    public static class DayCount {
        private String day;
        private long count;

        public DayCount() {
        }

        public DayCount(String day, long count) {
            this.day = day;
            this.count = count;
        }

        public String getDay() {
            return day;
        }

        public void setDay(String day) {
            this.day = day;
        }

        public long getCount() {
            return count;
        }

        public void setCount(long count) {
            this.count = count;
        }
    }

    public long getTotalVisits() {
        return totalVisits;
    }

    public void setTotalVisits(long totalVisits) {
        this.totalVisits = totalVisits;
    }

    public long getTodayVisits() {
        return todayVisits;
    }

    public void setTodayVisits(long todayVisits) {
        this.todayVisits = todayVisits;
    }

    public long getTotalVisitors() {
        return totalVisitors;
    }

    public void setTotalVisitors(long totalVisitors) {
        this.totalVisitors = totalVisitors;
    }

    public List<DayCount> getLast7Days() {
        return last7Days;
    }

    public void setLast7Days(List<DayCount> last7Days) {
        this.last7Days = last7Days;
    }
}
