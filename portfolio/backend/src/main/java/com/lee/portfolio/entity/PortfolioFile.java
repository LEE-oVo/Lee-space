package com.lee.portfolio.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 文件作品（PDF / HTML 汇报文档）
 */
@Data
@TableName("portfolio_file")
public class PortfolioFile {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 文件标题 */
    private String title;

    /** 简介 */
    private String intro;

    /** 文件类型：pdf / html */
    private String fileType;

    /** 存储路径（相对上传根目录），如 files/xxx.pdf */
    private String filePath;

    /** 原始文件名 */
    private String originalName;

    /** 文件大小（字节） */
    private Long fileSize;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    /** 非数据库字段：对外访问 URL */
    @TableField(exist = false)
    private String url;
}
