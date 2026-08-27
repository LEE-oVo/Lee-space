package com.lee.portfolio.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.lee.portfolio.common.Result;
import com.lee.portfolio.dto.MetaReq;
import com.lee.portfolio.entity.Video;
import com.lee.portfolio.service.VideoService;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 后台视频管理接口（全部需要 JWT）
 */
@RestController
@RequestMapping("/api/admin/videos")
public class AdminVideoController {

    private final VideoService videoService;

    public AdminVideoController(VideoService videoService) {
        this.videoService = videoService;
    }

    /** 分页列表 */
    @GetMapping
    public Result<Page<Video>> list(@RequestParam(defaultValue = "1") long page,
                                    @RequestParam(defaultValue = "10") long size) {
        return Result.ok(videoService.page(page, size));
    }

    /** 上传：POST /api/admin/videos/upload，multipart：video + thumb(可选) + title + intro */
    @PostMapping("/upload")
    public Result<Video> upload(@RequestParam("video") MultipartFile video,
                                @RequestParam(value = "thumb", required = false) MultipartFile thumb,
                                @RequestParam String title,
                                @RequestParam(required = false, defaultValue = "") String intro) {
        return Result.ok(videoService.upload(video, thumb, title, intro));
    }

    /** 编辑标题与简介：PUT /api/admin/videos/{id} */
    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @Validated @RequestBody MetaReq req) {
        videoService.updateMeta(id, req.getTitle(), req.getIntro());
        return Result.ok();
    }

    /** 删除（含视频与缩略图磁盘清理）：DELETE /api/admin/videos/{id} */
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        videoService.delete(id);
        return Result.ok();
    }
}
