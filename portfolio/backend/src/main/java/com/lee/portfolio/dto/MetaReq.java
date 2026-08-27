package com.lee.portfolio.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 文件/视频元信息编辑请求（标题 + 简介） */
@Data
public class MetaReq {

    @NotBlank(message = "不能为空")
    @Size(max = 100, message = "最长 100 字符")
    private String title;

    @Size(max = 500, message = "最长 500 字符")
    private String intro;
}
