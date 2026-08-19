package com.cybershow.controller;

import com.cybershow.dto.Result;
import com.cybershow.dto.SiteStatsVO;
import com.cybershow.dto.TrackRequest;
import com.cybershow.service.VisitorService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/api/visitor")
public class VisitorController {

    private final VisitorService visitorService;

    public VisitorController(VisitorService visitorService) {
        this.visitorService = visitorService;
    }

    @PostMapping("/track")
    public Result<Boolean> track(@RequestBody(required = false) TrackRequest request,
                                 @RequestHeader(value = "User-Agent", required = false) String userAgent,
                                 HttpServletRequest httpRequest) {
        String page = request != null && request.getPage() != null ? request.getPage() : "/";
        visitorService.track(resolveIp(httpRequest), page, userAgent);
        return Result.ok(true);
    }

    @GetMapping("/stats")
    public Result<SiteStatsVO> stats() {
        return Result.ok(visitorService.stats());
    }

    /**
     * 兼容 Nginx 反代场景，优先取 X-Forwarded-For。
     */
    private String resolveIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isEmpty()) {
            return xff.split(",")[0].trim();
        }
        String realIp = request.getHeader("X-Real-IP");
        return realIp != null ? realIp : request.getRemoteAddr();
    }
}
