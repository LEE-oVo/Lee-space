package com.lee.portfolio.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.lee.portfolio.common.BizException;
import com.lee.portfolio.entity.Video;
import com.lee.portfolio.mapper.VideoMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * 视频作品服务：上传（MP4 + 缩略图）、分页查询、编辑、删除
 */
@Service
public class VideoService {

    private static final List<String> VIDEO_EXT = Arrays.asList("mp4");
    private static final List<String> IMAGE_EXT = Arrays.asList("jpg", "jpeg", "png", "webp");

    private final VideoMapper videoMapper;

    @Value("${app.upload.path}")
    private String uploadPath;

    public VideoService(VideoMapper videoMapper) {
        this.videoMapper = videoMapper;
    }

    /** 分页查询，按上传时间倒序 */
    public Page<Video> page(long page, long size) {
        Page<Video> result = videoMapper.selectPage(
                new Page<>(page, size),
                new QueryWrapper<Video>().orderByDesc("create_time"));
        result.getRecords().forEach(this::fillUrl);
        return result;
    }

    public Video getById(Long id) {
        Video v = videoMapper.selectById(id);
        if (v == null) {
            throw BizException.notFound("视频不存在");
        }
        fillUrl(v);
        return v;
    }

    /** 上传：校验后缀 → 视频存 videos/、缩略图存 thumbs/ → 落库 */
    public Video upload(MultipartFile video, MultipartFile thumb, String title, String intro) {
        FileService.checkExt(video.getOriginalFilename(), VIDEO_EXT);
        String videoRelative = "videos/" + UUID.randomUUID().toString().replace("-", "") + ".mp4";
        saveToDisk(video, videoRelative);

        String thumbRelative = null;
        if (thumb != null && !thumb.isEmpty()) {
            FileService.checkExt(thumb.getOriginalFilename(), IMAGE_EXT);
            String ext = thumb.getOriginalFilename().substring(thumb.getOriginalFilename().lastIndexOf('.') + 1).toLowerCase();
            thumbRelative = "thumbs/" + UUID.randomUUID().toString().replace("-", "") + "." + ext;
            saveToDisk(thumb, thumbRelative);
        }

        Video entity = new Video();
        entity.setTitle(title);
        entity.setIntro(intro);
        entity.setVideoPath(videoRelative);
        entity.setThumbPath(thumbRelative);
        entity.setVideoSize(video.getSize());
        videoMapper.insert(entity);
        fillUrl(entity);
        return entity;
    }

    /** 仅更新标题与简介 */
    public void updateMeta(Long id, String title, String intro) {
        Video v = videoMapper.selectById(id);
        if (v == null) {
            throw BizException.notFound("视频不存在");
        }
        v.setTitle(title);
        v.setIntro(intro);
        videoMapper.updateById(v);
    }

    /** 删除：清理视频与缩略图磁盘文件后删记录 */
    public void delete(Long id) {
        Video v = videoMapper.selectById(id);
        if (v == null) {
            throw BizException.notFound("视频不存在");
        }
        new File(uploadPath, v.getVideoPath()).delete();
        if (v.getThumbPath() != null) {
            new File(uploadPath, v.getThumbPath()).delete();
        }
        videoMapper.deleteById(id);
    }

    private void fillUrl(Video v) {
        v.setVideoUrl("/uploads/" + v.getVideoPath());
        v.setThumbUrl(v.getThumbPath() == null ? null : "/uploads/" + v.getThumbPath());
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
}
