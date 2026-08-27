package com.lee.portfolio.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.lee.portfolio.common.BizException;
import com.lee.portfolio.entity.PortfolioFile;
import com.lee.portfolio.mapper.PortfolioFileMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 文件作品服务：上传（仅 PDF/HTML）、分页查询、编辑、删除（含磁盘清理）
 */
@Service
public class FileService {

    /** 允许上传的文件后缀（安全约束：仅管理员上传） */
    private static final List<String> ALLOWED = Arrays.asList("pdf", "html");

    private final PortfolioFileMapper fileMapper;

    @Value("${app.upload.path}")
    private String uploadPath;

    public FileService(PortfolioFileMapper fileMapper) {
        this.fileMapper = fileMapper;
    }

    /** 前台/后台通用分页查询，按上传时间倒序 */
    public Page<PortfolioFile> page(long page, long size) {
        Page<PortfolioFile> result = fileMapper.selectPage(
                new Page<>(page, size),
                new QueryWrapper<PortfolioFile>().orderByDesc("create_time"));
        result.getRecords().forEach(this::fillUrl);
        return result;
    }

    public PortfolioFile getById(Long id) {
        PortfolioFile f = fileMapper.selectById(id);
        if (f == null) {
            throw BizException.notFound("文件不存在");
        }
        fillUrl(f);
        return f;
    }

    /** 上传：校验后缀 → 存磁盘 files/uuid.ext → 落库 */
    public PortfolioFile upload(MultipartFile file, String title, String intro) {
        String ext = extOf(file.getOriginalFilename());
        if (!ALLOWED.contains(ext)) {
            throw BizException.badRequest("仅支持 PDF、HTML 文件");
        }
        String relative = "files/" + UUID.randomUUID().toString().replace("-", "") + "." + ext;
        saveToDisk(file, relative);

        PortfolioFile entity = new PortfolioFile();
        entity.setTitle(title);
        entity.setIntro(intro);
        entity.setFileType(ext);
        entity.setFilePath(relative);
        entity.setOriginalName(file.getOriginalFilename());
        entity.setFileSize(file.getSize());
        fileMapper.insert(entity);
        fillUrl(entity);
        return entity;
    }

    /** 仅更新标题与简介 */
    public void updateMeta(Long id, String title, String intro) {
        PortfolioFile f = fileMapper.selectById(id);
        if (f == null) {
            throw BizException.notFound("文件不存在");
        }
        f.setTitle(title);
        f.setIntro(intro);
        fileMapper.updateById(f);
    }

    /** 删除：先删磁盘文件再删记录 */
    public void delete(Long id) {
        PortfolioFile f = fileMapper.selectById(id);
        if (f == null) {
            throw BizException.notFound("文件不存在");
        }
        new File(uploadPath, f.getFilePath()).delete();
        fileMapper.deleteById(id);
    }

    private void fillUrl(PortfolioFile f) {
        f.setUrl("/uploads/" + f.getFilePath());
    }

    private String extOf(String name) {
        if (name == null || !name.contains(".")) {
            throw BizException.badRequest("文件名缺少扩展名");
        }
        return name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
    }

    private void saveToDisk(MultipartFile file, String relative) {
        try {
            File target = new File(uploadPath, relative);
            target.getParentFile().mkdirs();
            file.transferTo(target.getAbsoluteFile());
        } catch (IOException e) {
            throw new BizException(500, "文件保存失败：" + e.getMessage());
        }
    }

    /** 供视频服务复用：校验后缀白名单 */
    public static void checkExt(String name, List<String> allowed) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        boolean ok = allowed.stream().anyMatch(e -> lower.endsWith("." + e));
        if (!ok) {
            throw BizException.badRequest("不支持的文件类型，允许：" +
                    allowed.stream().collect(Collectors.joining("/")));
        }
    }
}
