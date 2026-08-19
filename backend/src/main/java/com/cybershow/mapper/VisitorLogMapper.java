package com.cybershow.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

@Mapper
public interface VisitorLogMapper {

    @Insert("INSERT INTO visitor_log (ip, page, user_agent) VALUES (#{ip}, #{page}, #{userAgent})")
    void insert(@Param("ip") String ip, @Param("page") String page, @Param("userAgent") String userAgent);

    @Select("SELECT COUNT(*) FROM visitor_log")
    long totalVisits();

    @Select("SELECT COUNT(*) FROM visitor_log WHERE DATE(created_at) = CURDATE()")
    long todayVisits();

    @Select("SELECT COUNT(DISTINCT ip) FROM visitor_log")
    long totalVisitors();

    @Select("SELECT DATE_FORMAT(created_at, '%m-%d') AS day, COUNT(*) AS cnt FROM visitor_log "
            + "WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) "
            + "GROUP BY DATE(created_at), DATE_FORMAT(created_at, '%m-%d') ORDER BY day")
    List<Map<String, Object>> last7Days();
}
