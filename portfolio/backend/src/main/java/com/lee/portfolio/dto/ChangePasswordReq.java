package com.lee.portfolio.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 修改密码请求 */
@Data
public class ChangePasswordReq {

    @NotBlank(message = "不能为空")
    private String oldPassword;

    @NotBlank(message = "不能为空")
    @Size(min = 6, max = 32, message = "长度需在 6-32 位之间")
    private String newPassword;
}
