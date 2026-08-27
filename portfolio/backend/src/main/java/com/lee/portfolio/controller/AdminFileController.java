package com.lee.portfolio.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.lee.portfolio.common.Result;
import com.lee.portfolio.dto.MetaReq;
import com.lee.portfolio.entity.PortfolioFile;
import com.lee.portfolio.service.FileService;
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
 * 后台文件管理接口（全部需要 JWT）
 */
@RestController
@RequestMapping("/api/admin/files")
public class AdminFileController {

    private final FileService fileService;

    public AdminFileController(FileService fileService) {
        this.fileService = fileService;
    }

    /** 分页列表（与前台同数据源） */
    @GetMapping
    public Result<Page<PortfolioFile>> list(@RequestParam(defaultValue = "1") long page,
                                            @RequestParam(defaultValue = "10") long size) {
        return Result.ok(fileService.page(page, size));
    }

    /** 上传：POST /api/admin/files/upload，multipart：file + title + intro */
    @PostMapping("/upload")
    public Result<PortfolioFile> upload(@RequestParam("file") MultipartFile file,
                                        @RequestParam String title,
                                        @RequestParam(required = false, defaultValue = "") String intro) {
        return Result.ok(fileService.upload(file, title, intro));
    }

    /** 编辑标题与简介：PUT /api/admin/files/{id} */
    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @Validated @RequestBody MetaReq req) {
        fileService.updateMeta(id, req.getTitle(), req.getIntro());
        return Result.ok();
    }

    /** 删除（含磁盘文件清理）：DELETE /api/admin/files/{id} */
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        fileService.delete(id);
        return Result.ok();
    }
}
