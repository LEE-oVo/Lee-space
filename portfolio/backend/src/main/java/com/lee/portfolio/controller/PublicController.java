package com.lee.portfolio.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.lee.portfolio.common.Result;
import com.lee.portfolio.entity.PortfolioFile;
import com.lee.portfolio.entity.Video;
import com.lee.portfolio.service.FileService;
import com.lee.portfolio.service.VideoService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 前台公开接口（无需鉴权）
 * 注：分页返回结构兼容 AntD Table —— records=数据、total=总条数
 */
@RestController
@RequestMapping("/api/public")
public class PublicController {

    private final FileService fileService;
    private final VideoService videoService;

    public PublicController(FileService fileService, VideoService videoService) {
        this.fileService = fileService;
        this.videoService = videoService;
    }

    /** 文件分页列表：GET /api/public/files?page=1&size=10 */
    @GetMapping("/files")
    public Result<Page<PortfolioFile>> files(@RequestParam(defaultValue = "1") long page,
                                             @RequestParam(defaultValue = "10") long size) {
        return Result.ok(fileService.page(page, size));
    }

    /** 文件详情：GET /api/public/files/{id} */
    @GetMapping("/files/{id}")
    public Result<PortfolioFile> fileDetail(@PathVariable Long id) {
        return Result.ok(fileService.getById(id));
    }

    /** 视频分页列表：GET /api/public/videos?page=1&size=12 */
    @GetMapping("/videos")
    public Result<Page<Video>> videos(@RequestParam(defaultValue = "1") long page,
                                      @RequestParam(defaultValue = "12") long size) {
        return Result.ok(videoService.page(page, size));
    }

    /** 视频详情：GET /api/public/videos/{id} */
    @GetMapping("/videos/{id}")
    public Result<Video> videoDetail(@PathVariable Long id) {
        return Result.ok(videoService.getById(id));
    }
}
