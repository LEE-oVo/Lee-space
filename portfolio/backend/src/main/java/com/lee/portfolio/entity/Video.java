package com.lee.portfolio.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 视频作品（本地 MP4 + 缩略图）
 */
@Data
@TableName("portfolio_video")
public class Video {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 视频标题 */
    private String title;

    /** 简介 */
    private String intro;

    /** 视频存储路径（相对上传根目录），如 videos/xxx.mp4 */
    private String videoPath;

    /** 缩略图存储路径，如 thumbs/xxx.jpg */
    private String thumbPath;

    /** 视频大小（字节） */
    private Long videoSize;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    /** 非数据库字段：对外访问 URL */
    @TableField(exist = false)
    private String videoUrl;

    @TableField(exist = false)
    private String thumbUrl;
}
